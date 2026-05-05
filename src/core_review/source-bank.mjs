import fs from "node:fs/promises";
import path from "node:path";
import { collapseWhitespace, slugify } from "../utils.mjs";
import { normalizeCoreReviewQuestion, validateCoreReviewQuestion } from "./quiz.mjs";
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
      sentences.push(normalized);
    }
  }
  return uniqueBy(sentences, (sentence) => sentence.toLowerCase());
}

function normalizeStemTopic(topic, fallbackTitle) {
  const clean = collapseWhitespace(String(topic || "").replace(/^[,;:\-]+|[,;:\-]+$/g, ""));
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
    /\b(should|must|recommended|recommend|requires?|avoid|document|verify|notify|contact|communicate|screen|delay|report)\b/i.test(
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
  const firstClause = clean.split(/;|, (?=(?:which|that|while|because|although)\b)/i)[0]?.trim() || clean;
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
  if (swapped && swapped.toLowerCase() !== String(correctText || "").toLowerCase()) {
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
  const label = collapseWhitespace([source?.title || "Imported source", page].filter(Boolean).join(" • "));
  return label ? [{ label }] : [];
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
    const match = splitAtKeyword(sentence, [" refers to ", " means ", " represents ", " is ", " are ", " defined as "]);
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
      " delay ",
      " report ",
    ]);
    if (match) {
      const action =
        match.keyword.trim() === "avoid"
          ? `Avoid ${match.after}`
          : `${match.keyword.trim().replace(/ed$/, "")} ${match.after}`.replace(/^recommend /i, "Recommend ");
      return shortenOptionText(action);
    }
  }

  return shortenOptionText(sentence || sourceTitle);
}

function topicFromSentence(sentence, style, sourceTitle) {
  if (style === "definition") {
    return splitAtKeyword(sentence, [" refers to ", " means ", " represents ", " is ", " are ", " defined as "])?.before || sourceTitle;
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
        " delay ",
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

function buildOptionSet(correctText, domain, style, seed) {
  const distractors = [
    oppositeOption(correctText, domain, style),
    ...distractorPool(domain, style),
  ]
    .map((option) => shortenOptionText(option))
    .filter(Boolean)
    .filter((option) => option.toLowerCase() !== correctText.toLowerCase());
  const pickedDistractors = uniqueBy(distractors, (option) => option.toLowerCase()).slice(0, 3);
  if (pickedDistractors.length < 3) {
    return { options: [], answerKey: "" };
  }

  const choices = shuffle(
    [{ text: correctText, correct: true }, ...pickedDistractors.map((text) => ({ text, correct: false }))],
    seed,
  ).slice(0, 4);
  const optionIds = ["A", "B", "C", "D"];
  const options = choices.map((choice, index) => ({
    id: optionIds[index],
    text: choice.text,
  }));
  const answerKey = options.find((_, index) => choices[index].correct)?.id || "";
  return { options, answerKey };
}

function draftQuestionFromSentence(source, chunk, sentence, index) {
  const domain = normalizeCoreReviewDomain(chunk?.domain || source?.domain || "");
  if (!domain) {
    return null;
  }

  const style = classifySentence(sentence, domain);
  const topic = topicFromSentence(sentence, style, source?.title || "Imported source");
  const correctText = buildCorrectOption(sentence, style, source?.title || "Imported source");
  if (!correctText || correctText.length < 18) {
    return null;
  }

  const stem = buildQuestionStem(style, domain, topic, source?.title || "Imported source");
  const { options, answerKey } = buildOptionSet(correctText, domain, style, `${chunk.id}:${index}`);
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
      path.basename(resolvedPath, path.extname(resolvedPath)).replace(/[-_]+/g, " "),
    sourceCount: Array.isArray(parsed.sources) ? parsed.sources.length : 0,
    chunkCount: parsed.chunks.length,
    sources: Array.isArray(parsed.sources) ? parsed.sources : [],
    assets: Array.isArray(parsed.assets) ? parsed.assets : [],
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
    (chunk) => chunk.id || `${chunk.sourceId}:${chunk.index ?? chunk.pageStart ?? chunk.textHash ?? ""}`,
  );

  return {
    title: collapseWhitespace(
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
  const sourcesById = new Map((corpus.sources || []).map((source) => [source.id, source]));
  const questions = [];
  const seenStems = new Set();

  for (const chunk of corpus.chunks || []) {
    const source = sourcesById.get(chunk.sourceId) || { id: chunk.sourceId, title: corpus.title, domain: chunk.domain };
    const domain = normalizeCoreReviewDomain(chunk?.domain || source?.domain || "");
    if (!domain) {
      continue;
    }
    const candidateSentences = splitChunkIntoSentences(chunk.text).slice(0, 2);
    for (const [index, sentence] of candidateSentences.entries()) {
      const rawQuestion = draftQuestionFromSentence(source, { ...chunk, domain }, sentence, index);
      if (!rawQuestion || seenStems.has(rawQuestion.stem.toLowerCase())) {
        continue;
      }
      const question = normalizeCoreReviewQuestion(rawQuestion, questions.length);
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
