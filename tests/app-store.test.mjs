import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  readRandomHistory,
  readAvoidedCasePaths,
  readRejectedFrameIds,
  readStoreCache,
  recordCaseDecision,
  recordImageDecision,
  writeRandomHistory,
  writeStoreCache,
} from "../src/app-store.mjs";

test("stores backend cache values and random history in SQLite", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "radiology-store-"));
  process.env.RADIOLOGY_PPT_DATABASE_PATH = path.join(tempDir, "state.sqlite");

  await writeStoreCache("test", { id: 1 }, { value: "cached" });
  assert.deepEqual(await readStoreCache("test", { id: 1 }, { ttlMs: 60_000 }), { value: "cached" });

  await writeRandomHistory(["/cases/a", "/cases/b", "/cases/a"], { source: "unit-test", limit: 10 });
  assert.deepEqual(await readRandomHistory({ limit: 2 }), ["/cases/b", "/cases/a"]);
});

test("records rejected image frames for later repicks", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "radiology-store-decisions-"));
  process.env.RADIOLOGY_PPT_DATABASE_PATH = path.join(tempDir, "state.sqlite");

  await recordImageDecision({
    casePath: "/cases/example-1",
    frameId: "frame-2",
    url: "https://example.test/frame-2.jpg",
    decision: "rejected",
    reason: "unit-test",
  });

  assert.deepEqual(await readRejectedFrameIds("/cases/example-1"), ["frame-2"]);
});

test("reads skipped and rejected case paths for future random avoidance", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "radiology-store-case-decisions-"));
  process.env.RADIOLOGY_PPT_DATABASE_PATH = path.join(tempDir, "state.sqlite");

  await recordCaseDecision({
    casePath: "/cases/skip-me",
    caseTitle: "Skipped case",
    decision: "skipped",
    reason: "unit-test",
  });
  await recordCaseDecision({
    casePath: "/cases/keep-me",
    caseTitle: "Approved case",
    decision: "approved",
    reason: "unit-test",
  });

  assert.deepEqual(await readAvoidedCasePaths(), ["/cases/skip-me"]);
});
