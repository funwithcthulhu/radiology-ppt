import fs from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import pptxgen from "pptxgenjs";
import sharp from "sharp";
import { loadCoreReviewCaseBank } from "./core_review/case-plan.mjs";
import { collapseWhitespace, dedupe } from "./utils.mjs";

const SHAPE_TYPES = new pptxgen().ShapeType;
const W = 1280;
const H = 720;
const SLIDE_W = 13.333333;
const SLIDE_H = 7.5;
const SX = SLIDE_W / W;
const SY = SLIDE_H / H;
const EMU_PER_INCH = 914400;
const TRANSPARENT = "#00000000";
const CORE_REVIEW_MARKER_COLOR = "#D4AF37";
const NOTES_SLIDE_XML_ENTRY_PATTERN = /^ppt\/notesSlides\/notesSlide\d+\.xml$/;
const OPENXML_POSITIONABLE_ENTRY_PATTERN =
  /^(?:ppt\/slides\/slide\d+\.xml|ppt\/notesSlides\/notesSlide\d+\.xml|ppt\/notesMasters\/notesMaster\d+\.xml)$/;
const OPENXML_COORDINATE_ATTR_PATTERN = /\b(x|y|cx|cy)="(-?\d+\.\d+)"/g;
const POWERPOINT_CREATION_ID_EXT_PATTERN =
  /<p:extLst>\s*<p:ext\b[^>]*\buri="\{BB962C8B-B14F-4D97-AF65-F5344CB8AC3E\}"[^>]*>\s*<p14:creationId\b[^>]*\/>\s*<\/p:ext>\s*<\/p:extLst>/g;
const DECK_MODES = {
  caseConference: "case-conference",
  coreReview: "core-review",
};
const CORE_REVIEW_CASE_EXERCISE_SEQUENCE = [
  "diagnosis_open",
  "pin_abnormality",
  "diagnosis_mcq",
  "pin_anatomy",
  "diagnosis_open",
  "structure_card",
  "diagnosis_open",
  "diagnosis_mcq",
];
const DIAGNOSIS_KEY_FILLER_PATTERN =
  /\b(?:acute|chronic|adult|pediatric|paediatric|children|childhood|classic|typical|atypical|case|disease)\b/g;
const DIAGNOSIS_MODALITY_HINTS = [
  { label: "MRI", patterns: [/\bmri\b/i, /\bmr\b/i, /\bmagnetic resonance\b/i] },
  { label: "CT", patterns: [/\bct\b/i, /\bcomputed tomography\b/i] },
  { label: "X-ray", patterns: [/\bx-?ray\b/i, /\bradiograph(?:y|ic)?\b/i, /\bcxr\b/i] },
  { label: "Ultrasound", patterns: [/\bultrasound\b/i, /\bsonograph(?:y|ic)?\b/i, /\bus\b/i] },
  { label: "Fluoroscopy", patterns: [/\bfluoro(?:scopy)?\b/i] },
  { label: "Angiography", patterns: [/\bangiograph(?:y|ic)?\b/i, /\bangio\b/i] },
  { label: "Nuclear Medicine", patterns: [/\bnuclear medicine\b/i, /\bnuc med\b/i, /\bscintigraph(?:y|ic)?\b/i, /\bpet\b/i, /\bspect\b/i, /\bhida\b/i] },
  { label: "Mammography", patterns: [/\bmammograph(?:y|ic)?\b/i, /\bmammo\b/i] },
];
const DIAGNOSIS_DIFFERENTIAL_GROUPS = [
  {
    id: "perianal-pelvis",
    patterns: [/\bperianal\b/i, /\bfistula(?:-in-ano)?\b/i, /\banal fistula\b/i],
    terms: ["perianal", "anal", "rectal", "ischioanal", "intersphincteric", "pelvis", "pelvic"],
    domains: ["gi", "gu", "mr"],
    systems: ["Gastrointestinal", "Urogenital", "Gynaecology"],
    distractors: ["Perianal abscess", "Hidradenitis suppurativa", "Pilonidal sinus disease", "Low rectal carcinoma"],
  },
  {
    id: "renal-colic",
    patterns: [/\bureter(?:ic|al)? stone\b/i, /\burolithiasis\b/i, /\bobstructing.*stone\b/i, /\bhydronephrosis\b/i],
    terms: ["ureter", "urinary", "kidney", "renal", "flank", "hydronephrosis"],
    domains: ["gu", "ct", "ultrasound", "nuclear"],
    systems: ["Urogenital"],
    distractors: ["Ureteral stricture", "Pyelonephritis", "Papillary necrosis", "Upper tract urothelial carcinoma"],
  },
  {
    id: "shoulder-soft-tissue",
    patterns: [/\brotator cuff\b/i, /\bsupraspinatus\b/i, /\bsubscapularis\b/i, /\bshoulder\b/i],
    terms: ["shoulder", "rotator", "cuff", "supraspinatus", "subacromial"],
    domains: ["msk", "mr", "ultrasound"],
    systems: ["Musculoskeletal"],
    distractors: ["Adhesive capsulitis", "Calcific tendinopathy", "Labral tear", "Subacromial-subdeltoid bursitis"],
  },
  {
    id: "pulmonary-vascular",
    patterns: [/\bpulmonary embol/i, /\bpulmonary arteries?\b/i, /\bcta chest\b/i],
    terms: ["pulmonary", "artery", "chest", "vascular", "embol"],
    domains: ["thoracic", "cardiovascular", "ct"],
    systems: ["Chest", "Vascular", "Cardiac"],
    distractors: ["Pulmonary arterial hypertension", "Aortic dissection", "Pulmonary vein thrombosis", "Septic pulmonary emboli"],
  },
  {
    id: "cpa-iac",
    patterns: [/\bvestibular schwannoma\b/i, /\bacoustic neuroma\b/i, /\binternal auditory canal\b/i, /\bcpa\b/i],
    terms: ["cpa", "internal auditory canal", "iac", "cerebellopontine", "posterior fossa"],
    domains: ["neuro", "mr"],
    systems: ["Central Nervous System", "Head & Neck"],
    distractors: ["Cerebellopontine angle meningioma", "Epidermoid cyst", "Facial nerve schwannoma", "Arachnoid cyst"],
  },
  {
    id: "hindbrain-csf",
    patterns: [/\bchiari\b/i, /\bcerebellar tonsil/i, /\bforamen magnum\b/i],
    terms: ["posterior fossa", "foramen magnum", "cerebellar", "tonsil", "hindbrain"],
    domains: ["neuro", "pediatric", "mr"],
    systems: ["Central Nervous System", "Spine"],
    distractors: ["Intracranial hypotension", "Dandy-Walker malformation", "Basilar invagination", "Normal tonsillar ectopia"],
  },
  {
    id: "intracranial-mass",
    patterns: [/\bglioblastoma\b/i, /\bmeningioma\b/i, /\bpituitary macroadenoma\b/i, /\bbrain mass\b/i],
    terms: ["brain", "intracranial", "sella", "tumor", "mass"],
    domains: ["neuro", "mr", "ct"],
    systems: ["Central Nervous System"],
    distractors: ["Solitary metastasis", "Primary CNS lymphoma", "Tumefactive demyelination", "High-grade glioma"],
  },
  {
    id: "bowel-inflammatory",
    patterns: [/\bcrohn\b/i, /\bulcerative colitis\b/i, /\bcolitis\b/i, /\benteritis\b/i],
    terms: ["bowel", "colon", "ileum", "colitis", "enteritis"],
    domains: ["gi", "ct", "mr"],
    systems: ["Gastrointestinal"],
    distractors: ["Infectious colitis", "Ischemic colitis", "Ulcerative colitis", "Crohn disease"],
  },
  {
    id: "right-lower-quadrant",
    patterns: [/\bappendicitis\b/i, /\bright lower quadrant\b/i, /\brlq\b/i],
    terms: ["appendix", "right lower quadrant", "cecum", "terminal ileum"],
    domains: ["gi", "pediatric", "ct", "ultrasound"],
    systems: ["Gastrointestinal", "Paediatrics"],
    distractors: ["Terminal ileitis", "Epiploic appendagitis", "Cecal diverticulitis", "Mesenteric adenitis"],
  },
  {
    id: "biliary",
    patterns: [/\bcholecystitis\b/i, /\bcholedocholithiasis\b/i, /\bgallstones?\b/i, /\bbile duct\b/i],
    terms: ["gallbladder", "biliary", "bile duct", "liver", "right upper quadrant"],
    domains: ["gi", "ultrasound", "nuclear", "mr"],
    systems: ["Hepatobiliary", "Gastrointestinal"],
    distractors: ["Biliary colic", "Acute cholangitis", "Gallbladder carcinoma", "Hepatitis"],
  },
  {
    id: "adnexal-pelvis",
    patterns: [/\bovarian torsion\b/i, /\badnexa/i, /\bectopic pregnancy\b/i, /\buter/i, /\bplacenta\b/i],
    terms: ["ovary", "adnexa", "uterus", "pelvis", "pregnancy", "placenta"],
    domains: ["gu", "ultrasound", "mr", "pediatric"],
    systems: ["Gynaecology", "Obstetrics", "Urogenital"],
    distractors: ["Hemorrhagic ovarian cyst", "Tubo-ovarian abscess", "Degenerating fibroid", "Ectopic pregnancy"],
  },
  {
    id: "renal-mass",
    patterns: [/\brenal cell carcinoma\b/i, /\bangiomyolipoma\b/i, /\brenal mass\b/i, /\bwilms\b/i],
    terms: ["kidney", "renal", "mass", "neoplasm"],
    domains: ["gu", "pediatric", "ct", "mr", "ultrasound"],
    systems: ["Urogenital", "Paediatrics"],
    distractors: ["Lipid-poor angiomyolipoma", "Oncocytoma", "Renal lymphoma", "Renal abscess"],
  },
  {
    id: "bone-tumor",
    patterns: [/\bosteosarcoma\b/i, /\bewing\b/i, /\bgiant cell tumor\b/i, /\bbone metastases\b/i],
    terms: ["bone", "osseous", "metaphysis", "diaphysis", "skeleton", "tumor"],
    domains: ["msk", "pediatric", "nuclear", "mr"],
    systems: ["Musculoskeletal", "Paediatrics", "Oncology"],
    distractors: ["Osteomyelitis", "Langerhans cell histiocytosis", "Chondrosarcoma", "Stress fracture"],
  },
  {
    id: "knee-internal-derangement",
    patterns: [/\bacl\b/i, /\bmeniscal\b/i, /\bknee\b/i],
    terms: ["knee", "meniscus", "acl", "ligament"],
    domains: ["msk", "mr"],
    systems: ["Musculoskeletal"],
    distractors: ["PCL tear", "Bucket-handle meniscal tear", "Osteochondral injury", "Collateral ligament sprain"],
  },
  {
    id: "pediatric-bowel",
    patterns: [/\bintussusception\b/i, /\bmalrotation\b/i, /\bmidgut volvulus\b/i, /\bpyloric stenosis\b/i],
    terms: ["pediatric", "paediatric", "bowel", "neonatal", "abdomen", "upper gi"],
    domains: ["pediatric", "gi", "ultrasound", "radiography_fluoroscopy"],
    systems: ["Paediatrics", "Gastrointestinal"],
    distractors: ["Malrotation with midgut volvulus", "Pyloric stenosis", "Intussusception", "Necrotizing enterocolitis"],
  },
  {
    id: "breast-mass",
    patterns: [/\bbreast\b/i, /\bfibroadenoma\b/i, /\bductal carcinoma\b/i, /\bradial scar\b/i],
    terms: ["breast", "mammography", "mass", "calcifications"],
    domains: ["breast"],
    systems: ["Breast"],
    distractors: ["Fibroadenoma", "Invasive ductal carcinoma", "Fat necrosis", "Intraductal papilloma"],
  },
];

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

function emuSafeInches(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Math.round(numeric * EMU_PER_INCH) / EMU_PER_INCH;
}

function emuSafeFrame(frame) {
  return {
    x: emuSafeInches(frame.x),
    y: emuSafeInches(frame.y),
    w: emuSafeInches(frame.w),
    h: emuSafeInches(frame.h),
  };
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
    ...emuSafeFrame({
      x: markerX - diameter / 2,
      y: markerY - diameter / 2,
      w: diameter,
      h: diameter,
    }),
    fill: fillOption(TRANSPARENT),
    line: { color: cleanColor(color), width: 2.2 },
  });
  slide.addShape(SHAPE_TYPES.ellipse, {
    ...emuSafeFrame({
      x: markerX - diameter / 8,
      y: markerY - diameter / 8,
      w: diameter / 4,
      h: diameter / 4,
    }),
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

function normalizeDiagnosisKey(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(DIAGNOSIS_KEY_FILLER_PATTERN, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function diagnosisKeysLookEquivalent(left, right) {
  if (!left || !right) {
    return false;
  }
  if (left === right) {
    return true;
  }
  const shorter = left.length < right.length ? left : right;
  const longer = left.length < right.length ? right : left;
  return shorter.length >= 9 && longer.includes(shorter);
}

function arrayText(value) {
  if (Array.isArray(value)) {
    return value.map(normalizeText).filter(Boolean);
  }
  const text = normalizeText(value);
  return text ? text.split(/[;,]/).map(normalizeText).filter(Boolean) : [];
}

function detectDiagnosisModalities(...values) {
  const sourceText = values.flatMap(arrayText).join(" ");
  return DIAGNOSIS_MODALITY_HINTS
    .filter((hint) => hint.patterns.some((pattern) => pattern.test(sourceText)))
    .map((hint) => hint.label.toLowerCase());
}

function matchingDifferentialGroups(text) {
  return DIAGNOSIS_DIFFERENTIAL_GROUPS.filter((group) =>
    group.patterns.some((pattern) => pattern.test(text)),
  );
}

function collectProfileTextParts(item) {
  return [
    item?.caseTitle,
    item?.diagnosisQuery,
    item?.diagnosis,
    item?.rawInput,
    item?.studyHint,
    item?.modalitySummary,
    item?.anatomy,
    item?.topicFocus,
    item?.coreReviewPlan?.domain,
    item?.coreReviewPlan?.anatomyPrompt,
    ...(Array.isArray(item?.systems) ? item.systems : []),
    ...(Array.isArray(item?.modalities) ? item.modalities : []),
  ].filter(Boolean);
}

function diagnosisProfile(item, forcedGroupIds = []) {
  const textParts = collectProfileTextParts(item);
  const text = textParts.map(normalizeText).join(" ");
  const groups = new Map(matchingDifferentialGroups(text).map((group) => [group.id, group]));
  for (const groupId of forcedGroupIds) {
    const group = DIAGNOSIS_DIFFERENTIAL_GROUPS.find((candidate) => candidate.id === groupId);
    if (group) {
      groups.set(group.id, group);
    }
  }
  const domain = normalizeText(item?.coreReviewPlan?.domain || item?.domain).toLowerCase();
  const systems = arrayText(item?.systems).map((value) => value.toLowerCase());
  const anatomy = normalizeText(item?.coreReviewPlan?.anatomyPrompt || item?.anatomy || "").toLowerCase();
  const groupTerms = [...groups.values()].flatMap((group) => group.terms || []);
  const groupDomains = [...groups.values()].flatMap((group) => group.domains || []);
  const groupSystems = [...groups.values()].flatMap((group) => group.systems || []);

  return {
    text: text.toLowerCase(),
    domain,
    domains: dedupe([domain, ...groupDomains].filter(Boolean).map((value) => value.toLowerCase())),
    systems: dedupe([...systems, ...groupSystems.map((value) => value.toLowerCase())]),
    modalities: dedupe(detectDiagnosisModalities(text, item?.modalities || [])),
    anatomy,
    terms: dedupe(
      [
        ...groupTerms,
        ...anatomy.split(/\s+/),
      ]
        .map((value) => normalizeText(value).toLowerCase())
        .filter((value) => value.length >= 3),
    ),
    topicFocus: normalizeText(item?.topicFocus).toLowerCase(),
    groupIds: [...groups.keys()],
  };
}

function diagnosisCandidateFromCase(candidate, source, bias = 0) {
  const text = normalizeText(candidate?.caseTitle || candidate?.diagnosisQuery || candidate?.diagnosis);
  if (!text) {
    return null;
  }
  return {
    text,
    source,
    bias,
    profile: diagnosisProfile(candidate),
  };
}

function diagnosisCandidateFromDifferential(text, group) {
  return {
    text,
    source: "curated-differential",
    bias: 180,
    profile: diagnosisProfile(
      {
        diagnosis: text,
        domain: group.domains?.[0] || "",
        systems: group.systems || [],
        anatomy: group.terms?.join(" ") || "",
      },
      [group.id],
    ),
  };
}

function intersects(left = [], right = []) {
  const rightSet = new Set(right);
  return left.some((value) => rightSet.has(value));
}

function textTokenOverlap(left, right) {
  const leftTokens = new Set(normalizeDiagnosisKey(left).split(/\s+/).filter((token) => token.length >= 4));
  const rightTokens = normalizeDiagnosisKey(right).split(/\s+/).filter((token) => token.length >= 4);
  return rightTokens.filter((token) => leftTokens.has(token)).length;
}

function diagnosisCandidateScore(candidate, targetProfile, targetText) {
  let score = candidate.bias || 0;
  const profile = candidate.profile;

  if (intersects(profile.groupIds, targetProfile.groupIds)) {
    score += 110;
  }
  if (intersects(profile.terms, targetProfile.terms)) {
    score += 50;
  }
  if (profile.domain && targetProfile.domains.includes(profile.domain)) {
    score += 35;
  } else if (profile.domain && targetProfile.domain && profile.domain !== targetProfile.domain) {
    score -= 18;
  }
  if (intersects(profile.domains, targetProfile.domains)) {
    score += 22;
  }
  if (intersects(profile.systems, targetProfile.systems)) {
    score += 28;
  }
  if (intersects(profile.modalities, targetProfile.modalities)) {
    score += 12;
  }
  if (profile.topicFocus && profile.topicFocus === targetProfile.topicFocus) {
    score += 12;
  }
  score += Math.min(18, textTokenOverlap(candidate.text, targetText) * 6);

  if (candidate.source === "selected-case" && score < 55) {
    score -= 80;
  }

  return score;
}

function rankedDiagnosisDistractors(caseData, allCases, caseBankCases, correctText, caseNumber) {
  const targetProfile = diagnosisProfile(caseData);
  const correctKey = normalizeDiagnosisKey(correctText);
  const candidates = [];

  for (const group of matchingDifferentialGroups(collectProfileTextParts(caseData).join(" "))) {
    for (const text of group.distractors || []) {
      candidates.push(diagnosisCandidateFromDifferential(text, group));
    }
  }

  for (const candidate of allCases || []) {
    const normalized = diagnosisCandidateFromCase(candidate, "selected-case", 12);
    if (normalized) {
      candidates.push(normalized);
    }
  }

  for (const candidate of caseBankCases || []) {
    const normalized = diagnosisCandidateFromCase(candidate, "core-bank", 0);
    if (normalized) {
      candidates.push(normalized);
    }
  }

  const bestByKey = new Map();
  for (const candidate of candidates) {
    const key = normalizeDiagnosisKey(candidate.text);
    if (!key || diagnosisKeysLookEquivalent(key, correctKey)) {
      continue;
    }
    const score = diagnosisCandidateScore(candidate, targetProfile, correctText);
    const current = bestByKey.get(key);
    if (!current || score > current.score) {
      bestByKey.set(key, { ...candidate, score });
    }
  }

  return shuffle(
    [...bestByKey.values()],
    `${caseData.casePath || caseData.caseTitle || caseNumber}|diagnosis-candidate-ties`,
  ).sort((left, right) => right.score - left.score);
}

function selectDiagnosisDistractors(caseData, allCases, caseBankCases, correctText, caseNumber) {
  const ranked = rankedDiagnosisDistractors(caseData, allCases, caseBankCases, correctText, caseNumber);
  const plausible = ranked.filter((candidate) => candidate.score >= 55);
  const selected = plausible.slice(0, 3);
  if (selected.length < 3) {
    for (const candidate of ranked) {
      if (selected.some((item) => normalizeDiagnosisKey(item.text) === normalizeDiagnosisKey(candidate.text))) {
        continue;
      }
      selected.push(candidate);
      if (selected.length >= 3) {
        break;
      }
    }
  }
  return selected.slice(0, 3).map((candidate) => candidate.text);
}

function buildDiagnosisQuestion(caseData, allCases, caseNumber, caseBankCases = [], { multipleChoice = true } = {}) {
  const correctText = normalizeText(caseData.caseTitle || caseData.diagnosisQuery);
  const distractors = multipleChoice
    ? selectDiagnosisDistractors(caseData, allCases, caseBankCases, correctText, caseNumber)
    : [];
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

function firstCaseImage(caseData) {
  return (caseData.images || []).find((image) => imageLocalPath(image)) || null;
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

  const verbalImage = firstCaseImage(caseData);
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

function coreReviewExerciseType(caseData, caseNumber, anatomyQuestion) {
  const hasImage = Boolean(firstCaseImage(caseData));
  const preferred = CORE_REVIEW_CASE_EXERCISE_SEQUENCE[(caseNumber - 1) % CORE_REVIEW_CASE_EXERCISE_SEQUENCE.length];
  if (!hasImage && ["structure_card", "pin_abnormality", "pin_anatomy"].includes(preferred)) {
    return "diagnosis_open";
  }
  if (preferred === "pin_anatomy" && !anatomyQuestion?.answerText) {
    return hasImage ? "pin_abnormality" : "diagnosis_open";
  }
  return preferred;
}

function buildCoreReviewStructureFindingPrompt(caseData, anatomyQuestion, exerciseType) {
  const image = anatomyQuestion?.image || firstCaseImage(caseData);
  if (!image) {
    return null;
  }

  const regionText = buildVerbalAnatomyAnswer(caseData);
  const specificAnatomy = normalizeText(anatomyQuestion?.answerText || regionText);
  const isPinAnatomy = exerciseType === "pin_anatomy";
  const isPinAbnormality = exerciseType === "pin_abnormality";
  const stem = isPinAnatomy
    ? `Pin: ${specificAnatomy || "the specified anatomy"}.`
    : "Pin the abnormality.";

  return {
    stem,
    answerText: isPinAnatomy ? specificAnatomy : (regionText || "Abnormality"),
    image,
    hotspot: anatomyQuestion?.hotspot || null,
    showPromptMarker: false,
    promptLabel: isPinAbnormality ? "Pin Abnormality" : "Pin Anatomy",
    answerTitle: isPinAbnormality ? "Abnormality / Finding" : "Structure / Finding",
  };
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

function questionOptions(question) {
  return Array.isArray(question?.options) ? question.options : [];
}

function answerTextForQuestion(question) {
  const options = questionOptions(question);
  if (question.type === "single_best_answer") {
    const option = options.find((candidate) => candidate.id === question.answerKey);
    return option ? `${option.id}. ${option.text}` : question.answerKey || "Answer not supplied";
  }

  if (question.type === "numeric_fill_blank") {
    const value = question.numericAnswer?.value;
    const units = normalizeText(question.numericAnswer?.units || "");
    return collapseWhitespace([value, units].filter((piece) => piece !== null && piece !== undefined && piece !== "").join(" "));
  }

  if (question.type === "multi_correct") {
    const answerKeys = Array.isArray(question.answerKeys) ? question.answerKeys : [];
    const keyed = options.filter((option) => answerKeys.includes(option.id));
    if (keyed.length) {
      return keyed.map((option) => `${option.id}. ${option.text}`).join("\n");
    }
    return answerKeys.join(", ");
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

async function addCoreReviewDiagnosisQuestionSlide(
  slide,
  caseData,
  caseNumber,
  deckTitle,
  theme,
  allCases,
  caseBankCases,
  { multipleChoice = true } = {},
) {
  slide.background = { color: cleanColor(theme.colors.imageBg) };
  addTopBar(slide, deckTitle, theme, { dark: true });
  const descriptor = caseDescriptor(caseData);
  const question = buildDiagnosisQuestion(caseData, allCases, caseNumber, caseBankCases, { multipleChoice });
  const options = questionOptions(question);

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

  if (!options.length) {
    await addImageGallery(
      slide,
      caseData.images || [],
      { left: 72, top: 96, width: 1136, height: 456 },
      { emptyMessage: "No selected images for this case." },
    );

    addShape(
      slide,
      "roundRect",
      { left: 96, top: 578, width: 1088, height: 74 },
      theme.colors.panel,
      theme.colors.border,
      1.1,
    );
    addText(
      slide,
      question.stem,
      { left: 126, top: 596, width: 680, height: 34 },
      theme,
      {
        fontSize: 30,
        color: theme.colors.ink,
        face: theme.fonts.title,
        bold: true,
      },
    );
    addText(
      slide,
      "Answer verbally before advancing.",
      { left: 842, top: 607, width: 294, height: 18 },
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
    return;
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

  addText(
    slide,
    options.map((option) => `${option.id}. ${option.text}`).join("\n"),
    { left: 90, top: 522, width: 920, height: 104 },
    theme,
    {
      fontSize: 20,
      color: theme.colors.ink,
      face: theme.fonts.body,
    },
  );

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

async function addCoreReviewAnatomyQuestionSlide(
  slide,
  caseData,
  caseNumber,
  deckTitle,
  theme,
  anatomyQuestion,
  { showMarker = false } = {},
) {
  slide.background = { color: cleanColor(theme.colors.imageBg) };
  addTopBar(slide, deckTitle, theme, { dark: true });

  addText(
    slide,
    `Case ${caseNumber} • ${anatomyQuestion.promptLabel || "Structure / Finding Question"}`,
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
    showMarker && anatomyQuestion.hotspot
      ? {
          marker: {
            image: anatomyQuestion.image,
            hotspot: anatomyQuestion.hotspot,
          },
        }
      : {},
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

async function addCoreReviewAnatomyAnswerSlide(
  slide,
  caseData,
  caseNumber,
  deckTitle,
  theme,
  anatomyQuestion,
  { title = "Structure / Finding" } = {},
) {
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
    title,
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
  const options = questionOptions(question);

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
    if (options.length) {
      addText(
        slide,
        options.map((option) => `${option.id}. ${option.text}`).join("\n"),
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

    if (options.length) {
      addText(
        slide,
        options.map((option) => `${option.id}. ${option.text}`).join("\n"),
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

function normalizeOpenXmlCoordinateAttributes(xml) {
  return xml.replace(OPENXML_COORDINATE_ATTR_PATTERN, (_match, attr, value) => {
    return `${attr}="${Math.round(Number(value))}"`;
  });
}

function normalizePresentationXmlOrder(xml) {
  const notesMatch = /<p:notesMasterIdLst\b[\s\S]*?<\/p:notesMasterIdLst>/.exec(xml);
  const slideListMatch = /<p:sldIdLst\b/.exec(xml);
  if (!notesMatch || !slideListMatch || notesMatch.index < slideListMatch.index) {
    return xml;
  }

  const withoutNotes = `${xml.slice(0, notesMatch.index)}${xml.slice(notesMatch.index + notesMatch[0].length)}`;
  const slideListIndex = withoutNotes.indexOf("<p:sldIdLst");
  if (slideListIndex < 0) {
    return xml;
  }

  return `${withoutNotes.slice(0, slideListIndex)}${notesMatch[0]}${withoutNotes.slice(slideListIndex)}`;
}

function removePowerPointCreationIdExtensions(xml) {
  return xml.replace(POWERPOINT_CREATION_ID_EXT_PATTERN, "");
}

function removeDanglingContentTypeOverrides(xml, entryNames) {
  return xml.replace(/<Override\b[^>]*\bPartName="\/([^"]+)"[^>]*\/>/g, (match, partName) => {
    return entryNames.has(partName) ? match : "";
  });
}

async function normalizePowerPointPackage(filePath) {
  const buffer = await fs.readFile(filePath);
  const zip = await JSZip.loadAsync(buffer);
  const entryNames = new Set(Object.entries(zip.files)
    .filter(([, entry]) => !entry.dir)
    .map(([entryName]) => entryName));
  let changed = false;

  for (const [entryName, entry] of Object.entries(zip.files)) {
    if (entry.dir) {
      continue;
    }

    const shouldNormalize =
      entryName === "[Content_Types].xml" ||
      entryName === "ppt/presentation.xml" ||
      OPENXML_POSITIONABLE_ENTRY_PATTERN.test(entryName);

    if (!shouldNormalize) {
      continue;
    }

    const xml = await entry.async("string");
    let normalized = xml;
    if (entryName === "[Content_Types].xml") {
      normalized = removeDanglingContentTypeOverrides(normalized, entryNames);
    }
    if (entryName === "ppt/presentation.xml") {
      normalized = normalizePresentationXmlOrder(normalized);
    }
    if (NOTES_SLIDE_XML_ENTRY_PATTERN.test(entryName)) {
      normalized = removePowerPointCreationIdExtensions(normalized);
    }
    if (OPENXML_POSITIONABLE_ENTRY_PATTERN.test(entryName)) {
      normalized = normalizeOpenXmlCoordinateAttributes(normalized);
    }

    if (normalized !== xml) {
      zip.file(entryName, normalized);
      changed = true;
    }
  }

  if (!changed) {
    return;
  }

  const normalizedBuffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  await fs.writeFile(filePath, normalizedBuffer);
}

async function resolveCoreReviewCaseBankCases(coreReviewCaseBank, coreReviewCaseBankPath) {
  if (Array.isArray(coreReviewCaseBank)) {
    return coreReviewCaseBank;
  }
  if (Array.isArray(coreReviewCaseBank?.cases)) {
    return coreReviewCaseBank.cases;
  }
  try {
    const bank = await loadCoreReviewCaseBank(coreReviewCaseBankPath || "");
    return Array.isArray(bank?.cases) ? bank.cases : [];
  } catch {
    return [];
  }
}

async function addCoreReviewCaseExerciseSlides({
  addSlide,
  caseData,
  caseNumber,
  deckTitle,
  theme,
  cases,
  caseBankCases,
}) {
  const anatomyQuestion = buildCaseAnatomyQuestion(caseData);
  const exerciseType = coreReviewExerciseType(caseData, caseNumber, anatomyQuestion);

  if (exerciseType === "structure_card") {
    const cardPrompt = buildCoreReviewStructureFindingPrompt(caseData, anatomyQuestion, exerciseType);
    if (cardPrompt) {
      await addCoreReviewAnatomyAnswerSlide(
        addSlide(),
        caseData,
        caseNumber,
        deckTitle,
        theme,
        cardPrompt,
        { title: cardPrompt.answerTitle },
      );
      return;
    }
  }

  if (exerciseType === "pin_abnormality" || exerciseType === "pin_anatomy") {
    const pinPrompt = buildCoreReviewStructureFindingPrompt(caseData, anatomyQuestion, exerciseType);
    if (pinPrompt) {
      await addCoreReviewAnatomyQuestionSlide(
        addSlide(),
        caseData,
        caseNumber,
        deckTitle,
        theme,
        pinPrompt,
        { showMarker: pinPrompt.showPromptMarker },
      );
      await addCoreReviewAnatomyAnswerSlide(
        addSlide(),
        caseData,
        caseNumber,
        deckTitle,
        theme,
        pinPrompt,
        { title: pinPrompt.answerTitle },
      );
      return;
    }
  }

  await addCoreReviewDiagnosisQuestionSlide(
    addSlide(),
    caseData,
    caseNumber,
    deckTitle,
    theme,
    cases,
    caseBankCases,
    { multipleChoice: exerciseType === "diagnosis_mcq" },
  );
  addDiagnosisSlide(addSlide(), caseData, caseNumber, deckTitle, theme);
}

export async function buildDeck({
  cases,
  deckTitle,
  outputPath,
  scratchDir,
  deckMode = DECK_MODES.caseConference,
  coreReviewQuestions = [],
  coreReviewCaseBank = null,
  coreReviewCaseBankPath = "",
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
  const coreReviewCaseBankCases =
    activeDeckMode === DECK_MODES.coreReview
      ? await resolveCoreReviewCaseBankCases(coreReviewCaseBank, coreReviewCaseBankPath)
      : [];
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
      await addCoreReviewCaseExerciseSlides({
        addSlide,
        caseData,
        caseNumber,
        deckTitle,
        theme: activeTheme,
        cases,
        caseBankCases: coreReviewCaseBankCases,
      });
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
  await normalizePowerPointPackage(outputPath);

  return {
    outputPath,
    slideCount,
  };
}
