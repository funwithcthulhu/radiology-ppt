import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildCoreReviewCasePlan,
  buildCoreReviewQuestionBankFromCorpus,
  buildCoreReviewQuizSession,
  chunkCoreReviewText,
  coreReviewSchemaSummary,
  ingestCoreReviewSources,
  loadCoreReviewCaseBank,
  loadCoreReviewCorpus,
  loadCoreReviewQuestionBank,
  mergeCoreReviewCorpora,
  normalizeCoreReviewDomain,
  scoreCoreReviewAnswer,
} from "../src/core_review/index.mjs";
import { ingestCoreReviewPdfs } from "../src/core_review/pdf-ingest.mjs";

function tinyPdfBuffer(text) {
  const escaped = String(text).replace(/[()\\]/g, "\\$&");
  const stream = `BT /F1 24 Tf 72 720 Td (${escaped}) Tj ET`;
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n",
    "4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
    `5 0 obj\n<< /Length ${Buffer.byteLength(stream, "ascii")} >>\nstream\n${stream}\nendstream\nendobj\n`,
  ];

  let body = "%PDF-1.4\n";
  const offsets = [];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(body, "ascii"));
    body += object;
  }
  const xrefStart = Buffer.byteLength(body, "ascii");
  body += `xref\n0 ${objects.length + 1}\n`;
  body += "0000000000 65535 f \n";
  for (const offset of offsets) {
    body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return Buffer.from(body, "ascii");
}

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

test("ingests Core Review PDFs through the Node backend", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "core-review-pdf-ingest-"));
  const pdfPath = path.join(tempDir, "msk.pdf");
  const outputPath = path.join(tempDir, "pdf-corpus.json");
  await fs.writeFile(pdfPath, tinyPdfBuffer("Rotator cuff tear"));

  const corpus = await ingestCoreReviewPdfs([pdfPath], {
    outputPath,
    domain: "msk",
    noRenderPages: true,
    noExtractImages: true,
    noCopySource: true,
  });

  assert.equal(corpus.sourceCount, 1);
  assert.equal(corpus.sources[0].sourceType, "pdf");
  assert.equal(corpus.sources[0].domain, "msk");
  assert.ok(corpus.chunks.some((chunk) => /Rotator cuff tear/.test(chunk.text)));
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

test("loads the bundled Core Review bank for NIS and physics practice", async () => {
  const bank = await loadCoreReviewQuestionBank(
    path.resolve("src", "core_review", "default-question-bank.json"),
  );

  assert.ok(bank.questions.length >= 10);
  assert.equal(bank.validation.every((entry) => entry.ok), true);
  assert.ok(bank.questions.some((question) => question.domain === "nis"));
  assert.ok(bank.questions.some((question) => question.domain === "physics"));

  const physicsSession = buildCoreReviewQuizSession(bank, {
    count: 2,
    domain: "physics",
    seed: "bundled-default",
  });

  assert.equal(physicsSession.questions.length, 2);
  assert.equal(physicsSession.questions.every((question) => question.domain === "physics"), true);
});

test("builds deterministic CORE review case plans without using the Cases tab", async () => {
  const bank = await loadCoreReviewCaseBank();
  assert.ok(bank.cases.length >= 100);

  const first = await buildCoreReviewCasePlan({
    caseCount: 50,
    caseMix: "blueprint",
    modalityMix: "mixed",
    imagesPerCase: 2,
    seed: "core-plan-test",
  });
  const second = await buildCoreReviewCasePlan({
    caseCount: 50,
    caseMix: "blueprint",
    modalityMix: "mixed",
    imagesPerCase: 2,
    seed: "core-plan-test",
  });

  assert.equal(first.entries.length, 50);
  assert.deepEqual(
    first.entries.map((entry) => entry.rawInput),
    second.entries.map((entry) => entry.rawInput),
  );
  assert.equal(first.entries.every((entry) => entry.requestMode === "specific"), true);
  assert.equal(first.entries.every((entry) => entry.coreReviewPlan?.domain), true);
  assert.equal(first.entries.every((entry) => entry.allowAlternateModality === true), true);
  assert.ok(new Set(first.entries.map((entry) => entry.coreReviewPlan.domain)).size >= 8);
  assert.ok(first.entries.some((entry) => entry.modality && entry.studyHint.includes(entry.modality)));
});

test("can over-plan Core Review candidates while preserving the requested count", async () => {
  const plan = await buildCoreReviewCasePlan({
    caseCount: 50,
    candidateCaseCount: 120,
    caseMix: "blueprint",
    modalityMix: "mixed",
    seed: "core-plan-candidate-buffer",
  });

  assert.equal(plan.requestedCaseCount, 50);
  assert.equal(plan.plannedCaseCount, 120);
  assert.equal(plan.entries.length, 120);
  assert.match(plan.summary, /50 requested case\(s\), 120 candidate request\(s\)/);
});

test("Core Review case plans carry total item and standalone question metadata", async () => {
  const plan = await buildCoreReviewCasePlan({
    caseCount: 46,
    candidateCaseCount: 50,
    totalReviewItemCount: 50,
    standaloneQuestionCounts: { nis: 2, physics: 2 },
    caseMix: "blueprint",
    modalityMix: "mixed",
    seed: "core-plan-total-metadata",
  });

  assert.equal(plan.totalReviewItemCount, 50);
  assert.deepEqual(plan.standaloneQuestionCounts, { nis: 2, physics: 2 });
  assert.equal(plan.entries[0].coreReviewPlan.totalReviewItemCount, 50);
  assert.deepEqual(plan.entries[0].coreReviewPlan.standaloneQuestionCounts, { nis: 2, physics: 2 });
  assert.match(plan.summary, /50 total review item\(s\), 4 NIS\/physics question\(s\) included/);
});

test("defaults CORE review cases to one requested image", async () => {
  const plan = await buildCoreReviewCasePlan({
    caseCount: 4,
    candidateCaseCount: 4,
    caseMix: "blueprint",
    modalityMix: "mixed",
    seed: "core-plan-one-image-default",
  });

  assert.equal(plan.entries.every((entry) => entry.requestedImagesPerCase === 1), true);
});

test("can focus CORE review case plans by domain", async () => {
  const plan = await buildCoreReviewCasePlan({
    caseCount: 12,
    domain: "msk",
    caseMix: "focused",
    modalityMix: "classic",
    seed: "msk-focus",
  });

  assert.equal(plan.entries.length, 12);
  assert.equal(plan.entries.every((entry) => entry.coreReviewPlan.domain === "msk"), true);
  assert.equal(plan.entries.every((entry) => entry.modality), true);
});

test("builds source-grounded review questions from imported corpora", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "core-review-bank-from-corpus-"));
  const nisSourcePath = path.join(tempDir, "nis-communication-notes.md");
  const physicsSourcePath = path.join(tempDir, "physics-distance-notes.md");
  const nisCorpusPath = path.join(tempDir, "nis-corpus.json");
  const physicsCorpusPath = path.join(tempDir, "physics-corpus.json");

  await fs.writeFile(
    nisSourcePath,
    "Critical results should be directly communicated to the responsible clinician and documented in the workflow record.",
    "utf8",
  );
  await fs.writeFile(
    physicsSourcePath,
    "Increasing pitch in helical CT generally reduces dose when the other major exposure settings are unchanged.",
    "utf8",
  );

  await ingestCoreReviewSources([nisSourcePath], {
    outputPath: nisCorpusPath,
    domain: "nis",
  });
  await ingestCoreReviewSources([physicsSourcePath], {
    outputPath: physicsCorpusPath,
    domain: "physics",
  });

  const mergedCorpus = mergeCoreReviewCorpora([
    await loadCoreReviewCorpus(nisCorpusPath),
    await loadCoreReviewCorpus(physicsCorpusPath),
  ]);
  const bank = buildCoreReviewQuestionBankFromCorpus(mergedCorpus, {
    title: "Imported Review Questions",
  });

  assert.ok(bank.questions.length >= 2);
  assert.equal(bank.validation.every((entry) => entry.ok), true);
  assert.ok(bank.questions.some((question) => question.domain === "nis"));
  assert.ok(bank.questions.some((question) => question.domain === "physics"));
  assert.ok(
    bank.questions.some((question) =>
      question.references.some((reference) => /communication notes|distance notes/i.test(reference.label)),
    ),
  );
});
