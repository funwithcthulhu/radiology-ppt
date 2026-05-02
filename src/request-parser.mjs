import { cleanText, collapseWhitespace, dedupe } from "./utils.mjs";

const MODALITY_HINTS = [
  { label: "MRI", patterns: [/\bmri\b/i, /\bmr\b/i, /\bmagnetic resonance\b/i] },
  { label: "CT", patterns: [/\bct\b/i, /\bcomputed tomography\b/i, /\bcat scan\b/i] },
  { label: "X-ray", patterns: [/\bx-?ray\b/i, /\bradiograph(?:y|ic)?\b/i, /\bcxr\b/i] },
  { label: "Ultrasound", patterns: [/\bultrasound\b/i, /\bsonograph(?:y|ic)?\b/i, /\bus\b/i] },
  { label: "Fluoroscopy", patterns: [/\bfluoro(?:scopy)?\b/i] },
  { label: "PET", patterns: [/\bpet\b/i] },
  { label: "Mammography", patterns: [/\bmammograph(?:y|ic)?\b/i, /\bmammo\b/i] },
  { label: "Angiography", patterns: [/\bangiograph(?:y|ic)?\b/i, /\bangio\b/i] },
];
const RANDOM_REQUEST_LIMIT = 20;
const RANDOM_DIRECTIVE_PATTERNS = [
  /\brandom\b/gi,
  /\bdiagnos(?:is|es)\b/gi,
  /\bcases?\b/gi,
  /\bstud(?:y|ies)\b/gi,
  /\bpick\b/gi,
  /\bchoose\b/gi,
  /\bfind\b/gi,
  /\bfrom\b/gi,
  /\bcategory\b/gi,
  /\bplease\b/gi,
  /\bjust\b/gi,
  /\bme\b/gi,
];
const BODY_SYSTEMS = ["Chest", "Gastrointestinal", "Hepatobiliary", "Urogenital", "Gynaecology", "Obstetrics"];
const RANDOM_CATEGORY_HINTS = [
  {
    systems: ["Central Nervous System"],
    aliases: ["neuro", "neuroradiology", "cns", "brain", "brain imaging", "neuraxial"],
  },
  {
    systems: ["Paediatrics"],
    aliases: ["pediatric", "pediatrics", "paediatric", "paediatrics", "peds", "peds", "child", "children", "pediatric imaging", "paediatric imaging"],
  },
  {
    systems: ["Musculoskeletal"],
    aliases: ["msk", "musculoskeletal", "muskuloskeletal", "muskuloskletal", "orthopedic", "orthopaedic", "ortho", "bone", "joint", "extremity", "sports"],
  },
  {
    systems: BODY_SYSTEMS,
    aliases: ["body", "body imaging", "abdominal imaging", "abdominopelvic", "abdomen pelvis"],
    mode: "any",
  },
  {
    systems: ["Chest"],
    aliases: ["chest", "thoracic", "thorax", "lung", "pulmonary"],
  },
  {
    systems: ["Cardiac"],
    aliases: ["cardiac", "cardio", "cardiology", "heart"],
  },
  {
    systems: ["Head & Neck"],
    aliases: ["head neck", "head and neck", "h n", "hn", "ent", "orbit", "orbits", "sinus", "sinuses", "temporal bone", "maxillofacial"],
  },
  {
    systems: ["Spine"],
    aliases: ["spine", "spinal"],
  },
  {
    systems: ["Gastrointestinal"],
    aliases: ["gi", "gastrointestinal", "gastro", "abdomen", "abdominal", "bowel"],
  },
  {
    systems: ["Hepatobiliary"],
    aliases: ["hepatobiliary", "biliary", "liver", "pancreas", "pancreatic"],
  },
  {
    systems: ["Urogenital"],
    aliases: ["urogenital", "genitourinary", "gu", "urology", "renal", "kidney", "bladder", "pelvis", "pelvic", "prostate", "testicular"],
  },
  {
    systems: ["Breast"],
    aliases: ["breast", "breast imaging", "mammography", "mammo"],
  },
  {
    systems: ["Vascular"],
    aliases: ["vascular", "vascular imaging"],
  },
  {
    systems: ["Trauma"],
    aliases: ["trauma", "trauma imaging"],
  },
  {
    systems: ["Oncology"],
    aliases: ["oncology", "oncologic", "cancer"],
  },
  {
    systems: ["Obstetrics"],
    aliases: ["obstetrics", "obstetric", "ob", "fetal", "prenatal"],
  },
  {
    systems: ["Gynaecology"],
    aliases: ["gynaecology", "gynecology", "gyn", "pelvic", "uterine", "ovarian", "adnexal"],
  },
  {
    systems: ["Haematology"],
    aliases: ["haematology", "hematology"],
  },
  {
    systems: ["Interventional"],
    aliases: ["interventional", "ir", "interventional radiology"],
  },
  {
    systems: ["Forensic"],
    aliases: ["forensic"],
  },
];
const IMPLICIT_STUDY_QUERY_TERMS = [
  "brain",
  "head",
  "neck",
  "sinus",
  "orbits",
  "orbit",
  "spine",
  "spinal",
  "chest",
  "thorax",
  "thoracic",
  "lung",
  "heart",
  "cardiac",
  "abdomen",
  "abdominal",
  "pelvis",
  "pelvic",
  "body",
  "breast",
  "extremity",
  "shoulder",
  "elbow",
  "wrist",
  "hand",
  "hip",
  "knee",
  "ankle",
  "foot",
  "bone",
  "joint",
  "soft",
  "tissue",
  "fetal",
  "pediatric",
  "paediatric",
  "child",
  "children",
  "adult",
  "neonatal",
  "neonate",
];
export const KNOWN_CASE_SYSTEMS = dedupe(RANDOM_CATEGORY_HINTS.flatMap((hint) => hint.systems));
const STRUCTURED_RANDOM_MODES = new Set(["random", "random_case"]);
const AGE_GROUP_QUERY_TERMS = {
  adult: "adult",
  pediatric: "pediatric",
  neonatal: "neonatal",
};
const TOPIC_QUERY_TERMS = {
  tumor: "tumor",
  trauma: "trauma",
  infection: "infection",
  vascular: "vascular",
  congenital: "congenital",
};
const FILTER_SYSTEM_MAP = {
  pediatric: ["Paediatrics"],
  neonatal: ["Paediatrics"],
  trauma: ["Trauma"],
  vascular: ["Vascular"],
};

function isAnyValue(value) {
  const normalized = normalizePhrase(value);
  return !normalized || normalized === "any" || normalized === "auto";
}

function buildStructuredStudyHint(payload) {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  if (payload.studyHint && !isAnyValue(payload.studyHint)) {
    return collapseWhitespace(payload.studyHint);
  }

  const modality = isAnyValue(payload.modality) ? "" : collapseWhitespace(payload.modality);
  const anatomy = isAnyValue(payload.anatomy) ? "" : collapseWhitespace(payload.anatomy);
  return collapseWhitespace([modality, anatomy].filter(Boolean).join(" "));
}

function normalizedAgeGroup(value) {
  const normalized = normalizePhrase(value);
  if (normalized.startsWith("ped")) {
    return "pediatric";
  }
  if (normalized.startsWith("neo")) {
    return "neonatal";
  }
  if (normalized.startsWith("adult")) {
    return "adult";
  }
  return "";
}

function normalizedTopicFocus(value) {
  const normalized = normalizePhrase(value);
  if (normalized.startsWith("tum")) {
    return "tumor";
  }
  if (normalized.startsWith("trau")) {
    return "trauma";
  }
  if (normalized.startsWith("inf")) {
    return "infection";
  }
  if (normalized.startsWith("vas")) {
    return "vascular";
  }
  if (normalized.startsWith("cong")) {
    return "congenital";
  }
  return "";
}

export function normalizedDifficulty(value) {
  const normalized = normalizePhrase(value);
  return ["easy", "medium", "hard"].includes(normalized) ? normalized : "";
}

export function canonicalCropMode(value) {
  const normalized = normalizePhrase(value);
  if (normalized === "tighter") {
    return "tighter";
  }
  if (normalized === "wider") {
    return "wider";
  }
  return "default";
}

export function canonicalMarkupStyle(value) {
  const normalized = normalizePhrase(value);
  if (normalized === "focus ring") {
    return "focus-ring";
  }
  return "none";
}

function buildStructuredFilterQuery(payload) {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  const bits = [];
  const ageGroup = normalizedAgeGroup(payload.ageGroup);
  const topicFocus = normalizedTopicFocus(payload.topicFocus);
  if (ageGroup) {
    bits.push(AGE_GROUP_QUERY_TERMS[ageGroup]);
  }
  if (topicFocus) {
    bits.push(TOPIC_QUERY_TERMS[topicFocus]);
  }
  return collapseWhitespace(bits.join(" "));
}

function filterSystemsFromPayload(payload) {
  if (!payload || typeof payload !== "object") {
    return [];
  }

  const systems = [];
  const ageGroup = normalizedAgeGroup(payload.ageGroup);
  const topicFocus = normalizedTopicFocus(payload.topicFocus);
  if (ageGroup && FILTER_SYSTEM_MAP[ageGroup]) {
    systems.push(...FILTER_SYSTEM_MAP[ageGroup]);
  }
  if (topicFocus && FILTER_SYSTEM_MAP[topicFocus]) {
    systems.push(...FILTER_SYSTEM_MAP[topicFocus]);
  }
  return dedupe(systems.map((value) => collapseWhitespace(value)).filter(Boolean));
}

function buildPreferredModalities(payload, studyHint) {
  const matches = [...preferredModalitiesFromHint(studyHint)];
  if (payload && typeof payload === "object" && !isAnyValue(payload.secondaryModality)) {
    matches.push(collapseWhitespace(payload.secondaryModality));
  }
  return dedupe(matches.map((value) => collapseWhitespace(value)).filter(Boolean));
}

function buildStructuredRandomSpec(payload, studyHint) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const requestMode = normalizePhrase(payload.requestMode || "");
  const hasStructuredRandom =
    STRUCTURED_RANDOM_MODES.has(requestMode) ||
    Number.isInteger(payload.randomCount) ||
    Boolean(payload.randomQuery) ||
    Boolean(payload.randomSystems?.length);

  if (!hasStructuredRandom) {
    return null;
  }

  const parsedCount = Number.parseInt(String(payload.randomCount ?? "1"), 10);
  const count = Number.isInteger(parsedCount) && parsedCount > 0 ? parsedCount : 1;
  const systems = dedupe(
    [...(payload.randomSystems ?? []), ...filterSystemsFromPayload(payload)]
      .map((value) => collapseWhitespace(value))
      .filter(Boolean),
  );
  const filterQuery = buildStructuredFilterQuery(payload);
  const queryText = collapseWhitespace(
    [payload.randomQuery || stripCategoryTerms(stripModalityTerms(studyHint)), filterQuery].filter(Boolean).join(" "),
  );

  return {
    count: Math.max(1, Math.min(RANDOM_REQUEST_LIMIT, count)),
    systems,
    queryText,
    studyHintText: collapseWhitespace(studyHint),
    systemMode: normalizePhrase(payload.randomSystemMode) === "any" ? "any" : "all",
    diversify: normalizePhrase(payload.randomDiversity) === "mixed" ? "mixed" : "",
  };
}

function buildStructuredRawInput(payload, diagnosis, studyHint, randomSpec, filterQuery = "") {
  if (payload.rawInput && !isAnyValue(payload.rawInput)) {
    return collapseWhitespace(payload.rawInput);
  }

  if (randomSpec) {
    const parts = ["Random"];
    if (randomSpec.count > 1) {
      parts.push(String(randomSpec.count));
    }
    if (randomSpec.systems.length) {
      parts.push(randomSpec.systems.join(" / "));
    }
    if (studyHint) {
      parts.push(studyHint);
    } else if (randomSpec.queryText) {
      parts.push(randomSpec.queryText);
    }
    if (filterQuery && !parts.includes(filterQuery)) {
      parts.push(filterQuery);
    }
    return collapseWhitespace(parts.join(" | "));
  }

  return collapseWhitespace([diagnosis, studyHint, filterQuery].filter(Boolean).join(", "));
}

export function normalizePhrase(value) {
  return collapseWhitespace(String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " "));
}

function wordTokens(value) {
  return dedupe(
    normalizePhrase(value)
      .split(/\s+/)
      .filter(Boolean)
      .filter((token) => token.length > 1),
  );
}

export function tokenOverlapScore(left, right) {
  const leftTokens = wordTokens(left);
  const rightTokens = wordTokens(right);
  if (!leftTokens.length || !rightTokens.length) {
    return 0;
  }

  const rightSet = new Set(rightTokens);
  const overlap = leftTokens.filter((token) => rightSet.has(token)).length;
  return overlap / Math.max(leftTokens.length, rightTokens.length);
}

function levenshteinDistance(left, right) {
  const a = normalizePhrase(left);
  const b = normalizePhrase(right);
  if (!a) return b.length;
  if (!b) return a.length;

  const rows = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i += 1) rows[i][0] = i;
  for (let j = 0; j <= b.length; j += 1) rows[0][j] = j;

  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      rows[i][j] = Math.min(
        rows[i - 1][j] + 1,
        rows[i][j - 1] + 1,
        rows[i - 1][j - 1] + cost,
      );
    }
  }

  return rows[a.length][b.length];
}

export function similarityScore(left, right) {
  const normalizedLeft = normalizePhrase(left);
  const normalizedRight = normalizePhrase(right);
  if (!normalizedLeft || !normalizedRight) {
    return 0;
  }

  const overlap = tokenOverlapScore(normalizedLeft, normalizedRight);
  const maxLength = Math.max(normalizedLeft.length, normalizedRight.length);
  const editScore = maxLength ? 1 - levenshteinDistance(normalizedLeft, normalizedRight) / maxLength : 0;

  let score = Math.max(overlap, editScore);
  if (normalizedRight.includes(normalizedLeft) || normalizedLeft.includes(normalizedRight)) {
    score = Math.max(score, 0.94);
  }

  return Math.min(0.99, score);
}

export function preferredModalitiesFromHint(studyHint) {
  const hint = collapseWhitespace(studyHint);
  if (!hint) {
    return [];
  }

  const matches = [];
  for (const modality of MODALITY_HINTS) {
    if (modality.patterns.some((pattern) => pattern.test(hint))) {
      matches.push(modality.label);
    }
  }

  return dedupe(matches);
}

export function stripModalityTerms(studyHint) {
  let working = normalizePhrase(studyHint);
  for (const modality of MODALITY_HINTS) {
    working = replaceAllPatterns(working, modality.patterns);
  }
  return collapseWhitespace(working);
}

function replaceAllPatterns(text, patterns) {
  let output = text;
  for (const pattern of patterns) {
    const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
    output = output.replace(new RegExp(pattern.source, flags), " ");
  }
  return output;
}

function findAliasMatch(text, aliases) {
  const tokens = wordTokens(text);
  if (!tokens.length) {
    return null;
  }

  let bestMatch = null;
  for (const alias of dedupe(aliases.map((value) => normalizePhrase(value)).filter(Boolean))) {
    const aliasTokens = wordTokens(alias);
    if (!aliasTokens.length) {
      continue;
    }

    const lengths = dedupe([
      aliasTokens.length,
      Math.max(1, aliasTokens.length - 1),
      aliasTokens.length + 1,
    ]);

    for (const length of lengths) {
      if (length > tokens.length) {
        continue;
      }

      for (let index = 0; index <= tokens.length - length; index += 1) {
        const segment = tokens.slice(index, index + length).join(" ");
        const score = segment === alias ? 1 : similarityScore(segment, alias);
        const threshold =
          aliasTokens.length === 1
            ? alias.length <= 3
              ? 1
              : alias.length <= 5
                ? 0.92
                : 0.84
            : 0.8;
        if (score < threshold) {
          continue;
        }

        if (
          !bestMatch ||
          score > bestMatch.score ||
          (score === bestMatch.score && segment.length > bestMatch.matched.length)
        ) {
          bestMatch = {
            alias,
            matched: segment,
            score,
          };
        }
      }
    }
  }

  return bestMatch;
}

function removeMatchedPhrase(text, phrase) {
  const tokens = wordTokens(text);
  const phraseTokens = wordTokens(phrase);
  if (!tokens.length || !phraseTokens.length || phraseTokens.length > tokens.length) {
    return collapseWhitespace(text);
  }

  for (let index = 0; index <= tokens.length - phraseTokens.length; index += 1) {
    const segment = tokens.slice(index, index + phraseTokens.length);
    if (segment.join(" ") === phraseTokens.join(" ")) {
      return collapseWhitespace(
        [...tokens.slice(0, index), ...tokens.slice(index + phraseTokens.length)].join(" "),
      );
    }
  }

  return collapseWhitespace(text);
}

function detectCategoryHints(text) {
  let working = normalizePhrase(text);
  const systems = [];
  const matches = [];

  for (const hint of RANDOM_CATEGORY_HINTS) {
    const match = findAliasMatch(working, hint.aliases || []);
    if (!match) {
      continue;
    }

    const hintSystems =
      hint.mode === "any" && Array.isArray(hint.systems) && hint.systems.length
        ? [hint.systems[Math.floor(Math.random() * hint.systems.length)]]
        : hint.systems || [];

    systems.push(...hintSystems);
    matches.push(match.matched);
    working = removeMatchedPhrase(working, match.matched);
  }

  return {
    systems: dedupe(systems),
    matches: dedupe(matches),
    remaining: collapseWhitespace(working),
  };
}

function stripCategoryTerms(text) {
  let working = normalizePhrase(text);
  let previous = null;
  while (working && working !== previous) {
    previous = working;
    const detected = detectCategoryHints(working);
    if (!detected.matches.length) {
      break;
    }
    for (const matched of detected.matches) {
      working = removeMatchedPhrase(working, matched);
    }
  }
  return collapseWhitespace(working);
}

function isImplicitStudyQuery(queryText) {
  const remaining = stripCategoryTerms(queryText);
  const tokens = wordTokens(remaining);
  if (!tokens.length) {
    return true;
  }

  return tokens.every((token) => IMPLICIT_STUDY_QUERY_TERMS.includes(token));
}

function parseRandomDirective(rawText) {
  const normalized = normalizePhrase(rawText);
  if (!normalized) {
    return null;
  }

  let working = normalized;
  const countMatch = working.match(/\b(\d{1,2})\b/);
  const count = countMatch ? Number.parseInt(countMatch[1], 10) : 1;
  if (countMatch) {
    working = working.replace(countMatch[0], " ");
  }

  const hasRandomKeyword = /\brandom\b/i.test(normalized);
  const categoryDetection = detectCategoryHints(working);
  const systems = [...categoryDetection.systems];
  working = categoryDetection.remaining;

  working = replaceAllPatterns(working, RANDOM_DIRECTIVE_PATTERNS);
  const queryText = collapseWhitespace(working);
  const isDirectiveOnly = !queryText && (hasRandomKeyword || systems.length > 0 || Boolean(countMatch));

  if (hasRandomKeyword || isDirectiveOnly) {
    return {
      count: Math.max(1, Math.min(RANDOM_REQUEST_LIMIT, count)),
      systems: dedupe(systems),
      queryText,
      studyHintText: "",
    };
  }

  const hasModality = preferredModalitiesFromHint(rawText).length > 0;
  const strippedStudyHint = stripModalityTerms(rawText);
  const impliedSystems = dedupe([...systems, ...detectCategoryHints(strippedStudyHint).systems]);
  const implicitQueryText = collapseWhitespace(stripCategoryTerms(strippedStudyHint));

  if ((hasModality || impliedSystems.length > 0) && isImplicitStudyQuery(implicitQueryText)) {
    return {
      count: Math.max(1, Math.min(RANDOM_REQUEST_LIMIT, count)),
      systems: impliedSystems,
      queryText: implicitQueryText,
      studyHintText: collapseWhitespace(rawText),
    };
  }

  return null;
}

export function titleFromCasePath(casePath) {
  const slug = String(casePath ?? "")
    .replace(/^\/cases\//, "")
    .replace(/\?.*$/, "")
    .replace(/-\d+$/, "");

  return cleanText(slug.replace(/-/g, " "));
}

export function parseCaseRequest(input) {
  const payload = typeof input === "string" ? { rawInput: input } : { ...(input ?? {}) };
  const requestMode = normalizePhrase(payload.requestMode || "");
  const structuredStudyHint = buildStructuredStudyHint(payload);
  const structuredRandomSpec = buildStructuredRandomSpec(payload, structuredStudyHint);
  const filterQuery = buildStructuredFilterQuery(payload);
  const preferredModalities = buildPreferredModalities(payload, structuredStudyHint);
  const searchSystems = filterSystemsFromPayload(payload);
  const difficulty = normalizedDifficulty(payload.difficulty);
  const cropMode = canonicalCropMode(payload.cropMode || "");
  const markupStyle = canonicalMarkupStyle(payload.markupStyle || "");

  if (requestMode === "manual" || payload.selectedCasePath) {
    const selectedCasePath = collapseWhitespace(payload.selectedCasePath || "");
    const diagnosis =
      collapseWhitespace(payload.diagnosis || payload.selectedCaseTitle || titleFromCasePath(selectedCasePath));
    const studyHint = structuredStudyHint;
    const rawInput =
      buildStructuredRawInput(payload, diagnosis, studyHint, null, filterQuery) || selectedCasePath;

    return {
      ...payload,
      rawInput,
      diagnosis,
      studyHint,
      filterQuery,
      searchSystems,
      difficulty,
      cropMode,
      markupStyle,
      randomSpec: null,
      preferredModalities,
      searchText: collapseWhitespace([diagnosis, studyHint, filterQuery].filter(Boolean).join(" ")),
    };
  }

  if (requestMode === "specific" || structuredRandomSpec) {
    const diagnosis = collapseWhitespace(payload.diagnosis || "");
    const studyHint = structuredStudyHint;
    const rawInput = buildStructuredRawInput(payload, diagnosis, studyHint, structuredRandomSpec, filterQuery);

    return {
      ...payload,
      rawInput,
      diagnosis,
      studyHint,
      filterQuery,
      searchSystems,
      difficulty,
      cropMode,
      markupStyle,
      randomSpec: structuredRandomSpec,
      preferredModalities,
      searchText: collapseWhitespace([diagnosis, studyHint, filterQuery].filter(Boolean).join(" ")),
    };
  }

  let rawInput = collapseWhitespace(
    payload.rawInput || payload.query || payload.diagnosisQuery || payload.diagnosis || "",
  );
  let diagnosis = collapseWhitespace(payload.diagnosis || "");
  let studyHint = collapseWhitespace(payload.studyHint || "");

  if (!diagnosis && rawInput) {
    const pipeParts = rawInput.split("|").map((item) => collapseWhitespace(item)).filter(Boolean);
    if (pipeParts.length > 1) {
      [diagnosis, ...pipeParts] = pipeParts;
      studyHint = studyHint || pipeParts.join(" | ");
    } else {
      const commaParts = rawInput.split(",").map((item) => collapseWhitespace(item)).filter(Boolean);
      diagnosis = commaParts.shift() || rawInput;
      if (!studyHint && commaParts.length) {
        studyHint = commaParts.join(", ");
      }
    }
  }

  diagnosis = diagnosis || rawInput;
  rawInput = rawInput || collapseWhitespace([diagnosis, studyHint].filter(Boolean).join(", "));
  const randomSpec = parseRandomDirective(diagnosis || rawInput);
  if (!studyHint && randomSpec?.studyHintText) {
    studyHint = randomSpec.studyHintText;
  }

  return {
    ...payload,
    rawInput,
    diagnosis,
    studyHint,
    filterQuery,
    searchSystems,
    difficulty,
    cropMode,
    markupStyle,
    randomSpec,
    preferredModalities: buildPreferredModalities(payload, studyHint),
    searchText: collapseWhitespace([diagnosis, studyHint, filterQuery].filter(Boolean).join(" ")),
  };
}
