import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { collapseWhitespace } from "./utils.mjs";

const RESOURCE_ROOT =
  process.env.RADIOLOGY_PPT_RESOURCE_ROOT || path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const CACHE_SCHEMA_VERSION = 1;
let sqlitePromise = null;
let schemaReady = new Set();

function appRoot() {
  return process.env.RADIOLOGY_PPT_APP_ROOT || RESOURCE_ROOT;
}

function databasePath() {
  return process.env.RADIOLOGY_PPT_DATABASE_PATH || path.join(appRoot(), "state", "radiology-ppt.sqlite");
}

async function sqlite() {
  if (!sqlitePromise) {
    process.env.NODE_NO_WARNINGS = process.env.NODE_NO_WARNINGS || "1";
    sqlitePromise = import("node:sqlite");
  }
  return sqlitePromise;
}

function cacheKeyHash(namespace, key) {
  return crypto.createHash("sha1").update(JSON.stringify({ namespace, key })).digest("hex");
}

function timestamp() {
  return new Date().toISOString();
}

function isFresh(createdAt, ttlMs) {
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
    return true;
  }
  const parsed = Date.parse(createdAt || "");
  return Number.isFinite(parsed) && Date.now() - parsed <= ttlMs;
}

function tableColumns(db, tableName) {
  return db.prepare(`PRAGMA table_info(${tableName})`).all().map((row) => row.name);
}

function ensureColumn(db, tableName, columnName, ddl) {
  if (!tableColumns(db, tableName).includes(columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${ddl};`);
  }
}

async function withDb(callback) {
  const { DatabaseSync } = await sqlite();
  const dbPath = databasePath();
  await fs.mkdir(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  try {
    db.exec("PRAGMA journal_mode=WAL;");
    db.exec("PRAGMA foreign_keys=ON;");
    if (!schemaReady.has(dbPath)) {
      ensureSchema(db);
      schemaReady.add(dbPath);
    }
    return callback(db);
  } finally {
    db.close();
  }
}

function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS backend_cache (
      namespace TEXT NOT NULL,
      key_hash TEXT NOT NULL,
      key_json TEXT NOT NULL,
      value_json TEXT NOT NULL,
      schema_version INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      last_accessed_at TEXT NOT NULL,
      hit_count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(namespace, key_hash)
    );

    CREATE TABLE IF NOT EXISTS random_history (
      case_path TEXT PRIMARY KEY,
      last_seen_at TEXT NOT NULL,
      source TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS case_decisions (
      case_path TEXT PRIMARY KEY,
      case_title TEXT NOT NULL DEFAULT '',
      decision TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      last_seen_at TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS image_decisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      case_path TEXT NOT NULL,
      frame_id TEXT NOT NULL DEFAULT '',
      url TEXT NOT NULL DEFAULT '',
      label TEXT NOT NULL DEFAULT '',
      decision TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 1,
      UNIQUE(case_path, frame_id, url, decision)
    );

    CREATE INDEX IF NOT EXISTS idx_random_history_seen ON random_history(last_seen_at DESC);
    CREATE INDEX IF NOT EXISTS idx_image_decisions_case_decision ON image_decisions(case_path, decision);
    CREATE INDEX IF NOT EXISTS idx_case_decisions_decision ON case_decisions(decision, last_seen_at DESC);
  `);

  ensureColumn(db, "random_history", "use_count", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn(db, "case_decisions", "count", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn(db, "image_decisions", "count", "INTEGER NOT NULL DEFAULT 1");
}

export async function readStoreCache(namespace, key, { ttlMs = 0, allowStale = false } = {}) {
  return withDb((db) => {
    const keyHash = cacheKeyHash(namespace, key);
    const row = db
      .prepare("SELECT value_json, schema_version, created_at FROM backend_cache WHERE namespace = ? AND key_hash = ?")
      .get(namespace, keyHash);
    if (!row || row.schema_version !== CACHE_SCHEMA_VERSION) {
      return null;
    }
    if (!allowStale && !isFresh(row.created_at, ttlMs)) {
      return null;
    }

    db.prepare(
      "UPDATE backend_cache SET last_accessed_at = ?, hit_count = hit_count + 1 WHERE namespace = ? AND key_hash = ?",
    ).run(timestamp(), namespace, keyHash);
    return JSON.parse(row.value_json);
  }).catch(() => null);
}

export async function writeStoreCache(namespace, key, value) {
  return withDb((db) => {
    const now = timestamp();
    const keyHash = cacheKeyHash(namespace, key);
    db.prepare(`
      INSERT INTO backend_cache
        (namespace, key_hash, key_json, value_json, schema_version, created_at, last_accessed_at, hit_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0)
      ON CONFLICT(namespace, key_hash) DO UPDATE SET
        key_json = excluded.key_json,
        value_json = excluded.value_json,
        schema_version = excluded.schema_version,
        created_at = excluded.created_at,
        last_accessed_at = excluded.last_accessed_at;
    `).run(namespace, keyHash, JSON.stringify(key), JSON.stringify(value), CACHE_SCHEMA_VERSION, now, now);
    return keyHash;
  });
}

export async function readRandomHistory({ limit = 240 } = {}) {
  return withDb((db) =>
    db
      .prepare("SELECT case_path FROM random_history ORDER BY last_seen_at DESC, rowid DESC LIMIT ?")
      .all(limit)
      .map((row) => row.case_path),
  ).catch(() => []);
}

export async function writeRandomHistory(casePaths, { source = "prepare", limit = 240 } = {}) {
  const cleanPaths = [];
  const seen = new Set();
  for (const casePath of casePaths || []) {
    const clean = collapseWhitespace(casePath);
    if (clean && !seen.has(clean)) {
      seen.add(clean);
      cleanPaths.push(clean);
    }
  }

  if (!cleanPaths.length) {
    return;
  }

  await withDb((db) => {
    const now = timestamp();
    const statement = db.prepare(`
      INSERT INTO random_history (case_path, last_seen_at, source, use_count)
      VALUES (?, ?, ?, 1)
      ON CONFLICT(case_path) DO UPDATE SET
        last_seen_at = excluded.last_seen_at,
        source = excluded.source,
        use_count = random_history.use_count + 1;
    `);
    for (const casePath of cleanPaths) {
      statement.run(casePath, now, source);
    }
    db.prepare(`
      DELETE FROM random_history
      WHERE case_path NOT IN (
        SELECT case_path FROM random_history ORDER BY last_seen_at DESC LIMIT ?
      );
    `).run(limit);
  }).catch(async () => {
    const historyPath = path.join(appRoot(), "cache", "random-selection-history.json");
    await fs.mkdir(path.dirname(historyPath), { recursive: true });
    await fs.writeFile(
      historyPath,
      `${JSON.stringify({ updatedAt: timestamp(), casePaths: cleanPaths.slice(0, limit) }, null, 2)}\n`,
      "utf8",
    );
  });
}

export async function recordCaseDecision({ casePath, caseTitle = "", decision, reason = "" }) {
  const cleanCasePath = collapseWhitespace(casePath);
  const cleanDecision = collapseWhitespace(decision).toLowerCase();
  if (!cleanCasePath || !cleanDecision) {
    return;
  }

  await withDb((db) => {
    db.prepare(`
      INSERT INTO case_decisions (case_path, case_title, decision, reason, last_seen_at, count)
      VALUES (?, ?, ?, ?, ?, 1)
      ON CONFLICT(case_path) DO UPDATE SET
        case_title = COALESCE(NULLIF(excluded.case_title, ''), case_decisions.case_title),
        decision = excluded.decision,
        reason = excluded.reason,
        last_seen_at = excluded.last_seen_at,
        count = case_decisions.count + 1;
    `).run(cleanCasePath, collapseWhitespace(caseTitle), cleanDecision, collapseWhitespace(reason), timestamp());
  }).catch(() => {});
}

export async function recordImageDecision({ casePath, frameId = "", url = "", label = "", decision, reason = "" }) {
  const cleanCasePath = collapseWhitespace(casePath);
  const cleanDecision = collapseWhitespace(decision).toLowerCase();
  if (!cleanCasePath || !cleanDecision) {
    return;
  }

  await withDb((db) => {
    const now = timestamp();
    db.prepare(`
      INSERT INTO image_decisions
        (case_path, frame_id, url, label, decision, reason, created_at, last_seen_at, count)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
      ON CONFLICT(case_path, frame_id, url, decision) DO UPDATE SET
        label = COALESCE(NULLIF(excluded.label, ''), image_decisions.label),
        reason = excluded.reason,
        last_seen_at = excluded.last_seen_at,
        count = image_decisions.count + 1;
    `).run(
      cleanCasePath,
      collapseWhitespace(frameId),
      collapseWhitespace(url),
      collapseWhitespace(label),
      cleanDecision,
      collapseWhitespace(reason),
      now,
      now,
    );
  }).catch(() => {});
}

export async function readRejectedFrameIds(casePath) {
  const cleanCasePath = collapseWhitespace(casePath);
  if (!cleanCasePath) {
    return [];
  }

  return withDb((db) =>
    db
      .prepare(`
        SELECT frame_id
        FROM image_decisions
        WHERE case_path = ?
          AND decision IN ('rejected', 'removed')
          AND frame_id <> ''
        ORDER BY last_seen_at DESC;
      `)
      .all(cleanCasePath)
      .map((row) => row.frame_id),
  ).catch(() => []);
}

export function getStoreDatabasePath() {
  return databasePath();
}
