import test from "node:test";
import assert from "node:assert/strict";
import {
  parseCaseRequest,
  parseCaseRequestList,
  titleFromCasePath,
} from "../src/request-parser.mjs";

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
    titleFromCasePath(
      "https://radiopaedia.org/cases/hypothalamic-hamartoma-15?lang=us",
    ),
    "hypothalamic hamartoma",
  );

  const request = parseCaseRequest({
    requestMode: "manual",
    selectedCasePath:
      "https://radiopaedia.org/cases/colonic-diverticulosis-1?lang=us",
  });

  assert.equal(request.diagnosis, "colonic diverticulosis");
  assert.equal(request.rawInput, "colonic diverticulosis");
});

test("detects standalone Radiopaedia case URLs as manual case URL rows", () => {
  const request = parseCaseRequest(
    "https://radiopaedia.org/cases/colonic-diverticulosis-1?lang=us",
  );

  assert.equal(request.requestMode, "manual");
  assert.equal(
    request.selectedCasePath,
    "https://radiopaedia.org/cases/colonic-diverticulosis-1?lang=us",
  );
  assert.equal(request.diagnosis, "colonic diverticulosis");
  assert.equal(request.randomSpec, null);
});

test("does not treat manual report or free text rows as URLs", () => {
  const report = parseCaseRequest(
    "History of trauma. CT shows a small subdural hematoma.",
  );
  assert.equal(report.selectedCasePath, undefined);
  assert.equal(report.requestMode, undefined);
  assert.equal(report.diagnosis, "History of trauma. CT shows a small subdural hematoma.");

  const nonCaseUrl = parseCaseRequest(
    "https://radiopaedia.org/articles/subdural-haemorrhage",
  );
  assert.equal(nonCaseUrl.selectedCasePath, undefined);
  assert.equal(nonCaseUrl.requestMode, undefined);
});

test("parses plain text, CSV, TSV, and JSON request lists", () => {
  assert.deepEqual(parseCaseRequestList("appendicitis, ct abdomen\nrandom neuro 2"), [
    "appendicitis, ct abdomen",
    "random neuro 2",
  ]);

  assert.deepEqual(
    parseCaseRequestList(
      'diagnosis,study hint\n"multiple sclerosis","mri brain"\nappendicitis,ct abdomen',
    ),
    [
      { diagnosis: "multiple sclerosis", studyHint: "mri brain" },
      { diagnosis: "appendicitis", studyHint: "ct abdomen" },
    ],
  );

  assert.deepEqual(
    parseCaseRequestList(
      "request\tselected case url\tselected case title\nManual URL\thttps://radiopaedia.org/cases/example-case-1\tExample case",
    ),
    [
      {
        rawInput: "Manual URL",
        selectedCasePath: "https://radiopaedia.org/cases/example-case-1",
        selectedCaseTitle: "Example case",
      },
    ],
  );

  assert.deepEqual(
    parseCaseRequestList(
      JSON.stringify({
        entries: [
          "appendicitis, ct abdomen",
          { requestMode: "random", randomCount: 2 },
        ],
      }),
    ),
    ["appendicitis, ct abdomen", { requestMode: "random", randomCount: 2 }],
  );
});

test("rejects PDF and binary request-list imports with a helpful error", () => {
  assert.throws(
    () => parseCaseRequestList("%PDF-1.7\n1 0 obj\nendobj\nxref\n%%EOF"),
    /Unsupported request-list import: PDF content.*plain text, CSV, TSV, or JSON/,
  );
  assert.throws(
    () => parseCaseRequestList(["appendicitis", "endobj", "xref", "%%EOF"]),
    /Unsupported request-list import: PDF content|Unsupported request-list import: PDF object content/,
  );
  assert.throws(
    () => parseCaseRequest("%%EOF"),
    /Unsupported request-list import/,
  );
});

test("handles terse and misspelled random category requests", () => {
  const msk = parseCaseRequest("muskuloskeletal diagnosis");
  assert.equal(msk.randomSpec.count, 1);
  assert.deepEqual(msk.randomSpec.systems, ["Musculoskeletal"]);

  const countOnly = parseCaseRequest("3");
  assert.equal(countOnly.randomSpec.count, 3);

  const mixed = parseCaseRequest("random pediatric neuro MRI brain 100");
  assert.equal(mixed.randomSpec.count, 20);
  assert.deepEqual(
    mixed.randomSpec.systems.sort(),
    ["Central Nervous System", "Paediatrics"].sort(),
  );
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
  assert.deepEqual(
    random.randomSpec.systems.sort(),
    ["Paediatrics", "Trauma"].sort(),
  );
  assert.equal(random.randomSpec.queryText, "pediatric trauma");
  assert.equal(random.randomSpec.systemMode, "any");
});
