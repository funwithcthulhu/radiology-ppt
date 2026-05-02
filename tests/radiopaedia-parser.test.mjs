import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {
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
