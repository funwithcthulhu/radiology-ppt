import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {
  buildTeachingPoints,
  buildCaseSearchUrl,
  parseCaseSearchResults,
  parseCaseSystemsFromHtml,
} from "../src/radiopaedia.mjs";

test("parses Radiopaedia case search result fixtures without network access", async () => {
  const html = await fs.readFile(path.resolve("tests", "fixtures", "radiopaedia-search-results.html"), "utf8");
  const results = parseCaseSearchResults(html);

  assert.equal(results.length, 2);
  assert.deepEqual(parseCaseSystemsFromHtml(html), ["Central Nervous System", "Paediatrics"]);
  assert.equal(results[0].casePath, "/cases/multiple-sclerosis-42");
  assert.equal(results[0].title, "Multiple sclerosis");
  assert.match(results[0].snippet, /MRI brain/);
});

test("builds stable Radiopaedia case search URLs", () => {
  const url = new URL(buildCaseSearchUrl({
    query: "multiple sclerosis",
    systems: ["Central Nervous System", "Paediatrics"],
    page: 2,
  }));

  assert.equal(url.origin, "https://radiopaedia.org");
  assert.equal(url.pathname, "/search");
  assert.equal(url.searchParams.get("scope"), "cases");
  assert.equal(url.searchParams.get("q"), "multiple sclerosis");
  assert.equal(url.searchParams.get("page"), "2");
  assert.deepEqual(url.searchParams.getAll("system[]"), ["Central Nervous System", "Paediatrics"]);
});

test("builds complete teaching-point sentences without ellipses", () => {
  const points = buildTeachingPoints({
    request: {},
    description: "",
    findings:
      "An ovoid shaped lesion in the splenium of the corpus callosum shows high signal intensity on T2WI and FLAIR, restricted diffusion, and low ADC values. Follow-up imaging usually demonstrates interval resolution.",
    diagnosis: "Cytotoxic lesion of the corpus callosum",
    caseTitle: "Cytotoxic lesions of the corpus callosum (CLOCCs)",
    modalitySummary: "MRI brain",
    images: [{}, {}],
  });

  assert.equal(points[0].endsWith("low ADC values."), true);
  assert.equal(points[0].includes("…"), false);
  assert.equal(points[0].includes("..."), false);
});
