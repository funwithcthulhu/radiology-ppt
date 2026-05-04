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
