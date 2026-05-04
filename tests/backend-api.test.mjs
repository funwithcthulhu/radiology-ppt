import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeCaseRequestEntries,
  normalizePreparedItems,
} from "../src/backend-api.mjs";

test("backend API normalizes request rows and render payloads", () => {
  const requests = normalizeCaseRequestEntries([
    "multiple sclerosis, mri brain",
    "multiple sclerosis, mri brain",
    {
      requestMode: "random",
      rawInput: "random neuro",
      randomCount: 2,
      randomSystems: ["Central Nervous System"],
      randomSystemMode: "all",
    },
  ]);

  assert.equal(requests.length, 2);
  assert.equal(requests[0].diagnosis, "multiple sclerosis");
  assert.equal(requests[1].randomSpec?.count, 2);

  const prepared = normalizePreparedItems({
    items: [
      {
        request: { rawInput: "appendicitis", diagnosis: "appendicitis" },
        caseData: { caseTitle: "Appendicitis", images: [] },
      },
    ],
  });

  assert.equal(prepared.length, 1);
  assert.equal(prepared[0].caseData.caseTitle, "Appendicitis");
});

test("backend API drops empty rows but keeps repeated random rows", () => {
  const requests = normalizeCaseRequestEntries([
    "",
    "   ",
    null,
    "random",
    "random",
    "appendicitis, ct abdomen",
    "appendicitis, ct abdomen",
  ]);

  assert.equal(requests.length, 3);
  assert.equal(requests.filter((request) => request.randomSpec).length, 2);
  assert.equal(requests.filter((request) => request.diagnosis === "appendicitis").length, 1);
});

test("prepared item normalization rejects malformed render payloads", () => {
  assert.throws(
    () => normalizePreparedItems({}),
    /Prepared input must contain an array/,
  );

  const prepared = normalizePreparedItems([
    {
      request: {
        requestMode: "manual",
        rawInput: "Manual URL",
        selectedCasePath: "https://radiopaedia.org/cases/example-case-1?lang=us",
      },
      caseData: {
        caseTitle: "Example case",
        images: [],
      },
    },
    {
      request: { rawInput: "" },
      caseData: { caseTitle: "" },
    },
  ]);

  assert.equal(prepared.length, 1);
  assert.equal(prepared[0].request.rawInput, "Manual URL");
  assert.equal(prepared[0].request.diagnosis, "example case");
});
