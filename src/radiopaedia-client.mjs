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

export function absoluteUrl(value) {
  if (!value) {
    return null;
  }
  return value.startsWith("http") ? value : `${BASE_URL}${value}`;
}

function buildCurlArgs(url, extraHeaders = {}, outputPath = null) {
  const args = [
    "-sS",
    "-L",
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
      const { stdout } = await execFileAsync("curl.exe", buildCurlArgs(url, extraHeaders), {
        maxBuffer: 50 * 1024 * 1024,
      });
      if (looksLikeInterstitial(stdout) && attempt < 3) {
        await sleep(350 * attempt);
        return fetchText(url, extraHeaders, attempt + 1);
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
    return filePath;
  }

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await execFileAsync("curl.exe", buildCurlArgs(url, {}, filePath), {
    maxBuffer: 10 * 1024 * 1024,
  });
  return filePath;
}
