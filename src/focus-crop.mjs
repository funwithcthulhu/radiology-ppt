import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { canonicalCropMode, canonicalMarkupStyle } from "./request-parser.mjs";

function clamp(value, lower, upper) {
  return Math.max(lower, Math.min(upper, value));
}

function cropConfig(cropMode) {
  switch (canonicalCropMode(cropMode)) {
    case "tighter":
      return { spreadScale: 3.0, minFraction: 0.34, lowerFraction: 0.32, upperFraction: 0.78 };
    case "wider":
      return { spreadScale: 5.1, minFraction: 0.58, lowerFraction: 0.48, upperFraction: 0.96 };
    default:
      return { spreadScale: 4.0, minFraction: 0.48, lowerFraction: 0.42, upperFraction: 0.9 };
  }
}

function normalizeCoordinate(value, dimension) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  if (numeric >= 0 && numeric <= 1) {
    return numeric * dimension;
  }
  return numeric;
}

function normalizeFocusPoints(points, width, height) {
  if (!Array.isArray(points)) {
    return [];
  }

  return points
    .map((point) => ({
      x: normalizeCoordinate(point?.x, width),
      y: normalizeCoordinate(point?.y, height),
      kind: point?.kind || "focus",
    }))
    .filter((point) => point.x !== null && point.y !== null)
    .map((point) => ({
      ...point,
      x: clamp(point.x, 0, width),
      y: clamp(point.y, 0, height),
    }));
}

export function focusCropBounds(width, height, points, cropMode = "default") {
  const normalizedPoints = normalizeFocusPoints(points, width, height);
  if (!normalizedPoints.length) {
    return { left: 0, top: 0, width, height };
  }

  const xs = normalizedPoints.map((point) => point.x);
  const ys = normalizedPoints.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const spreadX = Math.max(20, maxX - minX);
  const spreadY = Math.max(20, maxY - minY);
  const config = cropConfig(cropMode);
  const targetWidth = clamp(
    Math.max(spreadX * config.spreadScale, width * config.minFraction),
    width * config.lowerFraction,
    width * config.upperFraction,
  );
  const targetHeight = clamp(
    Math.max(spreadY * config.spreadScale, height * config.minFraction),
    height * config.lowerFraction,
    height * config.upperFraction,
  );

  const left = clamp(centerX - targetWidth / 2, 0, Math.max(0, width - targetWidth));
  const top = clamp(centerY - targetHeight / 2, 0, Math.max(0, height - targetHeight));
  return {
    left: Math.round(left),
    top: Math.round(top),
    width: Math.max(1, Math.round(targetWidth)),
    height: Math.max(1, Math.round(targetHeight)),
  };
}

function focusRingSvg(width, height, points) {
  const radius = Math.max(18, Math.round(Math.min(width, height) * 0.055));
  const outerRadius = Math.round(radius * 1.24);
  const outerWidth = Math.max(2, Math.round(radius * 0.08));
  const innerWidth = Math.max(2, Math.round(radius * 0.05));
  const rings = points
    .map(
      (point) => `
        <circle cx="${point.x}" cy="${point.y}" r="${outerRadius}" fill="none" stroke="#0f3d54" stroke-opacity="0.69" stroke-width="${outerWidth}" />
        <circle cx="${point.x}" cy="${point.y}" r="${radius}" fill="none" stroke="#ffffff" stroke-opacity="0.89" stroke-width="${innerWidth}" />
      `,
    )
    .join("");

  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${rings}</svg>`,
  );
}

function outputPipeline(pipeline, outputPath) {
  const extension = path.extname(outputPath).toLowerCase();
  if (extension === ".jpg" || extension === ".jpeg") {
    return pipeline.jpeg({ quality: 95 }).toFile(outputPath);
  }
  if (extension === ".png") {
    return pipeline.png({ compressionLevel: 6 }).toFile(outputPath);
  }
  return pipeline.toFile(outputPath);
}

export async function focusCropImage(imagePath, focusPoints, options = {}) {
  const normalizedCropMode = canonicalCropMode(options.cropMode || "default");
  const normalizedMarkupStyle = canonicalMarkupStyle(options.markupStyle || "none");
  const baseImage = sharp(imagePath, { failOn: "none" });
  const metadata = await baseImage.metadata();
  const width = metadata.width;
  const height = metadata.height;
  if (!width || !height) {
    return imagePath;
  }

  const points = normalizeFocusPoints(focusPoints, width, height);
  if (!points.length) {
    return imagePath;
  }

  const extension = path.extname(imagePath) || ".jpg";
  const variant = [normalizedCropMode, normalizedMarkupStyle]
    .filter((value) => value && value !== "default" && value !== "none")
    .join("-");
  const outputPath = imagePath.replace(
    new RegExp(`${extension.replace(".", "\\.")}$`),
    `-focus${variant ? `-${variant}` : ""}${extension}`,
  );

  try {
    await fs.access(outputPath);
    return outputPath;
  } catch {
    // Missing focused variants are created below.
  }

  const bounds = focusCropBounds(width, height, points, normalizedCropMode);
  const composites =
    normalizedMarkupStyle === "focus-ring"
      ? [{ input: focusRingSvg(width, height, points), left: 0, top: 0 }]
      : [];

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  let pipeline = sharp(imagePath, { failOn: "none" }).rotate();
  if (composites.length) {
    pipeline = pipeline.composite(composites);
  }
  pipeline = pipeline
    .extract(bounds)
    .resize(width, height, { fit: "fill" });
  await outputPipeline(pipeline, outputPath);
  return outputPath;
}
