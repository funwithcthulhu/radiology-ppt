import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { recordCaseIndex, writeRandomHistory } from "../src/app-store.mjs";
import {
  buildTeachingPoints,
  buildCaseSearchUrl,
  expandCaseRequests,
  extractSearchPageNumbers,
  inspectRadiopaediaCaseCandidates,
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

test("extracts Radiopaedia search pages regardless of query parameter order", () => {
  const html = `
    <a href="/search?page=2&amp;scope=cases&amp;q=msk">2</a>
    <a href="/search?scope=cases&amp;q=msk&amp;page=3">3</a>
    <a href="https://radiopaedia.org/search?lang=us&amp;scope=cases&amp;page=4">4</a>
    <a href="/search?page=5&amp;scope=articles">not cases</a>
  `;

  assert.deepEqual(extractSearchPageNumbers(html), [2, 3, 4]);
});

test("matches excluded manual case paths even when query strings differ", async () => {
  const result = await inspectRadiopaediaCaseCandidates({
    requestMode: "manual",
    selectedCasePath: "https://radiopaedia.org/cases/colonic-diverticulosis-1?lang=us",
    excludeCasePaths: ["/cases/colonic-diverticulosis-1?lang=us"],
  });

  assert.equal(result.needsReview, true);
  assert.deepEqual(result.candidates, []);
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

test("shortens oversized teaching points at word boundaries", () => {
  const points = buildTeachingPoints({
    request: {},
    description: "",
    findings:
      "This deliberately oversized teaching sentence contains enough detail to overflow a teaching slide if inserted verbatim, including imaging appearance, anatomic distribution, clinical context, follow-up considerations, and several extra clauses that should not create a mid-word or ellipsis cutoff in PowerPoint.",
    diagnosis: "Example diagnosis",
    caseTitle: "Example case",
    modalitySummary: "",
    images: [],
  });

  assert.equal(points[0].endsWith("."), true);
  assert.equal(points[0].includes("..."), false);
  assert.equal(points[0].length <= 221, true);
});

test("uses the local case index when live random search is disabled", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "radiology-indexed-random-"));
  process.env.RADIOLOGY_PPT_DATABASE_PATH = path.join(tempDir, "state.sqlite");

  await recordCaseIndex({
    caseData: {
      casePath: "/cases/cached-ms-1?lang=us",
      caseTitle: "Cached multiple sclerosis",
      diagnosisQuery: "multiple sclerosis",
      studyHint: "mri brain",
      modalitySummary: "MRI",
      images: [{ frameId: "a" }, { frameId: "b" }, { frameId: "c" }],
      quality: {
        selectedCount: 3,
        strongCount: 2,
        overallScore: 900,
        summary: "3 relevant images selected.",
      },
    },
    request: {
      randomSystems: ["Central Nervous System"],
    },
    source: "unit-test",
  });

  const expanded = await expandCaseRequests(
    [
      {
        requestMode: "random",
        randomCount: 1,
        randomSystems: ["Central Nervous System"],
        modality: "MRI",
      },
    ],
    { readRandomHistory: false, writeRandomHistory: false, allowLiveSearch: false },
  );

  assert.equal(expanded.length, 1);
  assert.equal(expanded[0].selectedCasePath, "/cases/cached-ms-1");
  assert.equal(expanded[0].selectedCaseTitle, "Cached multiple sclerosis");
});

test("excludes previously selected random cases from later random runs", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "radiology-random-history-"));
  process.env.RADIOLOGY_PPT_DATABASE_PATH = path.join(tempDir, "state.sqlite");

  await recordCaseIndex({
    caseData: {
      casePath: "/cases/prior-random-case?lang=us",
      caseTitle: "Prior random case",
      diagnosisQuery: "prior",
      modalitySummary: "CT",
      images: [{ frameId: "a" }, { frameId: "b" }],
      quality: {
        selectedCount: 2,
        strongCount: 2,
        overallScore: 900,
        summary: "2 relevant images selected.",
      },
    },
    request: {},
    source: "unit-test",
  });
  await recordCaseIndex({
    caseData: {
      casePath: "/cases/fresh-random-case?lang=us",
      caseTitle: "Fresh random case",
      diagnosisQuery: "fresh",
      modalitySummary: "CT",
      images: [{ frameId: "c" }, { frameId: "d" }],
      quality: {
        selectedCount: 2,
        strongCount: 2,
        overallScore: 800,
        summary: "2 relevant images selected.",
      },
    },
    request: {},
    source: "unit-test",
  });
  await writeRandomHistory(["/cases/prior-random-case"], { source: "unit-test", limit: 10 });

  const expanded = await expandCaseRequests(
    [
      {
        requestMode: "random",
        randomCount: 1,
      },
    ],
    { readRandomHistory: true, writeRandomHistory: false, allowLiveSearch: false },
  );

  assert.equal(expanded.length, 1);
  assert.equal(expanded[0].selectedCasePath, "/cases/fresh-random-case");
});

test("default random mode does not backfill with previous random cases", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "radiology-only-new-random-"));
  process.env.RADIOLOGY_PPT_DATABASE_PATH = path.join(tempDir, "state.sqlite");

  for (const [casePath, caseTitle] of [
    ["/cases/used-random-case", "Used random case"],
    ["/cases/new-random-case", "New random case"],
  ]) {
    await recordCaseIndex({
      caseData: {
        casePath,
        caseTitle,
        diagnosisQuery: caseTitle,
        modalitySummary: "MRI",
        images: [{ frameId: `${casePath}-1` }, { frameId: `${casePath}-2` }],
        quality: {
          selectedCount: 2,
          strongCount: 2,
          overallScore: 850,
          summary: "2 relevant images selected.",
        },
      },
      request: {},
      source: "unit-test",
    });
  }
  await writeRandomHistory(["/cases/used-random-case"], { source: "unit-test", limit: 10 });

  const expanded = await expandCaseRequests(
    [
      {
        requestMode: "random",
        randomCount: 2,
      },
    ],
    {
      readRandomHistory: true,
      writeRandomHistory: false,
      allowLiveSearch: false,
    },
  );

  assert.equal(expanded.length, 1);
  assert.deepEqual(expanded.map((entry) => entry.selectedCasePath), ["/cases/new-random-case"]);
});

test("random mode can explicitly backfill with previous cases", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "radiology-random-backfill-"));
  process.env.RADIOLOGY_PPT_DATABASE_PATH = path.join(tempDir, "state.sqlite");

  for (const [casePath, caseTitle] of [
    ["/cases/used-random-case", "Used random case"],
    ["/cases/new-random-case", "New random case"],
  ]) {
    await recordCaseIndex({
      caseData: {
        casePath,
        caseTitle,
        diagnosisQuery: caseTitle,
        modalitySummary: "MRI",
        images: [{ frameId: `${casePath}-1` }, { frameId: `${casePath}-2` }],
        quality: {
          selectedCount: 2,
          strongCount: 2,
          overallScore: 850,
          summary: "2 relevant images selected.",
        },
      },
      request: {},
      source: "unit-test",
    });
  }
  await writeRandomHistory(["/cases/used-random-case"], { source: "unit-test", limit: 10 });

  const expanded = await expandCaseRequests(
    [
      {
        requestMode: "random",
        randomCount: 2,
      },
    ],
    {
      readRandomHistory: true,
      writeRandomHistory: false,
      allowRandomHistoryFallback: true,
      allowLiveSearch: false,
    },
  );

  assert.equal(expanded.length, 2);
  assert.deepEqual(
    expanded.map((entry) => entry.selectedCasePath).sort(),
    ["/cases/new-random-case", "/cases/used-random-case"],
  );
});
