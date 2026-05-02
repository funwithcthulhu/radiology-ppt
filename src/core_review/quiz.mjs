import fs from "node:fs/promises";
import path from "node:path";
import { collapseWhitespace, slugify } from "../utils.mjs";
import {
  normalizeCoreReviewDomain,
  normalizeCoreReviewQuestionType,
} from "./schema.mjs";

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

function normalizeOptions(options) {
  if (!Array.isArray(options)) {
    return [];
  }
  return options
    .map((option, index) => {
      if (typeof option === "string") {
        return { id: String.fromCharCode(65 + index), text: collapseWhitespace(option) };
      }
      return {
        id: collapseWhitespace(option?.id || option?.key || String.fromCharCode(65 + index)),
        text: collapseWhitespace(option?.text || option?.label || option?.value || ""),
      };
    })
    .filter((option) => option.id && option.text);
}

function parsePointResponse(response) {
  if (Array.isArray(response) && response.length >= 2) {
    return {
      x: Number(response[0]),
      y: Number(response[1]),
    };
  }
  if (typeof response === "string") {
    const [x, y] = response.split(/[, ]+/).map(Number);
    return { x, y };
  }
  if (response && typeof response === "object") {
    return {
      x: Number(response.x ?? response.left),
      y: Number(response.y ?? response.top),
    };
  }
  return { x: NaN, y: NaN };
}

function pointInHotspot(point, hotspot) {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || !hotspot) {
    return false;
  }

  if (Number.isFinite(Number(hotspot.radius))) {
    const centerX = Number(hotspot.x);
    const centerY = Number(hotspot.y);
    const radius = Number(hotspot.radius);
    const dx = point.x - centerX;
    const dy = point.y - centerY;
    return Math.sqrt(dx * dx + dy * dy) <= radius;
  }

  const left = Number(hotspot.x ?? hotspot.left);
  const top = Number(hotspot.y ?? hotspot.top);
  const width = Number(hotspot.width);
  const height = Number(hotspot.height);
  if (![left, top, width, height].every(Number.isFinite)) {
    return false;
  }
  return point.x >= left && point.x <= left + width && point.y >= top && point.y <= top + height;
}

export function normalizeCoreReviewQuestion(rawQuestion, index = 0) {
  const type = normalizeCoreReviewQuestionType(rawQuestion?.type || rawQuestion?.questionType || "single_best_answer");
  const domain = normalizeCoreReviewDomain(rawQuestion?.domain || rawQuestion?.category || "");
  const options = normalizeOptions(rawQuestion?.options || rawQuestion?.choices);
  const id =
    collapseWhitespace(rawQuestion?.id || rawQuestion?.questionId || "") ||
    `${slugify(domain || "core-review")}-${String(index + 1).padStart(4, "0")}`;

  return {
    id,
    type: type || "single_best_answer",
    domain,
    modality: collapseWhitespace(rawQuestion?.modality || ""),
    difficulty: collapseWhitespace(rawQuestion?.difficulty || "core"),
    cognitiveLevel: collapseWhitespace(rawQuestion?.cognitiveLevel || rawQuestion?.task || ""),
    stem: collapseWhitespace(rawQuestion?.stem || rawQuestion?.prompt || rawQuestion?.question || ""),
    options,
    answerKey: collapseWhitespace(rawQuestion?.answerKey || rawQuestion?.key || rawQuestion?.answer || ""),
    answerKeys: Array.isArray(rawQuestion?.answerKeys)
      ? rawQuestion.answerKeys.map(collapseWhitespace).filter(Boolean)
      : [],
    numericAnswer: rawQuestion?.numericAnswer || rawQuestion?.numeric || null,
    hotspot: rawQuestion?.hotspot || rawQuestion?.target || null,
    image: rawQuestion?.image || rawQuestion?.images?.[0] || null,
    explanation: collapseWhitespace(rawQuestion?.explanation || rawQuestion?.rationale || ""),
    references: Array.isArray(rawQuestion?.references) ? rawQuestion.references : [],
    sourceChunkIds: Array.isArray(rawQuestion?.sourceChunkIds) ? rawQuestion.sourceChunkIds : [],
  };
}

export function validateCoreReviewQuestion(question) {
  const errors = [];
  if (!question.id) {
    errors.push("Missing question id.");
  }
  if (!question.stem) {
    errors.push("Missing stem.");
  }
  if (!question.type) {
    errors.push("Missing question type.");
  }
  if (!question.domain) {
    errors.push("Missing or unrecognized Core Review domain.");
  }

  if (question.type === "single_best_answer") {
    if (question.options.length < 2) {
      errors.push("Single-best-answer questions need at least two options.");
    }
    if (!question.answerKey) {
      errors.push("Single-best-answer questions need answerKey.");
    }
    if (question.answerKey && !question.options.some((option) => option.id === question.answerKey)) {
      errors.push(`answerKey '${question.answerKey}' does not match an option id.`);
    }
  }

  if (question.type === "multi_correct") {
    if (question.options.length < 4) {
      errors.push("Multi-correct questions need at least four options.");
    }
    if (question.answerKeys.length < 2) {
      errors.push("Multi-correct questions need at least two answerKeys.");
    }
  }

  if (question.type === "numeric_fill_blank" && !question.numericAnswer) {
    errors.push("Numeric fill-in-the-blank questions need numericAnswer.");
  }

  if (question.type === "image_hotspot" || question.type === "gold_marker_abnormality") {
    if (!question.image) {
      errors.push("Image localization questions need image metadata.");
    }
    if (!question.hotspot) {
      errors.push("Image localization questions need hotspot target metadata.");
    }
  }

  if (!question.references.length && !question.sourceChunkIds.length) {
    errors.push("Question should include at least one reference or sourceChunkIds entry.");
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}

export function scoreCoreReviewAnswer(question, response) {
  if (question.type === "single_best_answer") {
    const selected = collapseWhitespace(response?.answerKey ?? response?.answer ?? response);
    return {
      correct: selected === question.answerKey,
      expected: question.answerKey,
      received: selected,
    };
  }

  if (question.type === "multi_correct") {
    const selected = Array.isArray(response) ? response : response?.answerKeys || response?.answers || [];
    const normalized = selected.map(collapseWhitespace).filter(Boolean).sort();
    const expected = [...question.answerKeys].sort();
    return {
      correct: JSON.stringify(normalized) === JSON.stringify(expected),
      expected,
      received: normalized,
    };
  }

  if (question.type === "numeric_fill_blank") {
    const value = Number(response?.value ?? response?.answer ?? response);
    const expected = Number(question.numericAnswer?.value);
    const tolerance = Number(question.numericAnswer?.tolerance ?? 0);
    return {
      correct: Number.isFinite(value) && Number.isFinite(expected) && Math.abs(value - expected) <= tolerance,
      expected,
      received: value,
      tolerance,
    };
  }

  if (question.type === "image_hotspot" || question.type === "gold_marker_abnormality") {
    const point = parsePointResponse(response?.point ?? response?.marker ?? response);
    return {
      correct: pointInHotspot(point, question.hotspot),
      expected: question.hotspot,
      received: point,
    };
  }

  return {
    correct: false,
    expected: null,
    received: response,
  };
}

export async function loadCoreReviewQuestionBank(questionBankPath) {
  const resolvedPath = path.resolve(questionBankPath);
  const raw = await fs.readFile(resolvedPath, "utf8");
  const parsed = JSON.parse(raw);
  const rawQuestions = Array.isArray(parsed) ? parsed : parsed.questions;
  if (!Array.isArray(rawQuestions)) {
    throw new Error("Core Review question bank must be a JSON array or an object with a questions array.");
  }

  const questions = rawQuestions.map(normalizeCoreReviewQuestion);
  const validation = questions.map((question) => ({
    id: question.id,
    ...validateCoreReviewQuestion(question),
  }));

  return {
    path: resolvedPath,
    title: collapseWhitespace(parsed.title || parsed.name || "Core Review Question Bank"),
    questions,
    validation,
  };
}

export function buildCoreReviewQuizSession(questionBank, options = {}) {
  const domain = normalizeCoreReviewDomain(options.domain || "");
  const questionType = normalizeCoreReviewQuestionType(options.questionType || "");
  const count = Math.max(1, Number.parseInt(options.count ?? 10, 10) || 10);
  const seed = collapseWhitespace(options.seed || new Date().toISOString().slice(0, 10));

  const eligible = questionBank.questions.filter((question) => {
    if (domain && question.domain !== domain) {
      return false;
    }
    if (questionType && question.type !== questionType) {
      return false;
    }
    return validateCoreReviewQuestion(question).ok;
  });

  const questions = shuffle(eligible, seed).slice(0, count);
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    title: questionBank.title,
    seed,
    filters: {
      domain: domain || null,
      questionType: questionType || null,
      count,
    },
    availableQuestionCount: eligible.length,
    questions,
  };
}

export function renderCoreReviewQuestionText(question, index = 0) {
  const lines = [
    `${index + 1}. [${question.domain || "unmapped"} / ${question.type}] ${question.stem}`,
  ];

  if (question.image) {
    const imageLabel = typeof question.image === "string" ? question.image : question.image.path || question.image.url || "image";
    lines.push(`   Image: ${imageLabel}`);
  }

  if (question.type === "gold_marker_abnormality") {
    lines.push("   Task: place the gold marker on the abnormality.");
  }

  if (question.options.length) {
    for (const option of question.options) {
      lines.push(`   ${option.id}. ${option.text}`);
    }
  }

  return lines.join("\n");
}

export function renderCoreReviewQuizText(session) {
  const header = [
    session.title,
    `Seed: ${session.seed}`,
    `Questions: ${session.questions.length}/${session.availableQuestionCount}`,
    "",
  ];
  return `${header.join("\n")}${session.questions.map(renderCoreReviewQuestionText).join("\n\n")}\n`;
}
