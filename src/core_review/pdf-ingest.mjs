import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { PDFParse } from "pdf-parse";
import { collapseWhitespace, slugify } from "../utils.mjs";
import { chunkCoreReviewText } from "./ingest.mjs";

function utcNow() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function sha256Bytes(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function sha256File(filePath) {
  const data = await fs.readFile(filePath);
  return sha256Bytes(data);
}

function normalizeTags(values = []) {
  const tags = [];
  for (const value of values) {
    for (const tag of String(value || "").split(/[,;]/)) {
      const clean = collapseWhitespace(tag).toLowerCase();
      if (clean && !tags.includes(clean)) {
        tags.push(clean);
      }
    }
  }
  return tags;
}

function relativePath(filePath, root) {
  const resolved = path.resolve(filePath);
  const resolvedRoot = path.resolve(root);
  const relative = path.relative(resolvedRoot, resolved);
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative)
    ? relative.split(path.sep).join("/")
    : resolved;
}

function sourceIdFor(base, seen) {
  const slug = slugify(base) || "core-review-source";
  let candidate = slug;
  let index = 2;
  while (seen.has(candidate)) {
    candidate = `${slug}-${index}`;
    index += 1;
  }
  seen.add(candidate);
  return candidate;
}

function captionCandidates(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => collapseWhitespace(line))
    .filter(Boolean)
    .filter((line) => /^(fig(?:ure)?\.?\s*\d+|image\s*\d+|case\s*\d+)/i.test(line))
    .slice(0, 12)
    .map((line) => line.slice(0, 500));
}

function metadataValue(info, ...keys) {
  for (const key of keys) {
    const value = info?.[key];
    if (value) {
      return collapseWhitespace(value);
    }
  }
  return "";
}

async function copySourcePdf(pdfPath, targetDir, outputRoot) {
  await fs.mkdir(targetDir, { recursive: true });
  const copiedPath = path.join(targetDir, path.basename(pdfPath));
  if (path.resolve(pdfPath).toLowerCase() !== path.resolve(copiedPath).toLowerCase()) {
    await fs.copyFile(pdfPath, copiedPath);
  }
  return {
    path: relativePath(copiedPath, outputRoot),
    localPath: path.resolve(copiedPath),
  };
}

async function savePageRenders(parser, sourceId, assetsDir, outputRoot, dpi) {
  const assets = [];
  const pageAssetIds = new Map();
  let screenshots;
  try {
    screenshots = await parser.getScreenshot({
      scale: Math.max(0.25, Number(dpi || 144) / 72),
      imageDataUrl: false,
      imageBuffer: true,
    });
  } catch {
    return { assets, pageAssetIds };
  }

  for (const page of screenshots.pages || []) {
    const pageNumber = page.pageNumber || assets.length + 1;
    const assetId = `${sourceId}:page-${String(pageNumber).padStart(4, "0")}`;
    const renderPath = path.join(assetsDir, sourceId, "pages", `page-${String(pageNumber).padStart(4, "0")}.png`);
    await fs.mkdir(path.dirname(renderPath), { recursive: true });
    await fs.writeFile(renderPath, Buffer.from(page.data));
    pageAssetIds.set(pageNumber, [...(pageAssetIds.get(pageNumber) || []), assetId]);
    assets.push({
      id: assetId,
      sourceId,
      type: "page_render",
      pageNumber,
      path: relativePath(renderPath, outputRoot),
      localPath: path.resolve(renderPath),
      dpi,
      width: page.width || 0,
      height: page.height || 0,
    });
  }

  return { assets, pageAssetIds };
}

async function saveEmbeddedImages(parser, sourceId, assetsDir, outputRoot, pageAssetIds) {
  const assets = [];
  let imageResult;
  try {
    imageResult = await parser.getImage({ imageDataUrl: false, imageBuffer: true });
  } catch {
    return assets;
  }

  for (const page of imageResult.pages || []) {
    const pageNumber = page.pageNumber || 1;
    let imageIndex = 0;
    for (const image of page.images || []) {
      imageIndex += 1;
      if (!image?.data?.length) {
        continue;
      }
      const imageHash = sha256Bytes(Buffer.from(image.data));
      const assetId = `${sourceId}:page-${String(pageNumber).padStart(4, "0")}:image-${String(imageIndex).padStart(2, "0")}`;
      const imagePath = path.join(
        assetsDir,
        sourceId,
        "images",
        `page-${String(pageNumber).padStart(4, "0")}-image-${String(imageIndex).padStart(2, "0")}-${imageHash.slice(0, 10)}.png`,
      );
      await fs.mkdir(path.dirname(imagePath), { recursive: true });
      await fs.writeFile(imagePath, Buffer.from(image.data));
      pageAssetIds.set(pageNumber, [...(pageAssetIds.get(pageNumber) || []), assetId]);
      assets.push({
        id: assetId,
        sourceId,
        type: "embedded_image",
        pageNumber,
        path: relativePath(imagePath, outputRoot),
        localPath: path.resolve(imagePath),
        extension: "png",
        sha256: imageHash,
        width: image.width || 0,
        height: image.height || 0,
        bbox: {},
      });
    }
  }

  return assets;
}

async function ingestPdf(pdfPath, options, seenSourceIds) {
  const resolvedPdf = path.resolve(pdfPath);
  const outputRoot = path.dirname(path.resolve(options.outputPath));
  const assetsRoot = path.resolve(options.assetsDir || path.join(outputRoot, "assets"));
  const sourcesRoot = path.resolve(options.sourcesDir || path.join(outputRoot, "sources"));
  const pdfBuffer = await fs.readFile(resolvedPdf);
  const pdfData = pdfBuffer.buffer.slice(pdfBuffer.byteOffset, pdfBuffer.byteOffset + pdfBuffer.byteLength);
  const parser = new PDFParse({ data: pdfData });

  try {
    const infoResult = await parser.getInfo({ parsePageInfo: true }).catch(() => null);
    const textResult = await parser.getText();
    const info = infoResult?.info || {};
    const title =
      collapseWhitespace(options.title) ||
      metadataValue(info, "Title", "title") ||
      path.basename(resolvedPdf, path.extname(resolvedPdf)).replace(/[-_]+/g, " ");
    const sourceId = sourceIdFor(options.sourceId || title || path.basename(resolvedPdf, path.extname(resolvedPdf)), seenSourceIds);
    const fileHash = await sha256File(resolvedPdf);
    const sourcePdf = {
      originalPath: resolvedPdf,
      sha256: fileHash,
    };

    if (!options.noCopySource) {
      Object.assign(sourcePdf, await copySourcePdf(resolvedPdf, path.join(sourcesRoot, sourceId), outputRoot));
    }

    const source = {
      id: sourceId,
      title,
      sourceType: "pdf",
      importedAt: utcNow(),
      domain: collapseWhitespace(options.domain).toLowerCase(),
      tags: normalizeTags(options.tags || []),
      fileHash,
      pageCount: textResult.total || infoResult?.total || 0,
      metadata: Object.fromEntries(Object.entries(info).filter(([, value]) => value)),
      sourcePdf,
    };

    const rendered = options.noRenderPages
      ? { assets: [], pageAssetIds: new Map() }
      : await savePageRenders(parser, sourceId, assetsRoot, outputRoot, options.dpi || 144);
    const imageAssets = options.noExtractImages
      ? []
      : await saveEmbeddedImages(parser, sourceId, assetsRoot, outputRoot, rendered.pageAssetIds);
    const assets = [...rendered.assets, ...imageAssets];

    const pages = textResult.pages?.length
      ? textResult.pages
      : [{ num: 1, text: textResult.text || "" }];
    const chunks = [];
    for (const page of pages) {
      const pageNumber = page.num || chunks.length + 1;
      const pageText = page.text || "";
      const assetIds = rendered.pageAssetIds.get(pageNumber) || [];
      const captions = captionCandidates(pageText);
      chunkCoreReviewText(pageText, { maxChars: options.maxChars || 1600 }).forEach((chunk, index) => {
        chunks.push({
          id: `${sourceId}:page-${String(pageNumber).padStart(4, "0")}:chunk-${String(index + 1).padStart(3, "0")}`,
          sourceId,
          pageStart: pageNumber,
          pageEnd: pageNumber,
          domain: source.domain,
          tags: source.tags,
          text: chunk,
          textHash: sha256Bytes(chunk),
          assetIds,
          captionCandidates: captions,
          sourceLocator: {
            sourceTitle: title,
            page: pageNumber,
          },
        });
      });
    }

    source.assetCount = assets.length;
    source.chunkCount = chunks.length;
    return { source, assets, chunks };
  } finally {
    await parser.destroy();
  }
}

export async function ingestCoreReviewPdfs(inputPaths, options = {}) {
  const outputPath = path.resolve(options.outputPath);
  const seenSourceIds = new Set();
  const ingested = [];
  for (const inputPath of inputPaths) {
    ingested.push(await ingestPdf(inputPath, { ...options, outputPath }, seenSourceIds));
  }

  const corpus = {
    version: 1,
    kind: "core_review_pdf_corpus",
    createdAt: utcNow(),
    sourceCount: ingested.length,
    assetCount: ingested.reduce((total, item) => total + item.assets.length, 0),
    chunkCount: ingested.reduce((total, item) => total + item.chunks.length, 0),
    sources: ingested.map((item) => item.source),
    assets: ingested.flatMap((item) => item.assets),
    chunks: ingested.flatMap((item) => item.chunks),
  };

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(corpus, null, 2)}\n`, "utf8");
  return {
    outputPath,
    ...corpus,
  };
}
