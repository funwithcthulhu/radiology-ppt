import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { collapseWhitespace, slugify } from "../utils.mjs";
import { normalizeCoreReviewDomain } from "./schema.mjs";

const SUPPORTED_EXTENSIONS = new Set([".json", ".jsonl", ".md", ".markdown", ".txt"]);

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function inferTitle(filePath, parsed) {
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const title = collapseWhitespace(parsed.title || parsed.name || parsed.sourceTitle || "");
    if (title) {
      return title;
    }
  }
  return path.basename(filePath, path.extname(filePath)).replace(/[-_]+/g, " ");
}

function normalizeTags(value) {
  if (!value) {
    return [];
  }
  const tags = Array.isArray(value) ? value : String(value).split(/[,;]/);
  return tags.map((tag) => collapseWhitespace(tag).toLowerCase()).filter(Boolean);
}

function textFromJsonValue(value) {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(textFromJsonValue).filter(Boolean).join("\n\n");
  }
  if (value && typeof value === "object") {
    const preferred = [
      value.text,
      value.content,
      value.body,
      value.notes,
      value.summary,
      value.explanation,
    ].filter(Boolean);
    if (preferred.length) {
      return preferred.map(textFromJsonValue).filter(Boolean).join("\n\n");
    }
    return Object.values(value).map(textFromJsonValue).filter(Boolean).join("\n\n");
  }
  return "";
}

function parseJsonl(raw) {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function parseSource(raw, filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(extension)) {
    throw new Error(`Unsupported Core Review source type: ${extension || "(none)"}`);
  }

  if (extension === ".jsonl") {
    const parsed = parseJsonl(raw);
    return {
      parsed,
      text: parsed.map(textFromJsonValue).filter(Boolean).join("\n\n"),
    };
  }

  if (extension === ".json") {
    const parsed = JSON.parse(raw);
    return {
      parsed,
      text: textFromJsonValue(parsed),
    };
  }

  return {
    parsed: null,
    text: raw,
  };
}

export function chunkCoreReviewText(text, { maxChars = 1600, overlapChars = 180 } = {}) {
  const chunkSize = Math.max(1, Number.parseInt(maxChars, 10) || 1600);
  const overlapSize = Math.max(0, Math.min(Number.parseInt(overlapChars, 10) || 0, chunkSize - 1));
  const clean = String(text || "").replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!clean) {
    return [];
  }

  const paragraphs = clean
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  const chunks = [];
  let current = "";

  function pushCurrent() {
    const normalized = current.trim();
    if (normalized) {
      chunks.push(normalized);
    }
    current = "";
  }

  for (const paragraph of paragraphs) {
    if (!current) {
      current = paragraph;
      continue;
    }
    if (current.length + paragraph.length + 2 <= maxChars) {
      current = `${current}\n\n${paragraph}`;
      continue;
    }
    pushCurrent();
    current = paragraph;
  }
  pushCurrent();

  const splitChunks = [];
  for (const chunk of chunks) {
    if (chunk.length <= chunkSize) {
      splitChunks.push(chunk);
      continue;
    }
    let start = 0;
    while (start < chunk.length) {
      const end = Math.min(chunk.length, start + chunkSize);
      splitChunks.push(chunk.slice(start, end).trim());
      if (end === chunk.length) {
        break;
      }
      const nextStart = end - overlapSize;
      start = nextStart > start ? nextStart : end;
    }
  }

  return splitChunks.filter(Boolean);
}

export async function ingestCoreReviewSource(filePath, options = {}) {
  const resolvedPath = path.resolve(filePath);
  const raw = await fs.readFile(resolvedPath, "utf8");
  const { parsed, text } = parseSource(raw, resolvedPath);
  const title = inferTitle(resolvedPath, parsed);
  const domain = normalizeCoreReviewDomain(options.domain || parsed?.domain || parsed?.category || "");
  const tags = normalizeTags([...(normalizeTags(parsed?.tags)), ...(normalizeTags(options.tags))]);
  const sourceId = slugify(options.sourceId || parsed?.sourceId || title) || sha256(resolvedPath).slice(0, 12);
  const textHash = sha256(text);
  const importedAt = new Date().toISOString();

  const chunks = chunkCoreReviewText(text, options).map((chunkText, index) => ({
    id: `${sourceId}:chunk-${String(index + 1).padStart(4, "0")}`,
    sourceId,
    index,
    domain,
    tags,
    text: chunkText,
    textHash: sha256(chunkText),
  }));

  return {
    id: sourceId,
    title,
    filePath: resolvedPath,
    sourceType: path.extname(resolvedPath).toLowerCase().replace(/^\./, "") || "text",
    importedAt,
    domain,
    tags,
    textHash,
    chunkCount: chunks.length,
    chunks,
  };
}

export async function ingestCoreReviewSources(inputPaths, options = {}) {
  const sources = [];
  for (const inputPath of inputPaths) {
    sources.push(await ingestCoreReviewSource(inputPath, options));
  }

  const corpus = {
    version: 1,
    createdAt: new Date().toISOString(),
    sourceCount: sources.length,
    chunkCount: sources.reduce((total, source) => total + source.chunkCount, 0),
    sources: sources.map(({ chunks, ...source }) => source),
    chunks: sources.flatMap((source) => source.chunks),
  };

  if (options.outputPath) {
    const outputPath = path.resolve(options.outputPath);
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, `${JSON.stringify(corpus, null, 2)}\n`, "utf8");
  }

  return corpus;
}
