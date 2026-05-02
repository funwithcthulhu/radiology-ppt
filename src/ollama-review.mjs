import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { cleanText, collapseWhitespace, truncate } from "./utils.mjs";

const execFileAsync = promisify(execFile);
let OLLAMA_MODELS_PROMISE = null;

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
    /vision/i,
    /llava/i,
    /moondream/i,
    /minicpm/i,
    /qwen.*vl/i,
    /bakllava/i,
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
    const response = await fetch("http://127.0.0.1:11434/api/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: visionModel,
        stream: false,
        format: "json",
        prompt:
          `You are scoring a radiology teaching image from a case titled "${caseTitle}". ` +
          `Rate how useful the image is for showing the relevant pathology or anatomy for diagnosis "${diagnosisQuery}". ` +
          'Reply only as JSON with keys "score" (0-10 integer) and "reason" (max 12 words).',
        images: [imageBase64],
      }),
    });
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
    return images;
  }

  for (const image of images) {
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
