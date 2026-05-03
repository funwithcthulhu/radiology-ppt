import { cleanText, collapseWhitespace, redactTerms, truncate } from "./utils.mjs";
import { normalizePhrase, normalizedDifficulty } from "./request-parser.mjs";

function extractFirst(pattern, text) {
  const match = pattern.exec(text);
  return match ? match[1] : null;
}

export function extractPatientData(html) {
  const text = cleanText(html);
  const patientSection = extractFirst(
    /\bPatient Data\b(.*?)(?:\bFrom the case:|\bCase Discussion\b|\bDiscussion\b|\bFindings\b|\bImaging\b|$)/i,
    text,
  ) || "";
  const source = patientSection || text;
  const age = cleanText(extractFirst(/\bAge:\s*(.*?)(?=\s+(?:Gender|Sex):|$)/i, source));
  const gender = cleanText(extractFirst(/\b(?:Gender|Sex):\s*(.*?)(?=\s+(?:From the case:|Case Discussion|Discussion|Findings|Imaging|CT|MRI|X-ray|Ultrasound|Fluoroscopy|PET|$))/i, source));
  return {
    age: scrubPatientDataValue(age),
    gender: scrubPatientDataValue(gender),
  };
}

function scrubPatientDataValue(value) {
  return collapseWhitespace(value)
    .replace(/\b(?:Presentation|From the case:|Case Discussion|Discussion|Findings|Imaging)\b.*$/i, "")
    .replace(/[.;:,]+$/g, "")
    .trim();
}

function formatPatientAgeForIntro(age) {
  const text = scrubPatientDataValue(age);
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
    const unit = unitMap[unitMatch[2].toLowerCase()] || unitMatch[2].toLowerCase();
    return `${unitMatch[1]}-${unit}-old`;
  }

  if (/^(adult|pediatric|paediatric|neonatal|infant|child|adolescent|elderly)$/i.test(text)) {
    return text.toLowerCase().replace("paediatric", "pediatric");
  }

  return text;
}

function formatPatientGenderForIntro(gender) {
  const text = scrubPatientDataValue(gender).toLowerCase();
  if (!text) {
    return "";
  }
  if (/^m(?:ale)?$/.test(text)) {
    return "male";
  }
  if (/^f(?:emale)?$/.test(text)) {
    return "female";
  }
  return text;
}

function articleForPhrase(phrase) {
  return /^(?:8|11|18|adult|elderly|infant|adolescent|[aeiou])/i.test(phrase) ? "an" : "a";
}

function buildDemographicIntro(patientData) {
  const age = formatPatientAgeForIntro(patientData?.age);
  const gender = formatPatientGenderForIntro(patientData?.gender);

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

export function buildClinicalHistoryText({ request, patientData }) {
  if (!request.includeClinicalHistory) {
    return "";
  }
  if (normalizedDifficulty(request.difficulty) === "hard") {
    return "";
  }

  return buildDemographicIntro(patientData);
}

function cleanRedactedTeachingText(text) {
  return cleanText(text)
    .replace(/\[[^\]]*hidden[^\]]*\]/gi, " ")
    .replace(/\bcase of\s+(?:acute|chronic|typical|classic)\s+(?=with\b|without\b|in\b|on\b|for\b|$)/gi, "case ")
    .replace(/\bcase of\s+(?=with\b|without\b|in\b|on\b|for\b|$)/gi, "case ")
    .replace(/\btypical\s+(?=with\b|without\b|in\b|on\b|for\b|$)/gi, "typical presentation ")
    .replace(/\bconsistent\s+(?=with\b|without\b|in\b|on\b|for\b|$)/gi, "consistent appearance ")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/^[,.;:\-\s]+/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function sentenceSafeTrim(text, maxLength = 220) {
  const clean = collapseWhitespace(text);
  if (clean.length <= maxLength) {
    return clean;
  }

  const withoutTerminal = clean.replace(/[.!?]+$/u, "");
  const boundary = withoutTerminal.lastIndexOf(" ", maxLength - 1);
  const cutAt = boundary >= Math.floor(maxLength * 0.6) ? boundary : maxLength - 1;
  return withoutTerminal.slice(0, cutAt).trim();
}

function normalizeTeachingPoint(sentence) {
  return sentenceSafeTrim(cleanRedactedTeachingText(sentence))
    .replace(/(?:\.\.\.|…)+$/g, "")
    .replace(/[;:,]+$/g, ".")
    .replace(/(?<![.!?])$/u, ".")
    .trim();
}

export function buildTeachingPoints({ request, description, findings, diagnosis, caseTitle, modalitySummary, images }) {
  const bullets = [];
  const seen = new Set();

  const candidateSentences = [findings, description]
    .filter(Boolean)
    .flatMap((text) => cleanText(text).split(/(?<=[.!?])\s+/));

  for (const sentence of candidateSentences) {
    const bullet = normalizeTeachingPoint(redactTerms(sentence, [diagnosis, caseTitle]));
    const key = normalizePhrase(bullet);
    if (!bullet || bullet.length < 18 || seen.has(key)) {
      continue;
    }
    seen.add(key);
    bullets.push(bullet);
    if (bullets.length >= 3) {
      break;
    }
  }

  if (bullets.length < 2 && request.studyHint) {
    const studyBullet = `Focus on the ${request.studyHint} images where the abnormality is most conspicuous.`;
    const key = normalizePhrase(studyBullet);
    if (!seen.has(key)) {
      seen.add(key);
      bullets.push(studyBullet);
    }
  }

  if (bullets.length < 3 && modalitySummary) {
    const modalityBullet = `This case is best reviewed as a ${modalitySummary} teaching example with ${images.length} selected image${images.length === 1 ? "" : "s"}.`;
    const key = normalizePhrase(modalityBullet);
    if (!seen.has(key)) {
      seen.add(key);
      bullets.push(modalityBullet);
    }
  }

  return bullets.slice(0, 3);
}

export function buildPromptText(rawText, diagnosis, caseTitle) {
  const cleaned = cleanText(rawText);
  if (!cleaned) {
    return "Review the images on the next slide and identify the most likely diagnosis.";
  }

  const redacted = redactTerms(cleaned, [diagnosis, caseTitle]);
  if (!redacted || redacted === cleaned || redacted.length < 50) {
    return "Review the images on the next slide and identify the most likely diagnosis.";
  }

  return truncate(redacted, 430);
}
