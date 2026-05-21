import fs from "node:fs/promises";
import path from "node:path";
import { collapseWhitespace, slugify } from "../utils.mjs";
import {
  normalizeCoreReviewQuestion,
  validateCoreReviewQuestion,
} from "./quiz.mjs";
import { normalizeCoreReviewDomain } from "./schema.mjs";

function hashSeed(value) {
  let hash = 5381;
  for (const char of String(value || "")) {
    hash = ((hash << 5) + hash + char.charCodeAt(0)) >>> 0;
  }
  return hash >>> 0;
}

function seededRandom(seed) {
  let state = hashSeed(seed) || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
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

function uniqueBy(items, keyFn) {
  const seen = new Set();
  const unique = [];
  for (const item of items) {
    const key = keyFn(item);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(item);
  }
  return unique;
}

function cleanSentence(text) {
  return collapseWhitespace(
    String(text || "")
      .replace(/^[\s>*#\-\u2022\d.)]+/, "")
      .replace(/\[(?:\d+|citation needed)\]/gi, "")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

function sentenceTitleCaseRatio(sentence) {
  const words = collapseWhitespace(sentence).split(/\s+/).filter(Boolean);
  const candidates = words.filter((word) => /[a-z]/i.test(word));
  if (!candidates.length) {
    return 0;
  }
  const titled = candidates.filter(
    (word) =>
      /^[A-Z][a-z0-9()/+-]*$/.test(word) ||
      /^[A-Z0-9()/+-]{2,}$/.test(word),
  );
  return titled.length / candidates.length;
}

function isLikelySourceNoise(sentence) {
  const clean = collapseWhitespace(sentence);
  if (!clean) {
    return true;
  }
  if (
    /\b(?:doi|cureus|copyright|creative commons|how to cite|submitted|published|review began|review ended|peer review|open access|corresponding author|et al\.)\b/i.test(
      clean,
    )
  ) {
    return true;
  }
  if (
    /(?:\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\s+[A-Z]{1,3},\s*){2,}/.test(
      clean,
    )
  ) {
    return true;
  }
  if (/\b(?:Acta Neurochir|Neurol India|J Neurol Surg Rep|Radiology|AJNR|AJR)\b/i.test(clean)) {
    return true;
  }
  if (/^(?:categories|keywords|references?)\s*:/i.test(clean)) {
    return true;
  }
  if (/\b\d+\s+of\s+\d+\b/i.test(clean)) {
    return true;
  }
  const words = clean.split(/\s+/);
  const hasSentencePunctuation = /[.?!]$/.test(clean);
  const hasPredicate =
    /\b(?:is|are|was|were|be|being|been|has|have|had|show(?:s|ed|ing)?|demonstrat(?:es|ed|ing)?|reveal(?:s|ed|ing)?|depict(?:s|ed|ing)?|suggest(?:s|ed|ing)?|indicat(?:es|ed|ing)?|require(?:s|d)?|improv(?:es|ed|ing)?|worsen(?:s|ed|ing)?|increase(?:s|d|ing)?|decrease(?:s|d|ing)?|reduce(?:s|d|ing)?|lead(?:s|ing)?|caus(?:es|ed|ing)?|present(?:s|ed|ing)?|manage(?:s|d|ment)|diagnos(?:is|ed|tic)|treat(?:s|ed|ment))\b/i.test(
      clean,
    );
  if (!hasPredicate) {
    return true;
  }
  if (!hasSentencePunctuation && words.length <= 12 && sentenceTitleCaseRatio(clean) >= 0.65) {
    return true;
  }
  return false;
}

function splitChunkIntoSentences(text) {
  const lines = String(text || "")
    .replace(/\r\n/g, "\n")
    .split(/\n+/)
    .map(cleanSentence)
    .filter(Boolean);
  const sentences = [];
  for (const line of lines) {
    for (const piece of line.split(/(?<=[.?!])\s+(?=[A-Z0-9(])/)) {
      const candidate = cleanSentence(piece);
      if (!candidate) {
        continue;
      }
      const normalized = candidate.replace(/[;:,]+$/, "");
      const wordCount = normalized.split(/\s+/).length;
      if (wordCount < 6 || normalized.length < 36 || normalized.length > 220) {
        continue;
      }
      if (!/[a-z]/i.test(normalized) || /https?:\/\//i.test(normalized)) {
        continue;
      }
      if (isLikelySourceNoise(normalized)) {
        continue;
      }
      sentences.push(normalized);
    }
  }
  return uniqueBy(sentences, (sentence) => sentence.toLowerCase());
}

function normalizeStemTopic(topic, fallbackTitle) {
  const clean = collapseWhitespace(
    String(topic || "").replace(/^[,;:\-]+|[,;:\-]+$/g, ""),
  );
  if (!clean || clean.length < 4) {
    return collapseWhitespace(fallbackTitle || "the source concept");
  }
  return clean.replace(/^(a|an|the)\s+/i, "");
}

function splitAtKeyword(sentence, keywords) {
  const lowered = sentence.toLowerCase();
  for (const keyword of keywords) {
    const index = lowered.indexOf(keyword);
    if (index > 1) {
      return {
        before: cleanSentence(sentence.slice(0, index)),
        after: cleanSentence(sentence.slice(index + keyword.length)),
        keyword,
      };
    }
  }
  return null;
}

function classifySentence(sentence, domain) {
  if (
    /\b(should|must|recommended|recommend|requires?|avoid|document|verify|notify|contact|communicate|screen|report)\b/i.test(
      sentence,
    )
  ) {
    return "recommendation";
  }
  if (
    domain === "physics" &&
    /\b(increase|decrease|higher|lower|double|half|halve|reduce|raise|widen|narrow|improve|worsen|aliasing|exposure|dose|signal|pitch|distance)\b/i.test(
      sentence,
    )
  ) {
    return "effect";
  }
  if (/\b(is|are|refers to|means|represents|defined as)\b/i.test(sentence)) {
    return "definition";
  }
  return "fact";
}

function shortenOptionText(text, maxLength = 108) {
  const clean = collapseWhitespace(String(text || "").replace(/[;:,]+$/, ""));
  if (!clean) {
    return "";
  }
  const firstClause =
    clean
      .split(/;|, (?=(?:which|that|while|because|although)\b)/i)[0]
      ?.trim() || clean;
  if (firstClause.length <= maxLength) {
    return firstClause.replace(/[.?!]$/, "");
  }
  const clipped = firstClause.slice(0, maxLength);
  const boundary = clipped.lastIndexOf(" ");
  return `${(boundary > 40 ? clipped.slice(0, boundary) : clipped).trim()}...`;
}

function swapKeywords(text, replacements) {
  let swapped = String(text || "");
  let changed = false;
  for (const [pattern, replacement] of replacements) {
    if (pattern.test(swapped)) {
      swapped = swapped.replace(pattern, replacement);
      changed = true;
    }
  }
  return changed ? shortenOptionText(swapped) : "";
}

function oppositeOption(correctText, domain, style) {
  const swapped =
    swapKeywords(correctText, [
      [/\bincrease(s|d|ing)?\b/gi, "decrease$1"],
      [/\bdecrease(s|d|ing)?\b/gi, "increase$1"],
      [/\braise(s|d)?\b/gi, "lower$1"],
      [/\blower(s|ed|ing)?\b/gi, "raise$1"],
      [/\breduce(s|d|ing)?\b/gi, "increase$1"],
      [/\bimprove(s|d|ing)?\b/gi, "worsen$1"],
      [/\bworsen(s|ed|ing)?\b/gi, "improve$1"],
      [/\bhigher\b/gi, "lower"],
      [/\blower\b/gi, "higher"],
      [/\bmore\b/gi, "less"],
      [/\bless\b/gi, "more"],
      [/\bdirectly\b/gi, "indirectly"],
      [/\bimmediately\b/gi, "only after a routine delay"],
      [/\breliable\b/gi, "informal"],
    ]) || "";
  if (
    swapped &&
    swapped.toLowerCase() !== String(correctText || "").toLowerCase()
  ) {
    return swapped;
  }

  if (style === "recommendation") {
    return domain === "nis"
      ? "Routine follow-up is usually enough, even without direct verification or documentation"
      : "No specific action is needed because the described issue rarely affects interpretation";
  }
  if (style === "effect") {
    return "It has the opposite effect from the one described in the source";
  }
  return domain === "physics"
    ? "It only affects post-processing and does not change acquisition, dose, or signal"
    : "It is mainly an administrative detail rather than a safety or practice concept";
}

function distractorPool(domain, style) {
  if (domain === "physics") {
    return style === "effect"
      ? [
          "It has no meaningful effect on the outcome described",
          "It always improves image quality while reducing dose in every setting",
          "It only changes report wording and not the imaging result itself",
        ]
      : [
          "It is mainly a billing term rather than an imaging or safety concept",
          "It eliminates the need for standard equipment or patient safety checks",
          "It only matters after images are post-processed and not during acquisition",
        ];
  }

  return style === "recommendation"
    ? [
        "It can usually wait for routine follow-up without closed-loop communication",
        "It is best handled by focusing on individual blame rather than system review",
        "It does not need to be documented once the immediate task is finished",
      ]
    : [
        "It is mainly a financial issue rather than a patient-safety or workflow concept",
        "It removes the need for standard verification or communication steps",
        "It applies only to research settings and not to everyday radiology practice",
      ];
}

function buildReference(source, chunk) {
  const page =
    Number.isInteger(chunk?.sourceLocator?.page) && chunk.sourceLocator.page > 0
      ? `p. ${chunk.sourceLocator.page}`
      : Number.isInteger(chunk?.pageStart) && chunk.pageStart > 0
        ? chunk.pageEnd && chunk.pageEnd !== chunk.pageStart
          ? `pp. ${chunk.pageStart}-${chunk.pageEnd}`
          : `p. ${chunk.pageStart}`
        : "";
  const label = collapseWhitespace(
    [source?.title || "Imported source", page].filter(Boolean).join(" • "),
  );
  return label ? [{ label }] : [];
}

function resolveCorpusAsset(asset, corpusPath) {
  if (!asset || typeof asset !== "object") {
    return asset;
  }
  if (asset.localPath || !asset.path || !corpusPath) {
    return asset;
  }
  return {
    ...asset,
    localPath: path.resolve(path.dirname(corpusPath), asset.path),
  };
}

const PDF_IMAGE_ASSET_TYPES = new Set([
  "embedded_image",
  "figure_crop",
  "page_render",
]);
const MIN_PDF_IMAGE_CONFIDENCE = 0.6;

function clampConfidence(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  if (numeric > 1 && numeric <= 100) {
    return Math.max(0, Math.min(1, numeric / 100));
  }
  return Math.max(0, Math.min(1, numeric));
}

function confidenceFromValue(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  if (value && typeof value === "object") {
    return confidenceFromValue(
      value.value ??
        value.score ??
        value.confidence ??
        value.probability ??
        value.level,
    );
  }

  if (typeof value === "string") {
    const clean = value.trim().toLowerCase();
    if (clean.endsWith("%")) {
      return clampConfidence(clean.slice(0, -1));
    }
    if (clean === "high" || clean === "strong") {
      return 0.9;
    }
    if (clean === "medium" || clean === "moderate" || clean === "reasonable") {
      return 0.7;
    }
    if (clean === "low" || clean === "weak") {
      return 0.35;
    }
  }

  return clampConfidence(value);
}

function firstConfidence(...values) {
  for (const value of values) {
    const confidence = confidenceFromValue(value);
    if (confidence !== null) {
      return confidence;
    }
  }
  return null;
}

function normalizeIdList(values) {
  if (!Array.isArray(values)) {
    return [];
  }
  return values
    .map((value) => {
      if (typeof value === "string") {
        return value;
      }
      return value?.id || value?.assetId || value?.sourceAssetId || "";
    })
    .map((value) => collapseWhitespace(value))
    .filter(Boolean);
}

function normalizeAssetObjectList(values) {
  if (!Array.isArray(values)) {
    return [];
  }
  return values.filter((value) => value && typeof value === "object");
}

function normalizeAssetMatchList(values) {
  if (!Array.isArray(values)) {
    return [];
  }
  return values
    .filter((value) => value && typeof value === "object")
    .map((match) => ({
      ...match,
      assetId: collapseWhitespace(
        match.assetId || match.id || match.sourceAssetId || "",
      ),
    }))
    .filter((match) => match.assetId);
}

function assetMatchFor(asset, assetMatches) {
  const assetId = collapseWhitespace(asset?.id || asset?.sourceAssetId || "");
  if (!assetId) {
    return null;
  }
  return assetMatches.find((match) => match.assetId === assetId) || null;
}

function chunkAssetIds(chunk) {
  return uniqueBy(
    [
      ...normalizeIdList(chunk?.assetIds),
      ...normalizeIdList(chunk?.imageAssetIds),
      ...normalizeIdList(chunk?.assets),
      ...normalizeIdList(chunk?.images),
    ],
    (value) => value,
  );
}

function chunkAssetObjects(chunk) {
  return uniqueBy(
    [
      ...normalizeAssetObjectList(chunk?.assets),
      ...normalizeAssetObjectList(chunk?.images),
    ],
    (asset) =>
      asset.id || asset.sourceAssetId || asset.localPath || asset.path,
  );
}

function chunkPageNumber(chunk) {
  const value =
    chunk?.sourceLocator?.page ??
    chunk?.locator?.page ??
    chunk?.pageNumber ??
    chunk?.pageStart;
  const pageNumber = Number(value);
  return Number.isInteger(pageNumber) && pageNumber > 0 ? pageNumber : 0;
}

function assetPageNumber(asset) {
  const value = asset?.pageNumber ?? asset?.page ?? asset?.locator?.page;
  const pageNumber = Number(value);
  return Number.isInteger(pageNumber) && pageNumber > 0 ? pageNumber : 0;
}

function sameKnownSource(asset, source, chunk) {
  const assetSourceId = collapseWhitespace(asset?.sourceId || "");
  const chunkSourceId = collapseWhitespace(chunk?.sourceId || "");
  const sourceId = collapseWhitespace(source?.id || "");
  const expectedSourceId = chunkSourceId || sourceId;
  return (
    !assetSourceId || !expectedSourceId || assetSourceId === expectedSourceId
  );
}

function inferredImageConfidence(asset, source, chunk, assetIds) {
  const assetMatch = assetMatchFor(
    asset,
    normalizeAssetMatchList(chunk?.assetMatches),
  );
  const explicit = firstConfidence(
    assetMatch?.confidence,
    assetMatch?.score && assetMatch.score > 1
      ? Math.min(1, Number(assetMatch.score) / 100)
      : null,
    chunk?.imageMatchConfidence,
    asset?.confidence,
    asset?.assetConfidence,
    asset?.matchConfidence,
    asset?.linkConfidence,
    asset?.sourceConfidence,
    asset?.provenance?.confidence,
    asset?.locator?.confidence,
  );
  if (explicit !== null) {
    return {
      confidence: explicit,
      confidenceSource:
        assetMatch?.confidenceSource ||
        chunk?.imageMatchConfidenceSource ||
        "explicit",
      matchReason:
        assetMatch?.reason || chunk?.imageMatchReason || assetMatch?.caption || "",
      caption: assetMatch?.caption || "",
      assetMatch,
    };
  }

  if (assetIds.includes(asset?.id)) {
    return {
      confidence: 0.9,
      confidenceSource: "chunk_asset_id",
      matchReason: assetMatch?.reason || chunk?.imageMatchReason || "",
      caption: assetMatch?.caption || "",
      assetMatch,
    };
  }

  const pageNumber = assetPageNumber(asset);
  const chunkPage = chunkPageNumber(chunk);
  if (
    pageNumber &&
    chunkPage &&
    pageNumber === chunkPage &&
    sameKnownSource(asset, source, chunk)
  ) {
    return {
      confidence: 0.7,
      confidenceSource: "same_page",
      matchReason: "same_page",
      caption: "",
      assetMatch,
    };
  }

  if (sameKnownSource(asset, source, chunk)) {
    return {
      confidence: 0.45,
      confidenceSource: "same_source",
      matchReason: "same_source",
      caption: "",
      assetMatch,
    };
  }

  return {
    confidence: 0,
    confidenceSource: "source_mismatch",
    matchReason: "source_mismatch",
    caption: "",
    assetMatch,
  };
}

function imageAssetCandidate(asset, source, chunk, assetIds) {
  if (!asset || !PDF_IMAGE_ASSET_TYPES.has(asset.type)) {
    return null;
  }
  const localPath = collapseWhitespace(asset.localPath || asset.path || "");
  if (!localPath || !sameKnownSource(asset, source, chunk)) {
    return null;
  }
  const confidence = inferredImageConfidence(asset, source, chunk, assetIds);
  if (confidence.confidence < MIN_PDF_IMAGE_CONFIDENCE) {
    return null;
  }
  const pageDistance =
    assetPageNumber(asset) && chunkPageNumber(chunk)
      ? Math.abs(assetPageNumber(asset) - chunkPageNumber(chunk))
      : 0;
  const typeRank =
    asset.type === "figure_crop" ? 3 : asset.type === "embedded_image" ? 2 : 1;
  return {
    asset,
    ...confidence,
    pageDistance,
    typeRank,
  };
}

function preferredAssetForChunk(chunk, source, assetsById) {
  const assetIds = chunkAssetIds(chunk);
  const referencedAssets = assetIds
    .map((assetId) => assetsById.get(assetId))
    .filter(Boolean);
  const inlineAssets = chunkAssetObjects(chunk);
  const candidates = uniqueBy(
    [...referencedAssets, ...inlineAssets],
    (asset) =>
      asset.id || asset.sourceAssetId || asset.localPath || asset.path,
  )
    .map((asset) => imageAssetCandidate(asset, source, chunk, assetIds))
    .filter(Boolean)
    .sort(
      (left, right) =>
        right.confidence - left.confidence ||
        left.pageDistance - right.pageDistance ||
        right.typeRank - left.typeRank,
    );
  return candidates[0] || null;
}

function sourceImageProvenance(asset, source, chunk, confidence) {
  return {
    ...(asset.provenance && typeof asset.provenance === "object"
      ? asset.provenance
      : {}),
    source: asset.provenance?.source || "imported_pdf",
    sourceId: asset.sourceId || chunk?.sourceId || source?.id || "",
    sourceTitle: source?.title || "",
    sourceType: source?.sourceType || "pdf",
    sourceAssetId: asset.id || "",
    sourceChunkId: chunk?.id || "",
    sourceAssetType: asset.type || "",
    confidence: confidence.confidence,
    confidenceSource: confidence.confidenceSource,
    matchReason: confidence.matchReason || "",
  };
}

function sourceImageLocator(asset, chunk, candidate = {}) {
  const pageNumber = assetPageNumber(asset) || chunkPageNumber(chunk);
  return {
    ...(asset.locator && typeof asset.locator === "object"
      ? asset.locator
      : {}),
    pageNumber,
    page: pageNumber,
    chunkPageStart: chunk?.pageStart || 0,
    chunkPageEnd: chunk?.pageEnd || chunk?.pageStart || 0,
    sourceLocator: chunk?.sourceLocator || null,
    bbox: asset?.bbox || asset?.locator?.bbox || null,
    caption: candidate.caption || chunk?.sourceLocator?.caption || "",
    matchReason:
      candidate.matchReason || chunk?.sourceLocator?.imageMatchReason || "",
  };
}

function imageForSourceAsset(candidate, source, chunk) {
  if (!candidate?.asset) {
    return null;
  }
  const { asset } = candidate;
  const localPath = collapseWhitespace(asset.localPath || asset.path || "");
  if (!localPath) {
    return null;
  }
  const pageNumber = assetPageNumber(asset) || chunkPageNumber(chunk);
  const provenance = sourceImageProvenance(asset, source, chunk, candidate);
  const locator = sourceImageLocator(asset, chunk, candidate);
  return {
    id: asset.id,
    path: localPath,
    localPath,
    label: collapseWhitespace(
      [
        source?.title || "Imported source",
        pageNumber ? `page ${pageNumber}` : "",
        asset.type === "figure_crop"
          ? "figure crop"
          : asset.type === "embedded_image"
            ? "embedded image"
            : "page image",
      ]
        .filter(Boolean)
        .join(" - "),
    ),
    alt: collapseWhitespace(
      [
        "Imported PDF source image",
        source?.title || "",
        pageNumber ? `page ${pageNumber}` : "",
      ]
        .filter(Boolean)
        .join(" - "),
    ),
    sourceId: asset.sourceId || chunk?.sourceId || source?.id || "",
    sourceAssetId: asset.id || "",
    sourceChunkId: chunk?.id || "",
    sourceAssetType: asset.type || "",
    pageNumber,
    width: asset.width || 0,
    height: asset.height || 0,
    confidence: candidate.confidence,
    confidenceSource: candidate.confidenceSource,
    matchReason: candidate.matchReason || "",
    caption: candidate.caption || "",
    provenance,
    locator,
  };
}

function buildQuestionStem(style, domain, topic, sourceTitle) {
  const normalizedTopic = normalizeStemTopic(topic, sourceTitle);
  if (style === "recommendation") {
    return domain === "nis"
      ? `Which response is most appropriate for ${normalizedTopic.toLowerCase()}?`
      : `Which action best matches the source guidance on ${normalizedTopic.toLowerCase()}?`;
  }
  if (style === "effect") {
    return `What effect is described for ${normalizedTopic.toLowerCase()}?`;
  }
  if (style === "definition") {
    return `Which statement best describes ${normalizedTopic.toLowerCase()}?`;
  }
  return domain === "physics"
    ? `Which statement is most accurate according to the source material?`
    : `Which statement best matches the source material?`;
}

function buildCorrectOption(sentence, style, sourceTitle) {
  if (style === "definition") {
    const match = splitAtKeyword(sentence, [
      " refers to ",
      " means ",
      " represents ",
      " is ",
      " are ",
      " defined as ",
    ]);
    if (match?.after) {
      return shortenOptionText(match.after);
    }
  }

  if (style === "recommendation") {
    const match = splitAtKeyword(sentence, [
      " should ",
      " must ",
      " requires ",
      " require ",
      " recommended ",
      " recommend ",
      " avoid ",
      " document ",
      " verify ",
      " notify ",
      " contact ",
      " communicate ",
      " report ",
    ]);
    if (match) {
      const action =
        match.keyword.trim() === "avoid"
          ? `Avoid ${match.after}`
          : `${match.keyword.trim().replace(/ed$/, "")} ${match.after}`.replace(
              /^recommend /i,
              "Recommend ",
            );
      return shortenOptionText(action);
    }
  }

  return shortenOptionText(sentence || sourceTitle);
}

function topicFromSentence(sentence, style, sourceTitle) {
  if (style === "definition") {
    return (
      splitAtKeyword(sentence, [
        " refers to ",
        " means ",
        " represents ",
        " is ",
        " are ",
        " defined as ",
      ])?.before || sourceTitle
    );
  }
  if (style === "recommendation") {
    return (
      splitAtKeyword(sentence, [
        " should ",
        " must ",
        " requires ",
        " require ",
        " recommended ",
        " recommend ",
        " avoid ",
        " document ",
        " verify ",
        " notify ",
        " contact ",
        " communicate ",
        " report ",
      ])?.before || sourceTitle
    );
  }
  if (style === "effect") {
    return (
      splitAtKeyword(sentence, [
        " increases ",
        " increase ",
        " decreases ",
        " decrease ",
        " reduces ",
        " reduce ",
        " raises ",
        " raise ",
        " widens ",
        " widens ",
        " narrows ",
        " improve ",
        " improves ",
        " worsens ",
        " worsen ",
      ])?.before || sourceTitle
    );
  }
  return sourceTitle;
}

function isGenericQuestionTopic(topic) {
  const normalized = collapseWhitespace(topic).replace(/^(?:a|an|the)\s+/i, "");
  return /^(?:this|that|these|those|it|condition|finding|findings|case|cases|two cases(?:, one)?|both cases|patient|patients|medical professional)$/i.test(
    normalized,
  );
}

function buildOptionSet(correctText, domain, style, seed) {
  const distractors = [
    oppositeOption(correctText, domain, style),
    ...distractorPool(domain, style),
  ]
    .map((option) => shortenOptionText(option))
    .filter(Boolean)
    .filter((option) => option.toLowerCase() !== correctText.toLowerCase());
  const pickedDistractors = uniqueBy(distractors, (option) =>
    option.toLowerCase(),
  ).slice(0, 3);
  if (pickedDistractors.length < 3) {
    return { options: [], answerKey: "" };
  }

  const choices = shuffle(
    [
      { text: correctText, correct: true },
      ...pickedDistractors.map((text) => ({ text, correct: false })),
    ],
    seed,
  ).slice(0, 4);
  const optionIds = ["A", "B", "C", "D"];
  const options = choices.map((choice, index) => ({
    id: optionIds[index],
    text: choice.text,
  }));
  const answerKey =
    options.find((_, index) => choices[index].correct)?.id || "";
  return { options, answerKey };
}

function hasDiagnosticImageAsset(candidate) {
  return ["figure_crop", "embedded_image"].includes(candidate?.asset?.type || "");
}

function hasFigureImageCaption(candidate, chunk) {
  return /^(?:fig(?:ure)?\.?|image)\s*\d+/i.test(
    collapseWhitespace(
      [
        candidate?.caption || "",
        chunk?.sourceLocator?.caption || "",
        candidate?.asset?.caption || "",
      ].join(" "),
    ),
  );
}

function isCaptionStubChunk(chunk) {
  const text = collapseWhitespace(chunk?.text || "");
  return /^(?:fig(?:ure)?\.?|image)\s*\d+/i.test(text) && !hasFindingTerm(text);
}

function cleanFigureFindingText(text) {
  return collapseWhitespace(
    String(text || "")
      .replace(/\b(?:fig(?:ure)?\.?\s*\d+|image\s*\d+|table\s*\d+)\s*[:.)-]*/gi, " ")
      .replace(/\b(?:arrow|arrows|case\s*\d+)\b/gi, " ")
      .replace(/\([^)]*\)/g, " ")
      .replace(/\s+/g, " "),
  );
}

function hasFindingTerm(text) {
  return /\b(?:hematoma|haematoma|hemorrhage|haemorrhage|hyperdense|hypodense|mass|lesion|collection|fracture|edema|oedema|infarct|aneurysm|occlusion|stenosis|abscess|pneumothorax|effusion|consolidation|nodule|exposure|dose|signal|artifact|geometry)\b/i.test(
    text,
  );
}

function imageFindingCandidatesFromText(text) {
  const clean = cleanFigureFindingText(text);
  const findings = [];
  const findingPatterns = [
    /\b(?:showing|demonstrating|revealing|depicting|showed|demonstrated|revealed|depicted|shows|demonstrates|reveals|depicts)\s+(?:an?|the)?\s*([^.;]+(?:suggestive of [^.;]+)?)/gi,
    /\b(?:suggestive of|consistent with|compatible with|representing)\s+(?:an?|the)?\s*([^.;]+)/gi,
  ];

  for (const pattern of findingPatterns) {
    let match;
    while ((match = pattern.exec(clean))) {
      const finding = cleanFigureFindingText(match[1]);
      const nestedFinding = cleanFigureFindingText(
        splitAtKeyword(finding, [
          " showing ",
          " demonstrating ",
          " revealing ",
          " depicting ",
          " shows ",
          " demonstrates ",
          " reveals ",
          " depicts ",
        ])?.after || "",
      );
      const wordCount = finding.split(/\s+/).filter(Boolean).length;
      if (wordCount >= 3 && finding.length >= 18 && hasFindingTerm(finding)) {
        findings.push(finding);
      }
      const nestedWordCount = nestedFinding.split(/\s+/).filter(Boolean).length;
      if (
        nestedWordCount >= 3 &&
        nestedFinding.length >= 18 &&
        hasFindingTerm(nestedFinding)
      ) {
        findings.push(nestedFinding);
      }
    }
  }

  if (!findings.length && hasFindingTerm(clean) && clean.split(/\s+/).length >= 7) {
    findings.push(clean);
  }

  return uniqueBy(findings, (finding) => finding.toLowerCase());
}

function imageFindingScore(finding) {
  const text = collapseWhitespace(finding);
  let score = Math.min(text.length, 140);
  if (hasFindingTerm(text)) {
    score += 120;
  }
  if (/\b(?:biconvex|hyperdense|hypodense|collection|attenuation|mass effect|midline shift|subgaleal|extra-axial|extracalvarial)\b/i.test(text)) {
    score += 60;
  }
  if (/\b(?:non-contrast|noncontrast|axial|coronal|sagittal|ct|mri|mr)\b/i.test(text)) {
    score -= 35;
  }
  if (/\b(?:showing|demonstrating|revealing|depicting)\b/i.test(text)) {
    score -= 80;
  }
  return score;
}

function extractImageFindingText(source, chunk, candidate) {
  const chunkText = cleanFigureFindingText(chunk?.text || "");
  const captionText = cleanFigureFindingText(
    [
      candidate?.caption || "",
      chunk?.sourceLocator?.caption || "",
      candidate?.asset?.caption || "",
    ]
      .filter(Boolean)
      .join(" "),
  );
  const candidates = [
    ...imageFindingCandidatesFromText(chunkText),
    ...imageFindingCandidatesFromText(captionText),
    ...imageFindingCandidatesFromText([chunkText, captionText].join(" ")),
  ];
  if (!candidates.length) {
    return "";
  }

  const selected = candidates.sort(
    (left, right) => imageFindingScore(right) - imageFindingScore(left),
  )[0];
  const correctText = shortenOptionText(selected, 132);
  if (
    !correctText ||
    correctText.length < 24 ||
    /^case\s*\d+$/i.test(correctText) ||
    correctText.toLowerCase() ===
      collapseWhitespace(source?.title || "").toLowerCase()
  ) {
    return "";
  }
  return correctText;
}

function imageFindingDistractors(domain) {
  if (domain === "physics") {
    return [
      "a detector exposure relationship unrelated to the displayed source figure",
      "a post-processing-only artifact without an acquisition effect",
      "a normal acquisition setup without a measurable exposure change",
    ];
  }

  return [
    "a crescentic extra-axial collection crossing sutures, favoring subdural hematoma",
    "diffuse subarachnoid hemorrhage centered in the basal cisterns",
    "an intraparenchymal basal ganglia hemorrhage with surrounding edema",
    "a normal noncontrast head CT without extra-axial hemorrhage",
  ];
}

function buildImageFindingOptionSet(correctText, domain, seed) {
  const distractors = imageFindingDistractors(domain)
    .map((option) => shortenOptionText(option, 132))
    .filter((option) => option.toLowerCase() !== correctText.toLowerCase());
  const pickedDistractors = uniqueBy(distractors, (option) =>
    option.toLowerCase(),
  ).slice(0, 3);
  if (pickedDistractors.length < 3) {
    return { options: [], answerKey: "" };
  }

  const choices = shuffle(
    [
      { text: correctText, correct: true },
      ...pickedDistractors.map((text) => ({ text, correct: false })),
    ],
    seed,
  ).slice(0, 4);
  const optionIds = ["A", "B", "C", "D"];
  const options = choices.map((choice, index) => ({
    id: optionIds[index],
    text: choice.text,
  }));
  const answerKey =
    options.find((_, index) => choices[index].correct)?.id || "";
  return { options, answerKey };
}

function imageFindingStem(chunk, candidate) {
  const text = collapseWhitespace(
    [
      candidate?.caption || "",
      chunk?.sourceLocator?.caption || "",
      chunk?.text || "",
    ].join(" "),
  );
  if (/\bCT\b|computed tomography|non-contrast|noncontrast/i.test(text)) {
    return "On the linked CT image, which finding is described by the source?";
  }
  if (/\bMR\b|MRI\b|magnetic resonance/i.test(text)) {
    return "On the linked MR image, which finding is described by the source?";
  }
  return "On the linked source image, which finding is described by the source?";
}

function draftImageFindingQuestion(source, chunk, assetsById) {
  const domain = normalizeCoreReviewDomain(
    chunk?.domain || source?.domain || "",
  );
  if (!domain) {
    return null;
  }
  const candidate = preferredAssetForChunk(chunk, source, assetsById);
  if (!hasDiagnosticImageAsset(candidate) || !hasFigureImageCaption(candidate, chunk)) {
    return null;
  }
  if (isCaptionStubChunk(chunk)) {
    return null;
  }
  const correctText = extractImageFindingText(source, chunk, candidate);
  if (!correctText) {
    return null;
  }
  const { options, answerKey } = buildImageFindingOptionSet(
    correctText,
    domain,
    `${chunk.id}:image-finding`,
  );
  if (options.length < 4 || !answerKey) {
    return null;
  }

  return {
    id: `${slugify(chunk.id || source?.id || "core-review-source") || "core-review-source"}-image-q01`,
    type: "single_best_answer",
    domain,
    difficulty: "core",
    cognitiveLevel: "image_finding",
    stem: imageFindingStem(chunk, candidate),
    options,
    answerKey,
    explanation: `Source-grounded image item based on ${source?.title || "an imported source"}.`,
    image: imageForSourceAsset(candidate, source, chunk),
    references: buildReference(source, chunk),
    sourceChunkIds: [chunk.id],
  };
}

function draftQuestionFromSentence(source, chunk, sentence, index, assetsById) {
  const domain = normalizeCoreReviewDomain(
    chunk?.domain || source?.domain || "",
  );
  if (!domain) {
    return null;
  }

  const style = classifySentence(sentence, domain);
  const topic = topicFromSentence(
    sentence,
    style,
    source?.title || "Imported source",
  );
  if (isGenericQuestionTopic(topic)) {
    return null;
  }
  const correctText = buildCorrectOption(
    sentence,
    style,
    source?.title || "Imported source",
  );
  if (!correctText || correctText.length < 18) {
    return null;
  }

  const stem = buildQuestionStem(
    style,
    domain,
    topic,
    source?.title || "Imported source",
  );
  const { options, answerKey } = buildOptionSet(
    correctText,
    domain,
    style,
    `${chunk.id}:${index}`,
  );
  if (options.length < 4 || !answerKey) {
    return null;
  }

  return {
    id: `${slugify(chunk.id || source?.id || "core-review-source") || "core-review-source"}-q${String(index + 1).padStart(2, "0")}`,
    type: "single_best_answer",
    domain,
    difficulty: "core",
    cognitiveLevel: style,
    stem,
    options,
    answerKey,
    explanation: `Source-grounded review item based on ${source?.title || "an imported source"}.`,
    image: imageForSourceAsset(
      preferredAssetForChunk(chunk, source, assetsById),
      source,
      chunk,
    ),
    references: buildReference(source, chunk),
    sourceChunkIds: [chunk.id],
  };
}

export async function loadCoreReviewCorpus(corpusPath) {
  const resolvedPath = path.resolve(corpusPath);
  const raw = await fs.readFile(resolvedPath, "utf8");
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Core Review corpus must be a JSON object.");
  }
  if (!Array.isArray(parsed.chunks)) {
    throw new Error("Core Review corpus must include a chunks array.");
  }

  return {
    path: resolvedPath,
    title:
      collapseWhitespace(parsed.title || parsed.name || "") ||
      path
        .basename(resolvedPath, path.extname(resolvedPath))
        .replace(/[-_]+/g, " "),
    sourceCount: Array.isArray(parsed.sources) ? parsed.sources.length : 0,
    chunkCount: parsed.chunks.length,
    sources: Array.isArray(parsed.sources) ? parsed.sources : [],
    assets: Array.isArray(parsed.assets)
      ? parsed.assets.map((asset) => resolveCorpusAsset(asset, resolvedPath))
      : [],
    chunks: parsed.chunks,
  };
}

export function mergeCoreReviewCorpora(corpora) {
  const sources = uniqueBy(
    corpora.flatMap((corpus) => corpus.sources || []).filter(Boolean),
    (source) => source.id || source.filePath || source.title,
  );
  const assets = uniqueBy(
    corpora.flatMap((corpus) => corpus.assets || []).filter(Boolean),
    (asset) => asset.id || asset.localPath || asset.path,
  );
  const chunks = uniqueBy(
    corpora.flatMap((corpus) => corpus.chunks || []).filter(Boolean),
    (chunk) =>
      chunk.id ||
      `${chunk.sourceId}:${chunk.index ?? chunk.pageStart ?? chunk.textHash ?? ""}`,
  );

  return {
    title:
      collapseWhitespace(
        corpora
          .map((corpus) => corpus.title)
          .filter(Boolean)
          .join(" + "),
      ) || "Imported Core Review Sources",
    sourceCount: sources.length,
    assetCount: assets.length,
    chunkCount: chunks.length,
    sources,
    assets,
    chunks,
  };
}

export function buildCoreReviewQuestionBankFromCorpus(corpus, options = {}) {
  const sourcesById = new Map(
    (corpus.sources || []).map((source) => [source.id, source]),
  );
  const assetsById = new Map(
    (corpus.assets || [])
      .map((asset) => [asset.id, resolveCorpusAsset(asset, corpus.path)])
      .filter(([assetId]) => assetId),
  );
  const questions = [];
  const seenStems = new Set();
  const seenImageQuestionAssets = new Set();

  for (const chunk of corpus.chunks || []) {
    const source = sourcesById.get(chunk.sourceId) || {
      id: chunk.sourceId,
      title: corpus.title,
      domain: chunk.domain,
    };
    const domain = normalizeCoreReviewDomain(
      chunk?.domain || source?.domain || "",
    );
    if (!domain) {
      continue;
    }
    const imageQuestion = draftImageFindingQuestion(
      source,
      { ...chunk, domain },
      assetsById,
    );
    const imageQuestionKey =
      imageQuestion?.image?.sourceAssetId || imageQuestion?.stem || "";
    if (imageQuestion && imageQuestionKey && !seenImageQuestionAssets.has(imageQuestionKey)) {
      const normalizedImageQuestion = normalizeCoreReviewQuestion(
        imageQuestion,
        questions.length,
      );
      const validation = validateCoreReviewQuestion(normalizedImageQuestion);
      if (validation.ok) {
        seenImageQuestionAssets.add(imageQuestionKey);
        questions.push(normalizedImageQuestion);
      }
    }
    const candidateSentences = splitChunkIntoSentences(chunk.text).slice(0, 2);
    for (const [index, sentence] of candidateSentences.entries()) {
      const rawQuestion = draftQuestionFromSentence(
        source,
        { ...chunk, domain },
        sentence,
        index,
        assetsById,
      );
      if (!rawQuestion || seenStems.has(rawQuestion.stem.toLowerCase())) {
        continue;
      }
      const question = normalizeCoreReviewQuestion(
        rawQuestion,
        questions.length,
      );
      const validation = validateCoreReviewQuestion(question);
      if (!validation.ok) {
        continue;
      }
      seenStems.add(question.stem.toLowerCase());
      questions.push(question);
    }
  }

  const title =
    collapseWhitespace(options.title || "") ||
    collapseWhitespace(corpus.title || "") ||
    "Imported Core Review Practice Questions";

  return {
    title,
    questions,
    validation: questions.map((question) => ({
      id: question.id,
      ...validateCoreReviewQuestion(question),
    })),
  };
}
