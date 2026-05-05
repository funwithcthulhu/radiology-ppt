import test from "node:test";
import assert from "node:assert/strict";
import { parseCaseRequest, titleFromCasePath } from "../src/request-parser.mjs";

test("parses a specific diagnosis with a modality/anatomy hint", () => {
  const request = parseCaseRequest("multiple sclerosis, mri brain");
  assert.equal(request.diagnosis, "multiple sclerosis");
  assert.equal(request.studyHint, "mri brain");
  assert.deepEqual(request.preferredModalities, ["MRI"]);
});

test("does not treat diagnosis words containing anatomy aliases as random directives", () => {
  const pneumothorax = parseCaseRequest("pneumothorax, chest");
  assert.equal(pneumothorax.diagnosis, "pneumothorax");
  assert.equal(pneumothorax.studyHint, "chest");
  assert.equal(pneumothorax.randomSpec, null);

  const pulmonaryEmbolism = parseCaseRequest("pulmonary embolism, cta chest");
  assert.equal(pulmonaryEmbolism.diagnosis, "pulmonary embolism");
  assert.equal(pulmonaryEmbolism.studyHint, "cta chest");
  assert.equal(pulmonaryEmbolism.randomSpec, null);
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

test("derives readable titles from full Radiopaedia URLs", () => {
  assert.equal(
    titleFromCasePath("https://radiopaedia.org/cases/hypothalamic-hamartoma-15?lang=us"),
    "hypothalamic hamartoma",
  );

  const request = parseCaseRequest({
    requestMode: "manual",
    selectedCasePath: "https://radiopaedia.org/cases/colonic-diverticulosis-1?lang=us",
  });

  assert.equal(request.diagnosis, "colonic diverticulosis");
  assert.equal(request.rawInput, "colonic diverticulosis");
});

test("handles terse and misspelled random category requests", () => {
  const msk = parseCaseRequest("muskuloskeletal diagnosis");
  assert.equal(msk.randomSpec.count, 1);
  assert.deepEqual(msk.randomSpec.systems, ["Musculoskeletal"]);

  const countOnly = parseCaseRequest("3");
  assert.equal(countOnly.randomSpec.count, 3);

  const mixed = parseCaseRequest("random pediatric neuro MRI brain 100");
  assert.equal(mixed.randomSpec.count, 20);
  assert.deepEqual(mixed.randomSpec.systems.sort(), ["Central Nervous System", "Paediatrics"].sort());
  assert.equal(mixed.studyHint, "mri brain");
  assert.deepEqual(mixed.preferredModalities, ["MRI"]);
});

test("normalizes structured request dropdown edge values", () => {
  const random = parseCaseRequest({
    requestMode: "random",
    randomCount: 0,
    modality: "Any",
    anatomy: "Brain",
    ageGroup: "Peds",
    topicFocus: "Trauma",
    randomSystemMode: "any",
  });

  assert.equal(random.randomSpec.count, 1);
  assert.equal(random.studyHint, "Brain");
  assert.deepEqual(random.randomSpec.systems.sort(), ["Paediatrics", "Trauma"].sort());
  assert.equal(random.randomSpec.queryText, "pediatric trauma");
  assert.equal(random.randomSpec.systemMode, "any");
});
