import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildCoreReviewQuizSession,
  chunkCoreReviewText,
  coreReviewSchemaSummary,
  ingestCoreReviewSources,
  loadCoreReviewQuestionBank,
  normalizeCoreReviewDomain,
  scoreCoreReviewAnswer,
} from "../src/core_review/index.mjs";

test("normalizes Core Review schema aliases", () => {
  const summary = coreReviewSchemaSummary();
  assert.ok(summary.domains.length >= 10);
  assert.equal(normalizeCoreReviewDomain("MSK"), "msk");
  assert.equal(normalizeCoreReviewDomain("chest"), "thoracic");
});

test("chunks and ingests user-provided Core Review notes", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "core-review-ingest-"));
  const sourcePath = path.join(tempDir, "msk-notes.md");
  const outputPath = path.join(tempDir, "corpus.json");
  await fs.writeFile(
    sourcePath,
    "Rotator cuff tear\n\nMRI shows tendon discontinuity and fluid signal in the footprint.",
    "utf8",
  );

  const chunks = chunkCoreReviewText(await fs.readFile(sourcePath, "utf8"), { maxChars: 40 });
  assert.ok(chunks.length >= 1);

  const corpus = await ingestCoreReviewSources([sourcePath], {
    outputPath,
    domain: "musculoskeletal",
  });
  assert.equal(corpus.sourceCount, 1);
  assert.equal(corpus.sources[0].domain, "msk");
  assert.ok(corpus.chunkCount >= 1);
  assert.ok(await fs.stat(outputPath));
});

test("builds deterministic quiz sessions and scores answers", async () => {
  const bank = await loadCoreReviewQuestionBank(
    path.resolve("examples", "core-review-question-bank.example.json"),
  );
  const first = buildCoreReviewQuizSession(bank, {
    count: 2,
    domain: "thoracic",
    seed: "same-seed",
  });
  const second = buildCoreReviewQuizSession(bank, {
    count: 2,
    domain: "thoracic",
    seed: "same-seed",
  });

  assert.deepEqual(
    first.questions.map((question) => question.id),
    second.questions.map((question) => question.id),
  );
  assert.ok(first.questions.length >= 1);

  const question = first.questions.find((item) => item.type === "single_best_answer");
  assert.ok(question);
  assert.equal(scoreCoreReviewAnswer(question, question.answerKey).correct, true);
  assert.equal(scoreCoreReviewAnswer(question, "definitely-wrong").correct, false);
});
