import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { cleanText, collapseWhitespace, truncate } from "./utils.mjs";
import { emitProgress, emitWarning } from "./backend-events.mjs";

const execFileAsync = promisify(execFile);
let OLLAMA_MODELS_PROMISE = null;
const OLLAMA_IMAGE_TIMEOUT_MS = boundedInteger(process.env.RADIOLOGY_PPT_OLLAMA_IMAGE_TIMEOUT_MS, 12_000, 3_000, 60_000);
const OLLAMA_CASE_TIMEOUT_MS = boundedInteger(process.env.RADIOLOGY_PPT_OLLAMA_CASE_TIMEOUT_MS, 20_000, 5_000, 120_000);
const OLLAMA_MAX_IMAGES_PER_CASE = boundedInteger(process.env.RADIOLOGY_PPT_OLLAMA_MAX_IMAGES_PER_CASE, 1, 0, 8);

function boundedInteger(rawValue, defaultValue, minimum, maximum) {
  const parsed = Number.parseInt(rawValue ?? "", 10);
  if (!Number.isInteger(parsed)) {
    return defaultValue;
  }

  return Math.max(minimum, Math.min(maximum, parsed));
}

async function listOllamaModels() {
  if (!OLLAMA_MODELS_PROMISE) {
    OLLAMA_MODELS_PROMISE = (async () => {
      try {
        const { stdout } = await execFileAsync("ollama", ["list"], {
          timeout: 8000,
        });
        return stdout
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => line.split(/\s+/)[0])
          .filter((name) => name && name.toLowerCase() !== "name");
      } catch {
        return [];
      }
    })();
  }

  return OLLAMA_MODELS_PROMISE;
}

async function discoverOllamaVisionModel() {
  const models = await listOllamaModels();
  const patterns = [
    /moondream/i,
    /minicpm/i,
    /qwen.*vl/i,
    /llava/i,
    /bakllava/i,
    /vision/i,
  ];

  for (const pattern of patterns) {
    const match = models.find((name) => pattern.test(name));
    if (match) {
      return match;
    }
  }

  return null;
}

async function scoreImageWithOllama(imagePath, { visionModel, caseTitle, diagnosisQuery }) {
  if (!visionModel) {
    return null;
  }

  try {
    const imageBase64 = (await fs.readFile(imagePath)).toString("base64");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), OLLAMA_IMAGE_TIMEOUT_MS);
    const response = await fetch("http://127.0.0.1:11434/api/generate", {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: visionModel,
        stream: false,
        format: "json",
        options: {
          num_predict: 48,
          temperature: 0,
        },
        prompt:
          `You are scoring a radiology teaching image from a case titled "${caseTitle}". ` +
          `Rate how useful the image is for showing the relevant pathology or anatomy for diagnosis "${diagnosisQuery}". ` +
          'Reply only as JSON with keys "score" (0-10 integer) and "reason" (max 12 words).',
        images: [imageBase64],
      }),
    }).finally(() => clearTimeout(timeout));
    if (!response.ok) {
      return null;
    }

    const payload = await response.json();
    const text = String(payload?.response ?? "").trim();
    if (!text) {
      return null;
    }

    const parsed = JSON.parse(text);
    const score = Number.parseInt(parsed?.score, 10);
    return {
      score: Number.isInteger(score) ? Math.max(0, Math.min(10, score)) : null,
      reason: truncate(cleanText(parsed?.reason || ""), 80),
    };
  } catch {
    return null;
  }
}

export async function maybeScoreSelectedImagesWithOllama(images, request, caseTitle) {
  if (!request.useOllamaAssist) {
    return images;
  }

  const visionModel = collapseWhitespace(request.ollamaModel || "") || (await discoverOllamaVisionModel());
  if (!visionModel) {
    emitWarning("No local Ollama vision model was found for image scoring");
    return images;
  }

  if (OLLAMA_MAX_IMAGES_PER_CASE < 1) {
    return images;
  }

  const startedAt = Date.now();
  const imagesToReview = images
    .slice()
    .sort((left, right) => right.relevantScore - left.relevantScore)
    .slice(0, Math.min(OLLAMA_MAX_IMAGES_PER_CASE, images.length));

  for (const image of imagesToReview) {
    if (Date.now() - startedAt > OLLAMA_CASE_TIMEOUT_MS) {
      emitWarning("Ollama image scoring reached the case time budget", { caseTitle });
      break;
    }
    emitProgress("Scoring image with Ollama", { caseTitle, frameId: image.frameId, model: visionModel });
    const review = await scoreImageWithOllama(image.localPath, {
      visionModel,
      caseTitle,
      diagnosisQuery: request.diagnosis || request.rawInput,
    });
    if (!review || !Number.isFinite(review.score)) {
      continue;
    }
    image.ollamaScore = review.score;
    image.ollamaReason = review.reason || "";
  }

  return images.sort(
    (left, right) =>
      (Number.isFinite(right.ollamaScore) ? right.ollamaScore : -1) -
      (Number.isFinite(left.ollamaScore) ? left.ollamaScore : -1) ||
      right.relevantScore - left.relevantScore,
  );
}

export async function scorePreparedItemsWithOllama(items, { ollamaModel = "" } = {}) {
  const scoredItems = [];
  for (const item of items) {
    const request = {
      ...(item.request || {}),
      useOllamaAssist: true,
      ollamaModel: collapseWhitespace(ollamaModel || item.request?.ollamaModel || ""),
    };
    const caseData = item.caseData || item.case || {};
    const images = Array.isArray(caseData.images) ? caseData.images : [];
    emitProgress("Starting optional Ollama case review", {
      caseTitle: caseData.caseTitle || request.rawInput || "Prepared case",
      imageCount: images.length,
    });
    caseData.images = await maybeScoreSelectedImagesWithOllama(
      images,
      request,
      caseData.caseTitle || request.rawInput || "Prepared case",
    );
    scoredItems.push({
      ...item,
      request,
      caseData,
    });
  }

  return scoredItems;
}
