from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

try:
    import fitz
except ImportError as error:  # pragma: no cover - exercised only on missing local dependency
    print("PyMuPDF is required for PDF ingestion. Install package: PyMuPDF", file=sys.stderr)
    raise SystemExit(2) from error


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", str(value or "").lower()).strip("-")
    return re.sub(r"-{2,}", "-", slug) or "core-review-source"


def collapse_whitespace(value: str) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def relative_path(path: Path, root: Path) -> str:
    try:
        return path.resolve().relative_to(root.resolve()).as_posix()
    except ValueError:
        return str(path.resolve())


def normalize_tags(values: list[str]) -> list[str]:
    tags: list[str] = []
    for value in values:
        for tag in re.split(r"[,;]", value or ""):
            clean = collapse_whitespace(tag).lower()
            if clean and clean not in tags:
                tags.append(clean)
    return tags


def caption_candidates(text: str) -> list[str]:
    candidates: list[str] = []
    for line in text.splitlines():
        clean = collapse_whitespace(line)
        if not clean:
            continue
        if re.match(r"^(fig(?:ure)?\.?\s*\d+|image\s*\d+|case\s*\d+)", clean, re.I):
            candidates.append(clean[:500])
    return candidates[:12]


def chunk_text(text: str, max_chars: int) -> list[str]:
    clean = text.replace("\r\n", "\n").strip()
    if not clean:
        return []

    paragraphs = [item.strip() for item in re.split(r"\n\s*\n", clean) if item.strip()]
    chunks: list[str] = []
    current = ""

    def push_current() -> None:
        nonlocal current
        normalized = current.strip()
        if normalized:
            chunks.append(normalized)
        current = ""

    for paragraph in paragraphs:
        if not current:
            current = paragraph
            continue
        if len(current) + len(paragraph) + 2 <= max_chars:
            current = f"{current}\n\n{paragraph}"
            continue
        push_current()
        current = paragraph
    push_current()

    split_chunks: list[str] = []
    for chunk in chunks:
        if len(chunk) <= max_chars:
            split_chunks.append(chunk)
            continue
        start = 0
        while start < len(chunk):
            end = min(len(chunk), start + max_chars)
            split_chunks.append(chunk[start:end].strip())
            if end == len(chunk):
                break
            start = max(0, end - 180)
    return [item for item in split_chunks if item]


def rect_payload(rect: Any, page_rect: Any) -> dict[str, float]:
    if rect is None:
        return {}
    page_width = max(1.0, float(page_rect.width))
    page_height = max(1.0, float(page_rect.height))
    return {
        "x": float(rect.x0) / page_width,
        "y": float(rect.y0) / page_height,
        "width": float(rect.width) / page_width,
        "height": float(rect.height) / page_height,
    }


def unique_source_id(base: str, seen: set[str]) -> str:
    candidate = base
    index = 2
    while candidate in seen:
        candidate = f"{base}-{index}"
        index += 1
    seen.add(candidate)
    return candidate


def save_page_render(page: Any, output_path: Path, dpi: int) -> dict[str, int]:
    scale = dpi / 72
    pixmap = page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    pixmap.save(output_path)
    return {
        "width": int(pixmap.width),
        "height": int(pixmap.height),
    }


def ingest_pdf(
    pdf_path: Path,
    *,
    output_root: Path,
    assets_root: Path,
    sources_root: Path,
    seen_source_ids: set[str],
    args: argparse.Namespace,
) -> dict[str, Any]:
    resolved_pdf = pdf_path.resolve()
    document = fitz.open(resolved_pdf)
    metadata = document.metadata or {}
    title = collapse_whitespace(args.title or metadata.get("title") or resolved_pdf.stem.replace("_", " "))
    base_source_id = slugify(args.source_id or title or resolved_pdf.stem)
    source_id = unique_source_id(base_source_id, seen_source_ids)
    source_assets_dir = assets_root / source_id
    source_pdf_dir = sources_root / source_id
    file_hash = sha256_file(resolved_pdf)
    source_pdf_payload: dict[str, Any] = {
        "originalPath": str(resolved_pdf),
        "sha256": file_hash,
    }

    if not args.no_copy_source:
        source_pdf_dir.mkdir(parents=True, exist_ok=True)
        copied_pdf = source_pdf_dir / resolved_pdf.name
        if resolved_pdf != copied_pdf.resolve():
            shutil.copy2(resolved_pdf, copied_pdf)
        source_pdf_payload["path"] = relative_path(copied_pdf, output_root)
        source_pdf_payload["localPath"] = str(copied_pdf.resolve())

    source: dict[str, Any] = {
        "id": source_id,
        "title": title,
        "sourceType": "pdf",
        "importedAt": utc_now(),
        "domain": collapse_whitespace(args.domain).lower(),
        "tags": normalize_tags(args.tags),
        "fileHash": file_hash,
        "pageCount": document.page_count,
        "metadata": {key: value for key, value in metadata.items() if value},
        "sourcePdf": source_pdf_payload,
    }

    chunks: list[dict[str, Any]] = []
    assets: list[dict[str, Any]] = []

    for page_index in range(document.page_count):
        page = document.load_page(page_index)
        page_number = page_index + 1
        page_text = page.get_text("text") or ""
        page_asset_ids: list[str] = []

        if not args.no_render_pages:
            page_asset_id = f"{source_id}:page-{page_number:04d}"
            render_path = source_assets_dir / "pages" / f"page-{page_number:04d}.png"
            dimensions = save_page_render(page, render_path, args.dpi)
            page_asset_ids.append(page_asset_id)
            assets.append(
                {
                    "id": page_asset_id,
                    "sourceId": source_id,
                    "type": "page_render",
                    "pageNumber": page_number,
                    "path": relative_path(render_path, output_root),
                    "localPath": str(render_path.resolve()),
                    "dpi": args.dpi,
                    **dimensions,
                }
            )

        if not args.no_extract_images:
            for image_index, image_info in enumerate(page.get_images(full=True), start=1):
                xref = image_info[0]
                try:
                    extracted = document.extract_image(xref)
                except Exception:
                    continue
                image_bytes = extracted.get("image") or b""
                if not image_bytes:
                    continue
                extension = extracted.get("ext") or "png"
                image_hash = sha256_bytes(image_bytes)
                image_path = source_assets_dir / "images" / f"page-{page_number:04d}-image-{image_index:02d}-{image_hash[:10]}.{extension}"
                image_path.parent.mkdir(parents=True, exist_ok=True)
                if not image_path.exists():
                    image_path.write_bytes(image_bytes)
                rects = page.get_image_rects(xref) or [None]
                for occurrence_index, rect in enumerate(rects, start=1):
                    asset_id = f"{source_id}:page-{page_number:04d}:image-{image_index:02d}:{occurrence_index}"
                    page_asset_ids.append(asset_id)
                    assets.append(
                        {
                            "id": asset_id,
                            "sourceId": source_id,
                            "type": "embedded_image",
                            "pageNumber": page_number,
                            "path": relative_path(image_path, output_root),
                            "localPath": str(image_path.resolve()),
                            "extension": extension,
                            "sha256": image_hash,
                            "width": int(extracted.get("width") or 0),
                            "height": int(extracted.get("height") or 0),
                            "bbox": rect_payload(rect, page.rect),
                        }
                    )

        captions = caption_candidates(page_text)
        for chunk_index, chunk in enumerate(chunk_text(page_text, args.max_chars), start=1):
            chunk_hash = sha256_bytes(chunk.encode("utf-8"))
            chunks.append(
                {
                    "id": f"{source_id}:page-{page_number:04d}:chunk-{chunk_index:03d}",
                    "sourceId": source_id,
                    "pageStart": page_number,
                    "pageEnd": page_number,
                    "domain": source["domain"],
                    "tags": source["tags"],
                    "text": chunk,
                    "textHash": chunk_hash,
                    "assetIds": page_asset_ids,
                    "captionCandidates": captions,
                    "sourceLocator": {
                        "sourceTitle": title,
                        "page": page_number,
                    },
                }
            )

    document.close()
    source["assetCount"] = len(assets)
    source["chunkCount"] = len(chunks)
    return {
        "source": source,
        "assets": assets,
        "chunks": chunks,
    }


def build_corpus(args: argparse.Namespace) -> dict[str, Any]:
    output_path = Path(args.out).resolve()
    output_root = output_path.parent
    assets_root = Path(args.assets_dir).resolve() if args.assets_dir else output_root / "assets"
    sources_root = Path(args.sources_dir).resolve() if args.sources_dir else output_root / "sources"
    seen_source_ids: set[str] = set()
    ingested = [
        ingest_pdf(
            Path(pdf_path),
            output_root=output_root,
            assets_root=assets_root,
            sources_root=sources_root,
            seen_source_ids=seen_source_ids,
            args=args,
        )
        for pdf_path in args.pdfs
    ]

    corpus = {
        "version": 1,
        "kind": "core_review_pdf_corpus",
        "createdAt": utc_now(),
        "sourceCount": len(ingested),
        "assetCount": sum(len(item["assets"]) for item in ingested),
        "chunkCount": sum(len(item["chunks"]) for item in ingested),
        "sources": [item["source"] for item in ingested],
        "assets": [asset for item in ingested for asset in item["assets"]],
        "chunks": [chunk for item in ingested for chunk in item["chunks"]],
    }

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(corpus, indent=2) + "\n", encoding="utf-8")
    return {
        "outputPath": str(output_path),
        **corpus,
    }


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Ingest Core Review PDFs into a local source corpus.")
    parser.add_argument("pdfs", nargs="+", help="PDF files to ingest.")
    parser.add_argument("--out", required=True, help="Output corpus JSON path.")
    parser.add_argument("--assets-dir", default="", help="Directory for page renders and extracted images.")
    parser.add_argument("--sources-dir", default="", help="Directory for copied source PDFs.")
    parser.add_argument("--domain", default="", help="Optional Core Review domain tag for every source.")
    parser.add_argument("--tags", nargs="*", default=[], help="Optional comma-separated or repeated tags.")
    parser.add_argument("--title", default="", help="Override title. Best for single-PDF ingestion.")
    parser.add_argument("--source-id", default="", help="Override source id. Best for single-PDF ingestion.")
    parser.add_argument("--dpi", type=int, default=144, help="Page render DPI.")
    parser.add_argument("--max-chars", type=int, default=1600, help="Maximum text characters per chunk.")
    parser.add_argument("--no-render-pages", action="store_true", help="Skip full-page PNG renders.")
    parser.add_argument("--no-extract-images", action="store_true", help="Skip embedded image extraction.")
    parser.add_argument("--no-copy-source", action="store_true", help="Do not copy original PDFs into the source vault.")
    parser.add_argument("--format", choices=["json", "text"], default="json", help="Output format printed to stdout.")
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    corpus = build_corpus(args)
    if args.format == "text":
        print(f"Created Core Review PDF corpus: {corpus['outputPath']}")
        print(f"Sources: {corpus['sourceCount']}")
        print(f"Assets: {corpus['assetCount']}")
        print(f"Chunks: {corpus['chunkCount']}")
    else:
        print(json.dumps(corpus, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
