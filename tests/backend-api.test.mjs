import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  loadCaseRequestEntries,
  normalizeCaseRequestEntries,
  normalizePreparedItems,
} from "../src/backend-api.mjs";

test("backend API loads text request files with comments removed", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "radiology-api-"));
  const requestPath = path.join(tempDir, "requests.txt");
  await fs.writeFile(
    requestPath,
    "multiple sclerosis, mri brain\n# comment\nappendicitis, ct abdomen # trailing comment\n",
    "utf8",
  );

  assert.deepEqual(await loadCaseRequestEntries(requestPath), [
    "multiple sclerosis, mri brain",
    "appendicitis, ct abdomen",
  ]);
});

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
