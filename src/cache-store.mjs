import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const RESOURCE_ROOT =
  process.env.RADIOLOGY_PPT_RESOURCE_ROOT || path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const APP_ROOT = process.env.RADIOLOGY_PPT_APP_ROOT || RESOURCE_ROOT;
const CACHE_SCHEMA_VERSION = 1;

function cacheRoot() {
  return path.join(APP_ROOT, "cache", "metadata");
}

function cachePath(namespace, key) {
  const hash = crypto.createHash("sha1").update(JSON.stringify({ namespace, key })).digest("hex");
  return path.join(cacheRoot(), namespace, `${hash}.json`);
}

function isFresh(entry, ttlMs) {
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
    return true;
  }
  const createdAt = Date.parse(entry?.createdAt || "");
  return Number.isFinite(createdAt) && Date.now() - createdAt <= ttlMs;
}

export async function readCacheEntry(namespace, key, { ttlMs = 0, allowStale = false } = {}) {
  const filePath = cachePath(namespace, key);
  try {
    const entry = JSON.parse(await fs.readFile(filePath, "utf8"));
    if (entry?.schemaVersion !== CACHE_SCHEMA_VERSION) {
      return null;
    }
    if (!allowStale && !isFresh(entry, ttlMs)) {
      return null;
    }
    return entry.value;
  } catch {
    return null;
  }
}

export async function writeCacheEntry(namespace, key, value) {
  const filePath = cachePath(namespace, key);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(
    filePath,
    `${JSON.stringify(
      {
        schemaVersion: CACHE_SCHEMA_VERSION,
        createdAt: new Date().toISOString(),
        key,
        value,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  return filePath;
}

export async function cachedValue(namespace, key, loadValue, { ttlMs = 0 } = {}) {
  const cached = await readCacheEntry(namespace, key, { ttlMs });
  if (cached !== null && cached !== undefined) {
    return cached;
  }

  try {
    const fresh = await loadValue();
    await writeCacheEntry(namespace, key, fresh);
    return fresh;
  } catch (error) {
    const stale = await readCacheEntry(namespace, key, { allowStale: true });
    if (stale !== null && stale !== undefined) {
      return stale;
    }
    throw error;
  }
}
