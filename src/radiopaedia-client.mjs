import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { cachedValue } from "./cache-store.mjs";

export const BASE_URL = "https://radiopaedia.org";
export const IMAGE_BASE_URL = "https://prod-images-static.radiopaedia.org/images";
export const RESOURCE_ROOT =
  process.env.RADIOLOGY_PPT_RESOURCE_ROOT || path.resolve(fileURLToPath(new URL("..", import.meta.url)));
export const APP_ROOT = process.env.RADIOLOGY_PPT_APP_ROOT || RESOURCE_ROOT;

const execFileAsync = promisify(execFile);
const HTTP_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const REQUEST_HEADERS = {
  "accept": "text/html,application/xhtml+xml",
  "accept-language": "en-US,en;q=0.9",
  "user-agent": "Mozilla/5.0",
};
const TEXT_CACHE = new Map();
const HTTP_CONCURRENCY = boundedInteger(process.env.RADIOLOGY_PPT_HTTP_CONCURRENCY, 2, 1, 12);
const HTTP_CONNECT_TIMEOUT_SECONDS = boundedInteger(process.env.RADIOLOGY_PPT_HTTP_CONNECT_TIMEOUT_SECONDS, 10, 2, 60);
const HTTP_TEXT_TIMEOUT_SECONDS = boundedInteger(process.env.RADIOLOGY_PPT_HTTP_TEXT_TIMEOUT_SECONDS, 45, 5, 300);
const HTTP_IMAGE_TIMEOUT_SECONDS = boundedInteger(process.env.RADIOLOGY_PPT_HTTP_IMAGE_TIMEOUT_SECONDS, 75, 10, 600);
const HTTP_RETRY_ATTEMPTS = boundedInteger(process.env.RADIOLOGY_PPT_HTTP_RETRY_ATTEMPTS, 3, 1, 8);
let activeHttpRequests = 0;
const httpQueue = [];

function boundedInteger(rawValue, defaultValue, minimum, maximum) {
  const parsed = Number.parseInt(rawValue ?? "", 10);
  if (!Number.isInteger(parsed)) {
    return defaultValue;
  }

  return Math.max(minimum, Math.min(maximum, parsed));
}

async function withHttpSlot(action) {
  if (activeHttpRequests >= HTTP_CONCURRENCY) {
    await new Promise((resolve) => httpQueue.push(resolve));
  }

  activeHttpRequests += 1;
  try {
    return await action();
  } finally {
    activeHttpRequests -= 1;
    const next = httpQueue.shift();
    if (next) {
      next();
    }
  }
}

export function absoluteUrl(value) {
  if (!value) {
    return null;
  }
  return value.startsWith("http") ? value : `${BASE_URL}${value}`;
}

function buildCurlArgs(url, extraHeaders = {}, outputPath = null, { maxTimeSeconds = HTTP_TEXT_TIMEOUT_SECONDS } = {}) {
  const args = [
    "-sS",
    "-L",
    "--fail",
    "--connect-timeout",
    String(HTTP_CONNECT_TIMEOUT_SECONDS),
    "--max-time",
    String(maxTimeSeconds),
    "-A",
    REQUEST_HEADERS["user-agent"],
    "-H",
    `Accept: ${REQUEST_HEADERS.accept}`,
    "-H",
    `Accept-Language: ${REQUEST_HEADERS["accept-language"]}`,
  ];

  for (const [key, value] of Object.entries(extraHeaders)) {
    args.push("-H", `${key}: ${value}`);
  }

  if (outputPath) {
    args.push("-o", outputPath);
  }

  args.push(url);
  return args;
}

function looksLikeInterstitial(text) {
  const body = String(text ?? "");
  return /Just a moment/i.test(body) || /Attention Required/i.test(body) || /cf-browser-verification/i.test(body);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function curlWithRetries(args, options, attempt = 1) {
  try {
    return await withHttpSlot(() => execFileAsync("curl.exe", args, options));
  } catch (error) {
    const errorText = String(error.stderr || error.message || "");
    if (/\b403\b/.test(errorText)) {
      throw error;
    }
    if (attempt >= HTTP_RETRY_ATTEMPTS) {
      throw error;
    }
    const isRateLimited = /\b429\b/.test(errorText);
    await sleep((isRateLimited ? 1500 : 400) * attempt);
    return curlWithRetries(args, options, attempt + 1);
  }
}

export async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function fetchText(url, extraHeaders = {}, attempt = 1) {
  const cacheKey = JSON.stringify({ url, extraHeaders });
  if (TEXT_CACHE.has(cacheKey)) {
    return TEXT_CACHE.get(cacheKey);
  }

  const body = await cachedValue(
    "http-text",
    { url, extraHeaders },
    async () => {
      const { stdout } = await curlWithRetries(buildCurlArgs(url, extraHeaders), {
        maxBuffer: 50 * 1024 * 1024,
      });
      if (looksLikeInterstitial(stdout) && attempt < 3) {
        await sleep(350 * attempt);
        return fetchText(url, extraHeaders, attempt + 1);
      }
      if (looksLikeInterstitial(stdout)) {
        throw new Error(`Radiopaedia returned an interstitial page for ${url}; try again later.`);
      }
      return stdout;
    },
    { ttlMs: HTTP_CACHE_TTL_MS },
  );
  TEXT_CACHE.set(cacheKey, body);
  return body;
}

export async function fetchJson(url, extraHeaders = {}, attempt = 1) {
  const text = await fetchText(url, {
    "accept": "application/json,text/javascript,*/*;q=0.1",
    "x-requested-with": "XMLHttpRequest",
    ...extraHeaders,
  });
  try {
    return JSON.parse(text);
  } catch (error) {
    if (attempt < 3 && /^\s*</.test(text)) {
      await sleep(350 * attempt);
      return fetchJson(url, extraHeaders, attempt + 1);
    }
    throw error;
  }
}

export async function downloadFile(url, filePath) {
  if (await fileExists(filePath)) {
    const stat = await fs.stat(filePath).catch(() => null);
    if (stat?.size > 0) {
      return filePath;
    }
  }

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  try {
    await curlWithRetries(buildCurlArgs(url, {}, filePath, { maxTimeSeconds: HTTP_IMAGE_TIMEOUT_SECONDS }), {
      maxBuffer: 10 * 1024 * 1024,
    });
    const stat = await fs.stat(filePath);
    if (stat.size <= 0) {
      throw new Error(`Downloaded image was empty: ${url}`);
    }
  } catch (error) {
    await fs.rm(filePath, { force: true }).catch(() => {});
    throw error;
  }
  return filePath;
}
