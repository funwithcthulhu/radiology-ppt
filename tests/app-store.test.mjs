import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  readRandomHistory,
  readIndexedRandomCases,
  readAvoidedCasePaths,
  readRejectedFrameIds,
  readStoreCache,
  recordCaseDecision,
  recordCaseIndex,
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

test("indexes prepared cases for cached random reuse and filtering", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "radiology-store-case-index-"));
  process.env.RADIOLOGY_PPT_DATABASE_PATH = path.join(tempDir, "state.sqlite");

  await recordCaseIndex({
    caseData: {
      casePath: "/cases/ms-brain-1?lang=us",
      caseTitle: "Multiple sclerosis",
      caseUrl: "https://radiopaedia.org/cases/ms-brain-1?lang=us",
      displayUrl: "radiopaedia.org/cases/ms-brain-1",
      diagnosisQuery: "multiple sclerosis",
      studyHint: "mri brain",
      modalitySummary: "MRI",
      images: [{ frameId: "a" }, { frameId: "b" }, { frameId: "c" }],
      imageCandidateBank: [{ frameId: "a" }, { frameId: "b" }, { frameId: "c" }, { frameId: "d" }],
      quality: {
        selectedCount: 3,
        strongCount: 2,
        overallScore: 760,
        summary: "3 relevant images selected.",
      },
    },
    request: {
      randomSystems: ["neuroradiology"],
      studyHint: "mri brain",
    },
    source: "unit-test",
  });
  await recordCaseIndex({
    caseData: {
      casePath: "/cases/appendicitis-ct-1",
      caseTitle: "Appendicitis",
      diagnosisQuery: "appendicitis",
      modalitySummary: "CT",
      images: [{ frameId: "a" }],
      quality: {
        selectedCount: 1,
        overallScore: 100,
        summary: "1 relevant image selected.",
      },
    },
    request: {
      randomSystems: ["gastrointestinal"],
    },
    source: "unit-test",
  });

  const indexed = await readIndexedRandomCases({
    modality: "mri",
    system: "neuro",
    minSelectedImages: 2,
    limit: 5,
  });

  assert.equal(indexed.length, 1);
  assert.equal(indexed[0].casePath, "/cases/ms-brain-1");
  assert.equal(indexed[0].caseTitle, "Multiple sclerosis");
  assert.deepEqual(indexed[0].systems, ["neuroradiology"]);

  const excluded = await readIndexedRandomCases({
    excludeCasePaths: ["/cases/ms-brain-1"],
    limit: 5,
  });
  assert.equal(excluded.length, 1);
  assert.equal(excluded[0].casePath, "/cases/appendicitis-ct-1");
  assert.equal(excluded[0].selectedImageCount, 1);
});
