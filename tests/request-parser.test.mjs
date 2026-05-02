import test from "node:test";
import assert from "node:assert/strict";
import { parseCaseRequest } from "../src/request-parser.mjs";

test("parses a specific diagnosis with a modality/anatomy hint", () => {
  const request = parseCaseRequest("multiple sclerosis, mri brain");
  assert.equal(request.diagnosis, "multiple sclerosis");
  assert.equal(request.studyHint, "mri brain");
  assert.deepEqual(request.preferredModalities, ["MRI"]);
});

test("parses random subspecialty/category directives", () => {
  const request = parseCaseRequest("random pediatric neuro diagnosis 2");
  assert.equal(request.randomSpec.count, 2);
  assert.ok(request.randomSpec.systems.includes("Central Nervous System"));
  assert.ok(request.randomSpec.systems.includes("Paediatrics"));
});

test("normalizes manual case paths without losing the source title", () => {
  const request = parseCaseRequest({
    requestMode: "manual",
    selectedCasePath: "/cases/hypothalamic-hamartoma-15",
    selectedCaseTitle: "Hypothalamic hamartoma",
  });
  assert.equal(request.randomSpec, null);
  assert.equal(request.selectedCasePath, "/cases/hypothalamic-hamartoma-15");
  assert.equal(request.diagnosis, "Hypothalamic hamartoma");
});
