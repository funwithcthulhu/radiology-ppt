import fs from "node:fs/promises";
import path from "node:path";
import pptxgen from "pptxgenjs";

const SHAPE_TYPES = new pptxgen().ShapeType;
const W = 1280;
const H = 720;
const SLIDE_W = 13.333333;
const SLIDE_H = 7.5;
const SX = SLIDE_W / W;
const SY = SLIDE_H / H;
const TRANSPARENT = "#00000000";
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

async function addImage(slide, imagePath, position, alt) {
  const frame = pos(position);
  slide.addImage({
    path: imagePath,
    ...frame,
    sizing: { type: "contain", ...frame },
    altText: alt,
  });
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

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
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

function addSpeakerNotes(slide, caseData, caseNumber) {
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
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

function imageLayouts(count) {
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
  for (let index = 0; index < layouts.length; index += 1) {
    const frame = layouts[index];
    const image = caseData.images[index];

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
    { left: 82, top: 216, width: 1116, height: 102 },
    theme,
    {
      fontSize: 34,
      color: theme.colors.accentDark,
      face: theme.fonts.title,
      bold: true,
    },
  );

  addShape(
    slide,
    "roundRect",
    { left: 82, top: 352, width: 1116, height: 226 },
    theme.colors.panel,
    theme.colors.border,
    1.1,
  );
  addText(
    slide,
    caseData.revealSummary,
    { left: 114, top: 392, width: 1050, height: 148 },
    theme,
    {
      fontSize: 24,
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
    { left: 82, top: 212, width: 1116, height: 42 },
    theme,
    {
      fontSize: 26,
      color: theme.colors.accentDark,
      face: theme.fonts.body,
      bold: true,
      autoFit: null,
    },
  );

  const bullets = Array.isArray(caseData.teachingPoints) ? caseData.teachingPoints.filter(Boolean) : [];
  bullets.slice(0, 3).forEach((bullet, index) => {
    const top = 292 + index * 124;
    addShape(slide, "ellipse", { left: 92, top: top + 10, width: 16, height: 16 }, theme.colors.accent, TRANSPARENT, 0);
    addText(
      slide,
      bullet,
      { left: 126, top, width: 1040, height: 104 },
      theme,
      {
        fontSize: 23,
        color: theme.colors.ink,
        face: theme.fonts.body,
      },
    );
  });

  addFooter(slide, caseData.footerText, theme);
  addSpeakerNotes(slide, caseData, caseNumber);
}

export async function buildDeck({
  cases,
  deckTitle,
  outputPath,
  scratchDir,
  deckMode = DECK_MODES.caseConference,
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
  const teachingSlideTitle = activeDeckMode === DECK_MODES.coreReview ? "Core Review" : "Teaching Points";
  let slideCount = 0;

  const addSlide = () => {
    slideCount += 1;
    return presentation.addSlide();
  };

  for (let index = 0; index < cases.length; index += 1) {
    const caseNumber = index + 1;
    const caseData = cases[index];

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
