import fs from "node:fs/promises";
import path from "node:path";
import pptxgen from "pptxgenjs";
import sharp from "sharp";
import { collapseWhitespace, dedupe } from "./utils.mjs";

const SHAPE_TYPES = new pptxgen().ShapeType;
const W = 1280;
const H = 720;
const SLIDE_W = 13.333333;
const SLIDE_H = 7.5;
const SX = SLIDE_W / W;
const SY = SLIDE_H / H;
const TRANSPARENT = "#00000000";
const CORE_REVIEW_MARKER_COLOR = "#D4AF37";
const DECK_MODES = {
  caseConference: "case-conference",
  coreReview: "core-review",
};

const THEMES = {
  classic: {
    fonts: {
      title: "Aptos Display",
      body: "Aptos",
      mono: "Aptos Mono",
    },
    colors: {
      white: "#FFFFFF",
      ink: "#102132",
      slate: "#4E6272",
      border: "#D7E2EC",
      accent: "#0D9488",
      accentDark: "#0F3D54",
      dark: "#122537",
      darker: "#0A121B",
      panel: "#ECF5F8",
      footerDark: "#C8D7E2",
      footerLight: "#6F8292",
      caseBg: "#FFFFFF",
      diagnosisBg: "#FFFFFF",
      teachingBg: "#F5FAFC",
      imageBg: "#0A121B",
    },
  },
  "clean-light": {
    fonts: {
      title: "Aptos Display",
      body: "Aptos",
      mono: "Aptos Mono",
    },
    colors: {
      white: "#FFFFFF",
      ink: "#12212E",
      slate: "#5F7483",
      border: "#DDE7ED",
      accent: "#187A6E",
      accentDark: "#15455C",
      dark: "#F2F7F9",
      darker: "#E7EFF4",
      panel: "#FFFFFF",
      footerDark: "#617684",
      footerLight: "#6F8292",
      caseBg: "#FCFEFF",
      diagnosisBg: "#FFFFFF",
      teachingBg: "#F6FBF7",
      imageBg: "#E7EFF4",
    },
  },
  "conference-dark": {
    fonts: {
      title: "Aptos Display",
      body: "Aptos",
      mono: "Aptos Mono",
    },
    colors: {
      white: "#F7FBFF",
      ink: "#E9F1F7",
      slate: "#A8BECC",
      border: "#355267",
      accent: "#4CC9B0",
      accentDark: "#8AE8D4",
      dark: "#0A1622",
      darker: "#050C14",
      panel: "#132435",
      footerDark: "#94AFC2",
      footerLight: "#A7BBCB",
      caseBg: "#0A1622",
      diagnosisBg: "#0D1B2A",
      teachingBg: "#102031",
      imageBg: "#040B11",
    },
  },
  "teaching-warm": {
    fonts: {
      title: "Aptos Display",
      body: "Aptos",
      mono: "Aptos Mono",
    },
    colors: {
      white: "#FFFDF9",
      ink: "#2C2117",
      slate: "#7F6A59",
      border: "#E7DACA",
      accent: "#C26A32",
      accentDark: "#7F3B12",
      dark: "#5F2E12",
      darker: "#3B1D0C",
      panel: "#FFF3E7",
      footerDark: "#E9D7C8",
      footerLight: "#826B5A",
      caseBg: "#FFFDF9",
      diagnosisBg: "#FFF9F1",
      teachingBg: "#FFF5EA",
      imageBg: "#3B1D0C",
    },
  },
};

function resolveTheme(themeName = "classic") {
  return THEMES[themeName] || THEMES.classic;
}

function resolveDeckMode(deckMode = DECK_MODES.caseConference) {
  const normalized = String(deckMode || "").trim().toLowerCase();
  if (normalized === DECK_MODES.coreReview || normalized === "core") {
    return DECK_MODES.coreReview;
  }
  return DECK_MODES.caseConference;
}

function cleanColor(color) {
  return String(color || "#FFFFFF").replace(/^#/, "").slice(0, 6).padEnd(6, "0");
}

function isTransparent(color) {
  const text = String(color || "").toLowerCase();
  const hex = text.replace(/^#/, "");
  return !text || text === TRANSPARENT.toLowerCase() || (hex.length === 8 && hex.endsWith("00"));
}

function fillOption(color) {
  return isTransparent(color)
    ? { color: "FFFFFF", transparency: 100 }
    : { color: cleanColor(color) };
}

function lineOption(color, width = 0) {
  return width > 0 && !isTransparent(color)
    ? { color: cleanColor(color), width }
    : { color: "FFFFFF", transparency: 100, width: 0 };
}

function pos(position) {
  return {
    x: (position.left || 0) * SX,
    y: (position.top || 0) * SY,
    w: (position.width || 0) * SX,
    h: (position.height || 0) * SY,
  };
}

function addShape(slide, geometry, position, fill = TRANSPARENT, stroke = TRANSPARENT, strokeWidth = 0) {
  const shapeType = SHAPE_TYPES[geometry] || geometry;
  slide.addShape(shapeType, {
    ...pos(position),
    fill: fillOption(fill),
    line: lineOption(stroke, strokeWidth),
  });
}

function addText(
  slide,
  text,
  position,
  theme,
  {
    fontSize = 22,
    color,
    bold = false,
    face,
    fill = TRANSPARENT,
    stroke = TRANSPARENT,
    strokeWidth = 0,
    align = "left",
    verticalAlignment = "top",
    autoFit = "shrinkText",
  } = {},
) {
  slide.addText(String(text ?? ""), {
    ...pos(position),
    fontSize,
    color: cleanColor(color || theme.colors.ink),
    bold,
    fontFace: face || theme.fonts.body,
    align,
    valign: verticalAlignment === "center" ? "middle" : verticalAlignment,
    margin: 0,
    fit: autoFit ? "shrink" : "none",
    fill: fillOption(fill),
    line: lineOption(stroke, strokeWidth),
  });
}

async function containedImageFrame(imagePath, position) {
  const frame = pos(position);
  try {
    const metadata = await sharp(imagePath).metadata();
    if (!metadata.width || !metadata.height || frame.w <= 0 || frame.h <= 0) {
      return frame;
    }

    const imageRatio = metadata.width / metadata.height;
    const frameRatio = frame.w / frame.h;
    if (imageRatio >= frameRatio) {
      const h = frame.w / imageRatio;
      return {
        x: frame.x,
        y: frame.y + (frame.h - h) / 2,
        w: frame.w,
        h,
      };
    }

    const w = frame.h * imageRatio;
    return {
      x: frame.x + (frame.w - w) / 2,
      y: frame.y,
      w,
      h: frame.h,
    };
  } catch {
    return frame;
  }
}

async function addImage(slide, imagePath, position, alt) {
  const frame = await containedImageFrame(imagePath, position);
  slide.addImage({
    path: imagePath,
    ...frame,
    altText: alt,
  });
  return frame;
}

function hashSeed(value) {
  let hash = 2166136261;
  for (const char of String(value || "core-review")) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededRandom(seed) {
  let state = hashSeed(seed);
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(items, seed) {
  const random = seededRandom(seed);
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

function addTopBar(slide, title, theme, { dark = true } = {}) {
  const fill = dark ? theme.colors.dark : theme.colors.white;
  const textColor = dark ? theme.colors.white : theme.colors.ink;
  addShape(slide, "rect", { left: 0, top: 0, width: W, height: 52 }, fill, TRANSPARENT, 0);
  addText(
    slide,
    title,
    { left: 42, top: 16, width: 900, height: 22 },
    theme,
    {
      fontSize: 16,
      color: textColor,
      face: theme.fonts.mono,
      bold: true,
      autoFit: null,
    },
  );
}

function addFooter(slide, text, theme, { dark = false } = {}) {
  addText(
    slide,
    text,
    { left: 36, top: 694, width: 1208, height: 14 },
    theme,
    {
      fontSize: 9,
      color: dark ? theme.colors.footerDark : theme.colors.footerLight,
      face: theme.fonts.body,
      autoFit: null,
    },
  );
}

function truncateText(value, maxLength) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}.`;
}

function truncateAtSentence(value, maxLength) {
  const text = normalizeText(value);
  if (text.length <= maxLength) {
    return text;
  }

  const sentences = text.match(/[^.!?]+[.!?]+/g) || [];
  let output = "";
  for (const sentence of sentences) {
    const candidate = normalizeText(`${output} ${sentence}`);
    if (candidate.length > maxLength) {
      break;
    }
    output = candidate;
  }

  if (output) {
    return output;
  }

  const clipped = text.slice(0, maxLength).replace(/\s+\S*$/, "").trim();
  return clipped ? `${clipped}.` : "";
}

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function optionId(index) {
  return String.fromCharCode(65 + index);
}

function domainLabel(domain) {
  const normalized = String(domain || "").trim().toLowerCase();
  const labels = {
    nis: "NIS",
    physics: "Physics",
    msk: "MSK",
    gu: "GU",
    gi: "GI",
    ir: "IR",
    mr: "MR",
    ct: "CT",
    risc: "RISC",
    neuro: "Neuro",
    thoracic: "Thoracic",
    pediatric: "Pediatrics",
    cardiovascular: "Cardiovascular",
    nuclear: "Nuclear",
    breast: "Breast",
    ultrasound: "Ultrasound",
    radiography_fluoroscopy: "Radiography/Fluoroscopy",
  };
  if (labels[normalized]) {
    return labels[normalized];
  }
  return normalized
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((piece) => piece[0].toUpperCase() + piece.slice(1))
    .join(" ");
}

function boundedImageLayouts(count, bounds) {
  const gap = 20;
  if (count <= 0) {
    return [];
  }
  if (count === 1) {
    return [bounds];
  }
  if (count === 2) {
    const width = (bounds.width - gap) / 2;
    return [
      { left: bounds.left, top: bounds.top, width, height: bounds.height },
      { left: bounds.left + width + gap, top: bounds.top, width, height: bounds.height },
    ];
  }
  if (count === 3) {
    const width = (bounds.width - gap * 2) / 3;
    return [
      { left: bounds.left, top: bounds.top, width, height: bounds.height },
      { left: bounds.left + width + gap, top: bounds.top, width, height: bounds.height },
      { left: bounds.left + (width + gap) * 2, top: bounds.top, width, height: bounds.height },
    ];
  }

  const width = (bounds.width - gap) / 2;
  const height = (bounds.height - gap) / 2;
  return [
    { left: bounds.left, top: bounds.top, width, height },
    { left: bounds.left + width + gap, top: bounds.top, width, height },
    { left: bounds.left, top: bounds.top + height + gap, width, height },
    { left: bounds.left + width + gap, top: bounds.top + height + gap, width, height },
  ].slice(0, count);
}

function toNormalizedUnit(value, size) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return NaN;
  }
  if (numeric <= 1 || !Number.isFinite(size) || size <= 1) {
    return numeric;
  }
  return numeric / size;
}

function normalizeHotspot(hotspot, imageMeta = {}) {
  if (!hotspot || typeof hotspot !== "object") {
    return null;
  }

  const imageWidth = Number(
    imageMeta.width ?? imageMeta.frameWidth ?? imageMeta.naturalWidth ?? imageMeta.pixelWidth,
  );
  const imageHeight = Number(
    imageMeta.height ?? imageMeta.frameHeight ?? imageMeta.naturalHeight ?? imageMeta.pixelHeight,
  );
  const x = toNormalizedUnit(hotspot.x ?? hotspot.left, imageWidth);
  const y = toNormalizedUnit(hotspot.y ?? hotspot.top, imageHeight);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }

  const radius = Number(hotspot.radius);
  if (Number.isFinite(radius)) {
    return {
      x,
      y,
      radius: toNormalizedUnit(radius, Math.max(imageWidth, imageHeight)),
    };
  }

  const width = toNormalizedUnit(hotspot.width, imageWidth);
  const height = toNormalizedUnit(hotspot.height, imageHeight);
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    return null;
  }

  return {
    x,
    y,
    width,
    height,
  };
}

function hotspotCenter(hotspot) {
  if (!hotspot) {
    return null;
  }
  const x = Number(hotspot.x);
  const y = Number(hotspot.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }
  if (Number.isFinite(Number(hotspot.radius))) {
    return { x, y };
  }

  const width = Number(hotspot.width);
  const height = Number(hotspot.height);
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    return null;
  }

  return {
    x: x + width / 2,
    y: y + height / 2,
  };
}

function markerDiameter(imageFrame, hotspot) {
  const minDimension = Math.max(0.18, Math.min(imageFrame.w, imageFrame.h));
  const radius = Number(hotspot?.radius);
  if (Number.isFinite(radius) && radius > 0) {
    return Math.max(0.24, minDimension * radius * 2.2);
  }
  const width = Number(hotspot?.width);
  const height = Number(hotspot?.height);
  if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
    return Math.max(0.24, minDimension * Math.max(width, height) * 1.4);
  }
  return Math.max(0.24, minDimension * 0.08);
}

function addMarkerOverlay(slide, imageFrame, hotspot, color = CORE_REVIEW_MARKER_COLOR) {
  const center = hotspotCenter(hotspot);
  if (!center) {
    return;
  }

  const markerX = imageFrame.x + imageFrame.w * center.x;
  const markerY = imageFrame.y + imageFrame.h * center.y;
  const diameter = markerDiameter(imageFrame, hotspot);
  slide.addShape(SHAPE_TYPES.ellipse, {
    x: markerX - diameter / 2,
    y: markerY - diameter / 2,
    w: diameter,
    h: diameter,
    fill: fillOption(TRANSPARENT),
    line: { color: cleanColor(color), width: 2.2 },
  });
  slide.addShape(SHAPE_TYPES.ellipse, {
    x: markerX - diameter / 8,
    y: markerY - diameter / 8,
    w: diameter / 4,
    h: diameter / 4,
    fill: fillOption(color),
    line: { color: cleanColor(color), width: 0.8 },
  });
}

function imageLocalPath(image) {
  return collapseWhitespace(image?.localPath || image?.path || "");
}

function imageAltText(image, fallback) {
  return collapseWhitespace(image?.label || image?.series || image?.alt || fallback);
}

async function addImageGallery(slide, images, bounds, { marker = null, emptyMessage = "" } = {}) {
  const layouts = boundedImageLayouts(images.length, bounds);
  if (!layouts.length) {
    if (emptyMessage) {
      addText(
        slide,
        emptyMessage,
        {
          left: bounds.left,
          top: bounds.top + bounds.height / 2 - 24,
          width: bounds.width,
          height: 48,
        },
        resolveTheme("classic"),
        {
          fontSize: 28,
          color: "#A8BECC",
          align: "center",
          verticalAlignment: "center",
          autoFit: null,
        },
      );
    }
    return [];
  }

  const frames = [];
  for (let index = 0; index < layouts.length; index += 1) {
    const image = images[index];
    const frame = layouts[index];
    const localPath = imageLocalPath(image);
    if (!localPath) {
      continue;
    }

    addShape(slide, "rect", frame, "#000000", TRANSPARENT, 0);
    const actualFrame = await addImage(
      slide,
      localPath,
      frame,
      imageAltText(image, `Review image ${index + 1}`),
    );
    frames.push({ image, frame: actualFrame });

    if (marker && localPath === imageLocalPath(marker.image)) {
      addMarkerOverlay(slide, actualFrame, marker.hotspot);
    }
  }

  return frames;
}

function patientAgeIntro(age) {
  const text = normalizeText(age).replace(/[.;:,]+$/g, "");
  if (!text) {
    return "";
  }
  const numericOnly = /^(\d+(?:\.\d+)?)$/.exec(text);
  if (numericOnly) {
    return `${numericOnly[1]}-year-old`;
  }

  const unitMatch = /^(\d+(?:\.\d+)?)\s*(years?|yrs?|y|months?|mos?|m|weeks?|wks?|w|days?|d)(?:\s*old)?$/i.exec(text);
  if (unitMatch) {
    const unitMap = {
      y: "year",
      yr: "year",
      yrs: "year",
      year: "year",
      years: "year",
      m: "month",
      mo: "month",
      mos: "month",
      month: "month",
      months: "month",
      w: "week",
      wk: "week",
      wks: "week",
      week: "week",
      weeks: "week",
      d: "day",
      day: "day",
      days: "day",
    };
    return `${unitMatch[1]}-${unitMap[unitMatch[2].toLowerCase()] || unitMatch[2].toLowerCase()}-old`;
  }

  if (/^(adult|pediatric|paediatric|neonatal|infant|child|adolescent|elderly)$/i.test(text)) {
    return text.toLowerCase().replace("paediatric", "pediatric");
  }
  return "";
}

function patientGenderIntro(gender) {
  const text = normalizeText(gender).replace(/[.;:,]+$/g, "").toLowerCase();
  if (/^m(?:ale)?$/.test(text)) {
    return "male";
  }
  if (/^f(?:emale)?$/.test(text)) {
    return "female";
  }
  return "";
}

function articleForPhrase(phrase) {
  return /^(?:8|11|18|adult|elderly|infant|adolescent|[aeiou])/i.test(phrase) ? "an" : "a";
}

function demographicIntro(caseData) {
  const patientData = caseData.patientData || {};
  const age = patientAgeIntro(patientData.age);
  const gender = patientGenderIntro(patientData.gender);
  if (age && gender) {
    return `The patient is ${articleForPhrase(age)} ${age} ${gender}.`;
  }
  if (age) {
    return `The patient is ${articleForPhrase(age)} ${age} patient.`;
  }
  if (gender) {
    return `The patient is ${gender}.`;
  }
  return "";
}

function safeCaseIntro(caseData) {
  const fromPatientData = demographicIntro(caseData);
  if (fromPatientData) {
    return fromPatientData;
  }

  const existing = normalizeText(caseData.caseIntro);
  const allowedPattern =
    /^The patient is (?:(?:a|an) (?:(?:\d+(?:\.\d+)?-(?:year|month|week|day)-old|adult|pediatric|neonatal|infant|child|adolescent|elderly)(?: (?:male|female|patient))?|(?:male|female))|(?:male|female))\.$/i;
  return allowedPattern.test(existing) ? existing : "";
}

function addSpeakerNotes(slide, caseData, caseNumber, extras = []) {
  slide.addNotes(
    [
      `Case ${caseNumber}`,
      `Requested: ${caseData.rawInput}`,
      `Diagnosis query: ${caseData.diagnosisQuery}`,
      caseData.studyHint ? `Study hint: ${caseData.studyHint}` : null,
      `Radiopaedia case: ${caseData.caseTitle}`,
      `URL: ${caseData.caseUrl}`,
      `Author: ${caseData.author || "Unknown"}`,
      `License: ${caseData.licenseName}`,
      `Reference: ${caseData.rid}`,
      ...extras,
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

function imageLayouts(count) {
  if (count <= 0) {
    return [];
  }
  if (count <= 1) {
    return [{ left: 50, top: 70, width: 1180, height: 610 }];
  }
  if (count === 2) {
    return [
      { left: 50, top: 70, width: 565, height: 610 },
      { left: 665, top: 70, width: 565, height: 610 },
    ];
  }
  if (count === 3) {
    return [
      { left: 42, top: 76, width: 384, height: 592 },
      { left: 448, top: 76, width: 384, height: 592 },
      { left: 854, top: 76, width: 384, height: 592 },
    ];
  }
  return [
    { left: 44, top: 76, width: 578, height: 280 },
    { left: 658, top: 76, width: 578, height: 280 },
    { left: 44, top: 386, width: 578, height: 280 },
    { left: 658, top: 386, width: 578, height: 280 },
  ].slice(0, count);
}

function addCaseSlide(slide, caseData, caseNumber, deckTitle, theme) {
  slide.background = { color: cleanColor(theme.colors.caseBg) };
  addTopBar(slide, deckTitle, theme, { dark: theme === THEMES["conference-dark"] });
  const caseIntro = safeCaseIntro(caseData);

  addText(
    slide,
    `Case ${caseNumber}`,
    { left: 82, top: 180, width: 520, height: 116 },
    theme,
    {
      fontSize: 92,
      color: theme.colors.ink,
      face: theme.fonts.title,
      bold: true,
      autoFit: null,
    },
  );

  if (caseIntro) {
    addText(
      slide,
      caseIntro,
      { left: 88, top: 326, width: 780, height: 48 },
      theme,
      {
        fontSize: 30,
        color: theme.colors.accentDark,
        face: theme.fonts.body,
        autoFit: null,
      },
    );
  }

  addShape(slide, "rect", { left: 84, top: 406, width: 420, height: 4 }, theme.colors.accent, TRANSPARENT, 0);
  addFooter(slide, `Case ${caseNumber}${caseIntro ? ` • ${caseIntro}` : ""}`, theme);
  addSpeakerNotes(slide, caseData, caseNumber);
}

async function addImagesSlide(slide, caseData, caseNumber, deckTitle, theme) {
  slide.background = { color: cleanColor(theme.colors.imageBg) };
  addTopBar(slide, deckTitle, theme, { dark: true });
  const caseIntro = safeCaseIntro(caseData);

  addText(
    slide,
    `Case ${caseNumber}`,
    { left: 44, top: 56, width: 180, height: 18 },
    theme,
    {
      fontSize: 12,
      color: theme.colors.footerDark,
      face: theme.fonts.mono,
      bold: true,
      autoFit: null,
    },
  );

  if (caseIntro) {
    addText(
      slide,
      truncateText(caseIntro, 92),
      { left: 630, top: 57, width: 604, height: 14 },
      theme,
      {
        fontSize: 10,
        color: theme.colors.footerDark,
        face: theme.fonts.mono,
        align: "right",
        autoFit: "shrinkText",
      },
    );
  }

  const layouts = imageLayouts(caseData.images.length);
  if (!layouts.length) {
    addText(
      slide,
      "No selected images for this case.",
      { left: 50, top: 316, width: 1180, height: 60 },
      theme,
      {
        fontSize: 28,
        color: theme.colors.footerDark,
        face: theme.fonts.body,
        align: "center",
        verticalAlignment: "center",
        autoFit: null,
      },
    );
  }

  for (let index = 0; index < layouts.length; index += 1) {
    const frame = layouts[index];
    const image = caseData.images[index];
    if (!image?.localPath) {
      continue;
    }

    addShape(slide, "rect", frame, "#000000", TRANSPARENT, 0);
    await addImage(
      slide,
      image.localPath,
      frame,
      image.label || `Case ${caseNumber} image ${index + 1}`,
    );
  }

  addFooter(slide, caseData.footerText, theme, { dark: true });
  addSpeakerNotes(slide, caseData, caseNumber);
}

function addDiagnosisSlide(slide, caseData, caseNumber, deckTitle, theme) {
  slide.background = { color: cleanColor(theme.colors.diagnosisBg) };
  addTopBar(slide, deckTitle, theme, { dark: theme === THEMES["conference-dark"] });

  addText(
    slide,
    `Case ${caseNumber}`,
    { left: 82, top: 102, width: 220, height: 22 },
    theme,
    {
      fontSize: 13,
      color: theme.colors.accentDark,
      face: theme.fonts.mono,
      bold: true,
      autoFit: null,
    },
  );
  addText(
    slide,
    "Diagnosis",
    { left: 82, top: 140, width: 320, height: 58 },
    theme,
    {
      fontSize: 42,
      color: theme.colors.ink,
      face: theme.fonts.title,
      bold: true,
      autoFit: null,
    },
  );
  addText(
    slide,
    caseData.caseTitle,
    { left: 82, top: 212, width: 1116, height: 112 },
    theme,
    {
      fontSize: 31,
      color: theme.colors.accentDark,
      face: theme.fonts.title,
      bold: true,
    },
  );

  addShape(
    slide,
    "roundRect",
    { left: 82, top: 348, width: 1116, height: 286 },
    theme.colors.panel,
    theme.colors.border,
    1.1,
  );
  addText(
    slide,
    truncateAtSentence(caseData.revealSummary, 520),
    { left: 114, top: 382, width: 1050, height: 216 },
    theme,
    {
      fontSize: 21,
      color: theme.colors.ink,
      face: theme.fonts.body,
    },
  );

  addFooter(slide, caseData.footerText, theme);
  addSpeakerNotes(slide, caseData, caseNumber);
}

function addTeachingPointsSlide(slide, caseData, caseNumber, deckTitle, theme, { title = "Teaching Points" } = {}) {
  slide.background = { color: cleanColor(theme.colors.teachingBg) };
  addTopBar(slide, deckTitle, theme, { dark: theme === THEMES["conference-dark"] });

  addText(
    slide,
    `Case ${caseNumber}`,
    { left: 82, top: 102, width: 220, height: 22 },
    theme,
    {
      fontSize: 13,
      color: theme.colors.accentDark,
      face: theme.fonts.mono,
      bold: true,
      autoFit: null,
    },
  );
  addText(
    slide,
    title,
    { left: 82, top: 140, width: 520, height: 58 },
    theme,
    {
      fontSize: 42,
      color: theme.colors.ink,
      face: theme.fonts.title,
      bold: true,
      autoFit: null,
    },
  );
  addText(
    slide,
    caseData.caseTitle,
    { left: 82, top: 212, width: 1116, height: 56 },
    theme,
    {
      fontSize: 24,
      color: theme.colors.accentDark,
      face: theme.fonts.body,
      bold: true,
    },
  );

  const bullets = Array.isArray(caseData.teachingPoints) ? caseData.teachingPoints.filter(Boolean) : [];
  const visibleBullets = bullets.slice(0, 3);
  const firstBulletTop = 302;
  const bottomLimit = 648;
  const slotHeight = visibleBullets.length ? (bottomLimit - firstBulletTop) / visibleBullets.length : 0;
  visibleBullets.forEach((bullet, index) => {
    const top = firstBulletTop + index * slotHeight;
    addShape(slide, "ellipse", { left: 92, top: top + 10, width: 16, height: 16 }, theme.colors.accent, TRANSPARENT, 0);
    addText(
      slide,
      truncateAtSentence(bullet, 260),
      { left: 126, top, width: 1040, height: Math.max(78, slotHeight - 18) },
      theme,
      {
        fontSize: visibleBullets.length >= 3 ? 20 : 22,
        color: theme.colors.ink,
        face: theme.fonts.body,
      },
    );
  });

  addFooter(slide, caseData.footerText, theme);
  addSpeakerNotes(slide, caseData, caseNumber);
}

function caseDescriptor(caseData) {
  return safeCaseIntro(caseData) || normalizeText(caseData.modalitySummary);
}

function buildDiagnosisQuestion(caseData, allCases, caseNumber) {
  const correctText = normalizeText(caseData.caseTitle || caseData.diagnosisQuery);
  const distractorPool = dedupe(
    allCases
      .flatMap((candidate) => [candidate.caseTitle, candidate.diagnosisQuery])
      .map(normalizeText)
      .filter(Boolean),
  ).filter((text) => text.toLowerCase() !== correctText.toLowerCase());

  const distractors = shuffle(
    distractorPool,
    `${caseData.casePath || caseData.caseTitle || caseNumber}|diagnosis-distractors`,
  ).slice(0, 3);
  const optionTexts = distractors.length
    ? shuffle(
        [correctText, ...distractors],
        `${caseData.casePath || caseData.caseTitle || caseNumber}|diagnosis-options`,
      )
    : [];
  const options = optionTexts.map((text, index) => ({
    id: optionId(index),
    text,
    isCorrect: text === correctText,
  }));

  return {
    stem: options.length >= 2 ? "What is the most likely diagnosis?" : "What is the diagnosis?",
    options,
    answerKey: options.find((option) => option.isCorrect)?.id || "",
    correctText,
  };
}

function buildCaseAnatomyQuestion(caseData) {
  for (const image of caseData.images || []) {
    const localPath = imageLocalPath(image);
    if (!localPath || !Array.isArray(image.focusPoints) || !image.focusPoints.length) {
      continue;
    }

    const labeledPoint = image.focusPoints.find((point) => normalizeText(point.label)) || image.focusPoints[0];
    const answerText = normalizeText(labeledPoint?.label);
    const hotspot = normalizeHotspot(
      {
        x: labeledPoint?.x,
        y: labeledPoint?.y,
        radius: Math.max(Number(image.frameWidth) || 0, Number(image.frameHeight) || 0) * 0.03,
      },
      {
        width: image.frameWidth,
        height: image.frameHeight,
      },
    );
    if (!answerText || !hotspot) {
      continue;
    }

    return {
      stem: "What structure or finding is indicated by the marker?",
      answerText,
      image,
      hotspot,
    };
  }

  const verbalImage = (caseData.images || []).find((image) => imageLocalPath(image));
  const verbalAnswer = buildVerbalAnatomyAnswer(caseData);
  if (!verbalImage || !verbalAnswer) {
    return null;
  }

  return {
    stem: "Verbal anatomy check: on this image, where would you place the pin?",
    answerText: verbalAnswer,
    image: verbalImage,
    hotspot: null,
  };
}

function buildVerbalAnatomyAnswer(caseData) {
  const plannedAnatomy = normalizeText(caseData?.coreReviewPlan?.anatomyPrompt || "");
  if (plannedAnatomy) {
    return plannedAnatomy;
  }

  const studyHint = normalizeText(caseData?.studyHint || "");
  const withoutModality = studyHint
    .replace(/\b(MRI|MR|CT|X-ray|radiograph|ultrasound|US|fluoroscopy|PET|mammography|angiography|nuclear medicine)\b/gi, "")
    .replace(/[,\-_/]+/g, " ");
  return collapseWhitespace(withoutModality);
}

function questionImageObject(question) {
  if (!question?.image) {
    return null;
  }
  if (typeof question.image === "string") {
    return { path: question.image };
  }
  return question.image;
}

function questionImageEntry(question) {
  const image = questionImageObject(question);
  if (!image) {
    return null;
  }

  const localPath = imageLocalPath(image);
  if (!localPath) {
    return null;
  }

  return {
    localPath,
    label: imageAltText(image, question.stem || "Core Review image"),
  };
}

function standaloneQuestionHotspot(question) {
  const image = questionImageObject(question);
  return normalizeHotspot(question.hotspot, {
    width: image?.width ?? image?.frameWidth,
    height: image?.height ?? image?.frameHeight,
  });
}

function questionInstructions(question) {
  switch (question.type) {
    case "numeric_fill_blank":
      return "State the numeric answer verbally before advancing.";
    case "multi_correct":
      return "Name every correct option verbally before advancing.";
    case "image_hotspot":
    case "gold_marker_abnormality":
      return "Answer verbally while using the marked image as the prompt.";
    default:
      return "Answer verbally before advancing.";
  }
}

function answerTextForQuestion(question) {
  if (question.type === "single_best_answer") {
    const option = question.options.find((candidate) => candidate.id === question.answerKey);
    return option ? `${option.id}. ${option.text}` : question.answerKey || "Answer not supplied";
  }

  if (question.type === "numeric_fill_blank") {
    const value = question.numericAnswer?.value;
    const units = normalizeText(question.numericAnswer?.units || "");
    return collapseWhitespace([value, units].filter((piece) => piece !== null && piece !== undefined && piece !== "").join(" "));
  }

  if (question.type === "multi_correct") {
    const keyed = question.options.filter((option) => question.answerKeys.includes(option.id));
    if (keyed.length) {
      return keyed.map((option) => `${option.id}. ${option.text}`).join("\n");
    }
    return question.answerKeys.join(", ");
  }

  if (question.type === "image_hotspot" || question.type === "gold_marker_abnormality") {
    return question.answerKey || question.explanation || "Verbal localization; refer to the marked image.";
  }

  return question.answerKey || question.explanation || "See explanation in speaker notes.";
}

function questionFooter(question) {
  const references = Array.isArray(question.references)
    ? question.references
        .map((reference) => collapseWhitespace(reference?.label || reference?.url || ""))
        .filter(Boolean)
        .slice(0, 2)
    : [];
  return references.join(" • ");
}

function addStandaloneSpeakerNotes(slide, question, questionNumber) {
  slide.addNotes(
    [
      `Review question ${questionNumber}`,
      `Domain: ${domainLabel(question.domain)}`,
      `Type: ${question.type}`,
      `Stem: ${question.stem}`,
      `Answer: ${answerTextForQuestion(question)}`,
      question.explanation ? `Explanation: ${question.explanation}` : null,
      ...(Array.isArray(question.references)
        ? question.references.map((reference) =>
            collapseWhitespace([reference?.label, reference?.url].filter(Boolean).join(": ")),
          )
        : []),
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

async function addCoreReviewDiagnosisQuestionSlide(slide, caseData, caseNumber, deckTitle, theme, allCases) {
  slide.background = { color: cleanColor(theme.colors.imageBg) };
  addTopBar(slide, deckTitle, theme, { dark: true });
  const descriptor = caseDescriptor(caseData);
  const question = buildDiagnosisQuestion(caseData, allCases, caseNumber);

  addText(
    slide,
    `Case ${caseNumber} • Diagnosis Question`,
    { left: 44, top: 58, width: 360, height: 18 },
    theme,
    {
      fontSize: 12,
      color: theme.colors.footerDark,
      face: theme.fonts.mono,
      bold: true,
      autoFit: null,
    },
  );

  if (descriptor) {
    addText(
      slide,
      truncateText(descriptor, 100),
      { left: 480, top: 58, width: 754, height: 18 },
      theme,
      {
        fontSize: 10,
        color: theme.colors.footerDark,
        face: theme.fonts.mono,
        align: "right",
        autoFit: "shrinkText",
      },
    );
  }

  await addImageGallery(
    slide,
    caseData.images || [],
    { left: 44, top: 86, width: 1192, height: 318 },
    { emptyMessage: "No selected images for this case." },
  );

  addShape(
    slide,
    "roundRect",
    { left: 54, top: 434, width: 1172, height: 222 },
    theme.colors.panel,
    theme.colors.border,
    1.1,
  );
  addText(
    slide,
    question.stem,
    { left: 86, top: 462, width: 1030, height: 48 },
    theme,
    {
      fontSize: 29,
      color: theme.colors.ink,
      face: theme.fonts.title,
      bold: true,
    },
  );

  if (question.options.length) {
    addText(
      slide,
      question.options.map((option) => `${option.id}. ${option.text}`).join("\n"),
      { left: 90, top: 522, width: 920, height: 104 },
      theme,
      {
        fontSize: 20,
        color: theme.colors.ink,
        face: theme.fonts.body,
      },
    );
  } else {
    addText(
      slide,
      "Open response. State the diagnosis before advancing.",
      { left: 90, top: 526, width: 1020, height: 44 },
      theme,
      {
        fontSize: 20,
        color: theme.colors.accentDark,
        face: theme.fonts.body,
      },
    );
  }

  addText(
    slide,
    "Answer verbally before advancing.",
    { left: 832, top: 618, width: 330, height: 20 },
    theme,
    {
      fontSize: 11,
      color: theme.colors.slate,
      face: theme.fonts.mono,
      align: "right",
      autoFit: null,
    },
  );

  addFooter(slide, caseData.footerText, theme, { dark: true });
  addSpeakerNotes(slide, caseData, caseNumber, [`Diagnosis answer: ${question.correctText}`]);
}

async function addCoreReviewAnatomyQuestionSlide(slide, caseData, caseNumber, deckTitle, theme, anatomyQuestion) {
  slide.background = { color: cleanColor(theme.colors.imageBg) };
  addTopBar(slide, deckTitle, theme, { dark: true });

  addText(
    slide,
    `Case ${caseNumber} • Structure / Finding Question`,
    { left: 44, top: 58, width: 460, height: 18 },
    theme,
    {
      fontSize: 12,
      color: theme.colors.footerDark,
      face: theme.fonts.mono,
      bold: true,
      autoFit: null,
    },
  );

  await addImageGallery(
    slide,
    [anatomyQuestion.image],
    { left: 92, top: 90, width: 1140, height: 420 },
    {
      marker: {
        image: anatomyQuestion.image,
        hotspot: anatomyQuestion.hotspot,
      },
    },
  );

  addShape(
    slide,
    "roundRect",
    { left: 98, top: 540, width: 1128, height: 110 },
    theme.colors.panel,
    theme.colors.border,
    1.1,
  );
  addText(
    slide,
    anatomyQuestion.stem,
    { left: 130, top: 568, width: 820, height: 34 },
    theme,
    {
      fontSize: 26,
      color: theme.colors.ink,
      face: theme.fonts.title,
      bold: true,
    },
  );
  addText(
    slide,
    "Answer verbally before advancing.",
    { left: 862, top: 602, width: 294, height: 18 },
    theme,
    {
      fontSize: 11,
      color: theme.colors.slate,
      face: theme.fonts.mono,
      align: "right",
      autoFit: null,
    },
  );

  addFooter(slide, caseData.footerText, theme, { dark: true });
  addSpeakerNotes(slide, caseData, caseNumber, [`Structure/finding answer: ${anatomyQuestion.answerText}`]);
}

async function addCoreReviewAnatomyAnswerSlide(slide, caseData, caseNumber, deckTitle, theme, anatomyQuestion) {
  slide.background = { color: cleanColor(theme.colors.diagnosisBg) };
  addTopBar(slide, deckTitle, theme, { dark: theme === THEMES["conference-dark"] });

  addText(
    slide,
    `Case ${caseNumber}`,
    { left: 82, top: 102, width: 220, height: 22 },
    theme,
    {
      fontSize: 13,
      color: theme.colors.accentDark,
      face: theme.fonts.mono,
      bold: true,
      autoFit: null,
    },
  );
  addText(
    slide,
    "Structure / Finding",
    { left: 82, top: 140, width: 460, height: 58 },
    theme,
    {
      fontSize: 42,
      color: theme.colors.ink,
      face: theme.fonts.title,
      bold: true,
      autoFit: null,
    },
  );
  addText(
    slide,
    anatomyQuestion.answerText,
    { left: 82, top: 216, width: 540, height: 168 },
    theme,
    {
      fontSize: 30,
      color: theme.colors.accentDark,
      face: theme.fonts.title,
      bold: true,
    },
  );
  addText(
    slide,
    caseData.caseTitle,
    { left: 82, top: 392, width: 540, height: 64 },
    theme,
    {
      fontSize: 22,
      color: theme.colors.ink,
      face: theme.fonts.body,
    },
  );

  await addImageGallery(
    slide,
    [anatomyQuestion.image],
    { left: 684, top: 124, width: 486, height: 460 },
    {
      marker: {
        image: anatomyQuestion.image,
        hotspot: anatomyQuestion.hotspot,
      },
    },
  );

  addFooter(slide, caseData.footerText, theme);
  addSpeakerNotes(slide, caseData, caseNumber, [`Structure/finding answer: ${anatomyQuestion.answerText}`]);
}

async function addCoreReviewStandaloneQuestionSlide(slide, question, questionNumber, deckTitle, theme) {
  slide.background = { color: cleanColor(theme.colors.teachingBg) };
  addTopBar(slide, deckTitle, theme, { dark: false });

  addText(
    slide,
    `Review ${questionNumber} • ${domainLabel(question.domain)}`,
    { left: 82, top: 94, width: 340, height: 22 },
    theme,
    {
      fontSize: 13,
      color: theme.colors.accentDark,
      face: theme.fonts.mono,
      bold: true,
      autoFit: null,
    },
  );

  const image = questionImageEntry(question);
  const hotspot = standaloneQuestionHotspot(question);
  if (image) {
    await addImageGallery(
      slide,
      [image],
      { left: 82, top: 140, width: 520, height: 460 },
      hotspot
        ? {
            marker: {
              image,
              hotspot,
            },
          }
        : {},
    );

    addShape(
      slide,
      "roundRect",
      { left: 640, top: 140, width: 516, height: 460 },
      theme.colors.panel,
      theme.colors.border,
      1.1,
    );
    addText(
      slide,
      question.stem,
      { left: 674, top: 176, width: 448, height: 126 },
      theme,
      {
        fontSize: 26,
        color: theme.colors.ink,
        face: theme.fonts.title,
        bold: true,
      },
    );
    if (question.options.length) {
      addText(
        slide,
        question.options.map((option) => `${option.id}. ${option.text}`).join("\n"),
        { left: 676, top: 316, width: 430, height: 180 },
        theme,
        {
          fontSize: 18,
          color: theme.colors.ink,
          face: theme.fonts.body,
        },
      );
    }
    addText(
      slide,
      questionInstructions(question),
      { left: 676, top: 520, width: 430, height: 28 },
      theme,
      {
        fontSize: 12,
        color: theme.colors.slate,
        face: theme.fonts.mono,
      },
    );
  } else {
    addShape(
      slide,
      "roundRect",
      { left: 82, top: 140, width: 1088, height: 480 },
      theme.colors.panel,
      theme.colors.border,
      1.1,
    );
    addText(
      slide,
      question.stem,
      { left: 122, top: 178, width: 1012, height: 120 },
      theme,
      {
        fontSize: 30,
        color: theme.colors.ink,
        face: theme.fonts.title,
        bold: true,
      },
    );

    if (question.options.length) {
      addText(
        slide,
        question.options.map((option) => `${option.id}. ${option.text}`).join("\n"),
        { left: 126, top: 326, width: 964, height: 208 },
        theme,
        {
          fontSize: 22,
          color: theme.colors.ink,
          face: theme.fonts.body,
        },
      );
    } else if (question.type === "numeric_fill_blank") {
      addText(
        slide,
        "Open response. State the calculated answer verbally.",
        { left: 126, top: 326, width: 900, height: 44 },
        theme,
        {
          fontSize: 22,
          color: theme.colors.accentDark,
          face: theme.fonts.body,
        },
      );
    }

    addText(
      slide,
      questionInstructions(question),
      { left: 126, top: 560, width: 960, height: 28 },
      theme,
      {
        fontSize: 12,
        color: theme.colors.slate,
        face: theme.fonts.mono,
      },
    );
  }

  addFooter(slide, questionFooter(question), theme);
  addStandaloneSpeakerNotes(slide, question, questionNumber);
}

async function addCoreReviewStandaloneAnswerSlide(slide, question, questionNumber, deckTitle, theme) {
  slide.background = { color: cleanColor(theme.colors.diagnosisBg) };
  addTopBar(slide, deckTitle, theme, { dark: theme === THEMES["conference-dark"] });

  addText(
    slide,
    `Review ${questionNumber} • ${domainLabel(question.domain)}`,
    { left: 82, top: 94, width: 360, height: 22 },
    theme,
    {
      fontSize: 13,
      color: theme.colors.accentDark,
      face: theme.fonts.mono,
      bold: true,
      autoFit: null,
    },
  );
  addText(
    slide,
    "Answer",
    { left: 82, top: 136, width: 300, height: 58 },
    theme,
    {
      fontSize: 42,
      color: theme.colors.ink,
      face: theme.fonts.title,
      bold: true,
      autoFit: null,
    },
  );

  const image = questionImageEntry(question);
  const hotspot = standaloneQuestionHotspot(question);
  if (image) {
    addText(
      slide,
      answerTextForQuestion(question),
      { left: 82, top: 214, width: 520, height: 140 },
      theme,
      {
        fontSize: 28,
        color: theme.colors.accentDark,
        face: theme.fonts.title,
        bold: true,
      },
    );

    if (question.explanation) {
      addText(
        slide,
        question.explanation,
        { left: 82, top: 380, width: 520, height: 182 },
        theme,
        {
          fontSize: 20,
          color: theme.colors.ink,
          face: theme.fonts.body,
        },
      );
    }

    await addImageGallery(
      slide,
      [image],
      { left: 684, top: 124, width: 486, height: 460 },
      hotspot
        ? {
            marker: {
              image,
              hotspot,
            },
          }
        : {},
    );
  } else {
    addText(
      slide,
      answerTextForQuestion(question),
      { left: 82, top: 224, width: 1088, height: 120 },
      theme,
      {
        fontSize: 30,
        color: theme.colors.accentDark,
        face: theme.fonts.title,
        bold: true,
      },
    );
    if (question.explanation) {
      addShape(
        slide,
        "roundRect",
        { left: 82, top: 374, width: 1088, height: 222 },
        theme.colors.panel,
        theme.colors.border,
        1.1,
      );
      addText(
        slide,
        question.explanation,
        { left: 118, top: 410, width: 1018, height: 154 },
        theme,
        {
          fontSize: 21,
          color: theme.colors.ink,
          face: theme.fonts.body,
        },
      );
    }
  }

  addFooter(slide, questionFooter(question), theme);
  addStandaloneSpeakerNotes(slide, question, questionNumber);
}

function standaloneQuestionsByCase(cases, questions) {
  const groups = new Map();
  if (!questions.length || !cases.length) {
    return groups;
  }

  for (let index = 0; index < questions.length; index += 1) {
    const afterCase = cases.length === 1
      ? 1
      : Math.max(
          1,
          Math.min(
            cases.length,
            Math.round(((index + 1) * cases.length) / (questions.length + 1)),
          ),
        );
    const bucket = groups.get(afterCase) || [];
    bucket.push(questions[index]);
    groups.set(afterCase, bucket);
  }

  return groups;
}

export async function buildDeck({
  cases,
  deckTitle,
  outputPath,
  scratchDir,
  deckMode = DECK_MODES.caseConference,
  coreReviewQuestions = [],
  theme = "classic",
  includeTeachingPoints = false,
}) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.mkdir(scratchDir, { recursive: true });

  const presentation = new pptxgen();
  presentation.defineLayout({ name: "RADIOLOGY_WIDE", width: SLIDE_W, height: SLIDE_H });
  presentation.layout = "RADIOLOGY_WIDE";
  presentation.author = "Radiopaedia Case PowerPoint Builder";
  presentation.company = "Radiopaedia Case PowerPoint Builder";
  presentation.subject = "Radiology case teaching presentation";
  presentation.title = deckTitle || "Radiology Cases";

  const activeTheme = resolveTheme(theme);
  const activeDeckMode = resolveDeckMode(deckMode);
  const shouldIncludeTeachingPoints = includeTeachingPoints || activeDeckMode === DECK_MODES.coreReview;
  const teachingSlideTitle = activeDeckMode === DECK_MODES.coreReview ? "Core Review Notes" : "Teaching Points";
  const standaloneQuestionGroups =
    activeDeckMode === DECK_MODES.coreReview
      ? standaloneQuestionsByCase(cases, Array.isArray(coreReviewQuestions) ? coreReviewQuestions : [])
      : new Map();
  let slideCount = 0;
  let standaloneQuestionNumber = 0;

  const addSlide = () => {
    slideCount += 1;
    return presentation.addSlide();
  };

  for (let index = 0; index < cases.length; index += 1) {
    const caseNumber = index + 1;
    const caseData = cases[index];
    if (activeDeckMode === DECK_MODES.coreReview) {
      const anatomyQuestion = buildCaseAnatomyQuestion(caseData);

      addCaseSlide(addSlide(), caseData, caseNumber, deckTitle, activeTheme);
      await addCoreReviewDiagnosisQuestionSlide(addSlide(), caseData, caseNumber, deckTitle, activeTheme, cases);
      if (anatomyQuestion) {
        await addCoreReviewAnatomyQuestionSlide(
          addSlide(),
          caseData,
          caseNumber,
          deckTitle,
          activeTheme,
          anatomyQuestion,
        );
      }
      addDiagnosisSlide(addSlide(), caseData, caseNumber, deckTitle, activeTheme);
      if (anatomyQuestion) {
        await addCoreReviewAnatomyAnswerSlide(
          addSlide(),
          caseData,
          caseNumber,
          deckTitle,
          activeTheme,
          anatomyQuestion,
        );
      }
      if (shouldIncludeTeachingPoints && Array.isArray(caseData.teachingPoints) && caseData.teachingPoints.length) {
        addTeachingPointsSlide(addSlide(), caseData, caseNumber, deckTitle, activeTheme, {
          title: teachingSlideTitle,
        });
      }

      const standaloneQuestions = standaloneQuestionGroups.get(caseNumber) || [];
      for (const question of standaloneQuestions) {
        standaloneQuestionNumber += 1;
        await addCoreReviewStandaloneQuestionSlide(
          addSlide(),
          question,
          standaloneQuestionNumber,
          deckTitle,
          activeTheme,
        );
        await addCoreReviewStandaloneAnswerSlide(
          addSlide(),
          question,
          standaloneQuestionNumber,
          deckTitle,
          activeTheme,
        );
      }
      continue;
    }

    addCaseSlide(addSlide(), caseData, caseNumber, deckTitle, activeTheme);
    await addImagesSlide(addSlide(), caseData, caseNumber, deckTitle, activeTheme);
    addDiagnosisSlide(addSlide(), caseData, caseNumber, deckTitle, activeTheme);
    if (shouldIncludeTeachingPoints && Array.isArray(caseData.teachingPoints) && caseData.teachingPoints.length) {
      addTeachingPointsSlide(addSlide(), caseData, caseNumber, deckTitle, activeTheme, {
        title: teachingSlideTitle,
      });
    }
  }

  await presentation.writeFile({ fileName: outputPath });

  return {
    outputPath,
    slideCount,
  };
}
