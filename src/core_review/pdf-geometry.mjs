import fs from "node:fs/promises";
import path from "node:path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import sharp from "sharp";
import { collapseWhitespace } from "../utils.mjs";

const CAPTION_PATTERN =
  /^(?:fig(?:ure)?\.?\s*([a-z]?\d+[a-z]?)|image\s*([a-z]?\d+[a-z]?))\b[:.)\-\s]*/i;

function numberOrNull(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function captionNumber(value) {
  const match = String(value || "").match(CAPTION_PATTERN);
  if (!match) {
    return null;
  }
  const raw = match.slice(1).find(Boolean) || "";
  return numberOrNull(raw.replace(/^\D+/, ""));
}

function isCaptionLine(text) {
  return CAPTION_PATTERN.test(collapseWhitespace(text));
}

function isCaptionContinuationNoise(text) {
  return /\b(?:doi|cureus|copyright|creative commons|how to cite|submitted|published|review began|review ended)\b/i.test(
    collapseWhitespace(text),
  );
}

function extendedCaptionForLine(page, captionLine) {
  const lines = Array.isArray(page?.lines) ? page.lines : [];
  const pieces = [captionLine.text];
  let previousBottom = captionLine.bbox?.bottom || 0;

  for (const line of lines) {
    if (line.index <= captionLine.index) {
      continue;
    }
    const text = collapseWhitespace(line.text);
    if (!text || line.isCaption || isCaptionContinuationNoise(text)) {
      break;
    }
    const verticalGap = Math.max(0, (line.bbox?.top || 0) - previousBottom);
    if (verticalGap > 36 || pieces.join(" ").length > 420) {
      break;
    }
    pieces.push(text);
    previousBottom = line.bbox?.bottom || previousBottom;
  }

  return collapseWhitespace(pieces.join(" "));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function bboxFromTextItem(item, viewport) {
  const transform = Array.isArray(item?.transform) ? item.transform : [];
  const x = Number(transform[4]);
  const y = Number(transform[5]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }

  const width = Math.max(0, Number(item.width) || 0);
  const rawHeight =
    Math.abs(Number(item.height) || 0) ||
    Math.abs(Number(transform[3]) || 0) ||
    10;
  const [leftX, baselineY] = viewport.convertToViewportPoint(x, y);
  const [rightX] = viewport.convertToViewportPoint(x + width, y);
  const left = clamp(Math.min(leftX, rightX), 0, viewport.width);
  const right = clamp(Math.max(leftX, rightX), 0, viewport.width);
  const top = clamp(baselineY - rawHeight, 0, viewport.height);
  const bottom = clamp(baselineY + rawHeight * 0.25, 0, viewport.height);
  if (right <= left || bottom <= top) {
    return null;
  }
  return { left, top, right, bottom };
}

function mergeLineItems(items) {
  const sorted = [...items].sort(
    (left, right) =>
      left.bbox.top - right.bbox.top || left.bbox.left - right.bbox.left,
  );
  const lines = [];
  const yTolerance = 5;

  for (const item of sorted) {
    const centerY = (item.bbox.top + item.bbox.bottom) / 2;
    let line = lines.find(
      (candidate) => Math.abs(candidate.centerY - centerY) <= yTolerance,
    );
    if (!line) {
      line = {
        centerY,
        items: [],
        bbox: { ...item.bbox },
      };
      lines.push(line);
    }
    line.items.push(item);
    line.bbox.left = Math.min(line.bbox.left, item.bbox.left);
    line.bbox.top = Math.min(line.bbox.top, item.bbox.top);
    line.bbox.right = Math.max(line.bbox.right, item.bbox.right);
    line.bbox.bottom = Math.max(line.bbox.bottom, item.bbox.bottom);
    line.centerY = (line.bbox.top + line.bbox.bottom) / 2;
  }

  return lines
    .map((line, index) => {
      const itemsByX = line.items.sort(
        (left, right) => left.bbox.left - right.bbox.left,
      );
      const text = collapseWhitespace(
        itemsByX.map((item) => item.text).join(" "),
      );
      return {
        index,
        text,
        bbox: line.bbox,
        centerY: line.centerY,
      };
    })
    .filter((line) => line.text)
    .sort((left, right) => left.bbox.top - right.bbox.top);
}

function geometryTextFromLines(lines) {
  return lines.map((line) => line.text).join("\n");
}

export async function extractPdfGeometry(pdfBuffer) {
  const data =
    pdfBuffer instanceof Uint8Array
      ? new Uint8Array(
          pdfBuffer.buffer.slice(
            pdfBuffer.byteOffset,
            pdfBuffer.byteOffset + pdfBuffer.byteLength,
          ),
        )
      : new Uint8Array(pdfBuffer);
  const loadingTask = getDocument({
    data,
    disableWorker: true,
    useSystemFonts: true,
  });
  const document = await loadingTask.promise;

  try {
    const pages = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const textContent = await page.getTextContent({
        includeMarkedContent: true,
        disableNormalization: false,
      });
      const items = (textContent.items || [])
        .filter((item) => collapseWhitespace(item?.str))
        .map((item) => {
          const bbox = bboxFromTextItem(item, viewport);
          return bbox
            ? {
                text: collapseWhitespace(item.str),
                bbox,
              }
            : null;
        })
        .filter(Boolean);
      const lines = mergeLineItems(items).map((line, index) => ({
        ...line,
        index,
        isCaption: isCaptionLine(line.text),
        captionNumber: captionNumber(line.text),
      }));

      pages.push({
        num: pageNumber,
        pageNumber,
        width: viewport.width,
        height: viewport.height,
        text: geometryTextFromLines(lines),
        lines,
      });
    }
    return { pageCount: document.numPages, pages };
  } finally {
    await document.destroy();
  }
}

function contentBounds(lines, pageWidth) {
  const useful = lines.filter((line) => line.text && line.bbox);
  if (!useful.length) {
    return {
      left: pageWidth * 0.08,
      right: pageWidth * 0.92,
    };
  }
  return {
    left: Math.max(0, Math.min(...useful.map((line) => line.bbox.left)) - 16),
    right: Math.min(
      pageWidth,
      Math.max(...useful.map((line) => line.bbox.right)) + 16,
    ),
  };
}

function cropBoxForCaption(page, captionLine) {
  const bounds = contentBounds(page.lines, page.width);
  const captionTop = captionLine.bbox.top;
  const captionHeight = captionLine.bbox.bottom - captionLine.bbox.top;
  const minHeight = Math.max(72, page.height * 0.12);
  const maxHeight = Math.max(minHeight, page.height * 0.42);
  const aboveLines = page.lines.filter(
    (line) =>
      line.index !== captionLine.index &&
      line.bbox.bottom < captionTop - Math.max(8, captionHeight),
  );
  const previousTextBottom = aboveLines.length
    ? Math.max(...aboveLines.map((line) => line.bbox.bottom))
    : 0;
  const bottom = clamp(captionTop - 4, 1, page.height);
  let top = clamp(previousTextBottom + 8, 0, bottom - 1);
  if (bottom - top < minHeight) {
    top = clamp(bottom - maxHeight, 0, bottom - minHeight);
  }

  return {
    left: bounds.left,
    top,
    right: bounds.right,
    bottom,
  };
}

function pixelCropFromPageBox(box, page, renderAsset) {
  const scaleX = Number(renderAsset.width) / Math.max(1, Number(page.width));
  const scaleY = Number(renderAsset.height) / Math.max(1, Number(page.height));
  const left = Math.floor(clamp(box.left * scaleX, 0, renderAsset.width - 1));
  const top = Math.floor(clamp(box.top * scaleY, 0, renderAsset.height - 1));
  const right = Math.ceil(clamp(box.right * scaleX, left + 1, renderAsset.width));
  const bottom = Math.ceil(clamp(box.bottom * scaleY, top + 1, renderAsset.height));
  return {
    left,
    top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
  };
}

function relativePath(filePath, root) {
  const resolved = path.resolve(filePath);
  const resolvedRoot = path.resolve(root);
  const relative = path.relative(resolvedRoot, resolved);
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative)
    ? relative.split(path.sep).join("/")
    : resolved;
}

export async function savePdfFigureCrops({
  geometryPages,
  pageRenderAssets,
  sourceId,
  assetsDir,
  outputRoot,
}) {
  const assets = [];
  const rendersByPage = new Map(
    (pageRenderAssets || [])
      .filter((asset) => asset?.type === "page_render" && asset.localPath)
      .map((asset) => [Number(asset.pageNumber), asset]),
  );

  for (const page of geometryPages || []) {
    const renderAsset = rendersByPage.get(Number(page.pageNumber || page.num));
    if (!renderAsset?.localPath || !renderAsset.width || !renderAsset.height) {
      continue;
    }
    const captions = (page.lines || []).filter((line) => line.isCaption);
    let figureIndex = 0;
    for (const caption of captions) {
      figureIndex += 1;
      const captionText = extendedCaptionForLine(page, caption);
      const box = cropBoxForCaption(page, caption);
      const pixelCrop = pixelCropFromPageBox(box, page, renderAsset);
      if (pixelCrop.width < 40 || pixelCrop.height < 40) {
        continue;
      }
      const assetId = `${sourceId}:page-${String(page.pageNumber).padStart(4, "0")}:figure-${String(figureIndex).padStart(2, "0")}`;
      const cropPath = path.join(
        assetsDir,
        sourceId,
        "figures",
        `page-${String(page.pageNumber).padStart(4, "0")}-figure-${String(figureIndex).padStart(2, "0")}.png`,
      );
      await fs.mkdir(path.dirname(cropPath), { recursive: true });
      await sharp(renderAsset.localPath).extract(pixelCrop).png().toFile(cropPath);
      assets.push({
        id: assetId,
        sourceId,
        type: "figure_crop",
        layoutRole: "caption_region_crop",
        pageNumber: page.pageNumber,
        figureIndex,
        captionNumber: caption.captionNumber,
        caption: captionText,
        captionLineIndex: caption.index,
        cropSourceAssetId: renderAsset.id,
        path: relativePath(cropPath, outputRoot),
        localPath: path.resolve(cropPath),
        extension: "png",
        width: pixelCrop.width,
        height: pixelCrop.height,
        bbox: box,
        locator: {
          page: page.pageNumber,
          pageNumber: page.pageNumber,
          bbox: box,
          caption: captionText,
          captionLineIndex: caption.index,
          cropSourceAssetId: renderAsset.id,
        },
        confidence: 0.9,
        confidenceSource: "pdf_geometry_v1",
      });
    }
  }

  return assets;
}
