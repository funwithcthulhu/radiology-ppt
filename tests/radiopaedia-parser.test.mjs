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

test("deduplicates search results by case path even when URLs differ", () => {
  const html = `
    <a class="search-result-case" href="/cases/example-case-1?lang=us">
      <h4>Example case</h4>
      <span>Case</span> First copy
    </a>
    <a class="search-result-case" href="https://radiopaedia.org/cases/example-case-1">
      <h4>Example case duplicate</h4>
      <span>Case</span> Second copy
    </a>
    <a class="search-result-case" href="/cases/another-case">
      <h4>Another case</h4>
      <span>Case</span> Separate case
    </a>
  `;

  const results = parseCaseSearchResults(html);

  assert.equal(results.length, 2);
  assert.deepEqual(results.map((result) => result.casePath), [
    "/cases/example-case-1?lang=us",
    "/cases/another-case",
  ]);
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

test("falls back to broader case search when filtered Radiopaedia search fails", async () => {
  const html = await fs.readFile(path.resolve("tests", "fixtures", "radiopaedia-search-results.html"), "utf8");
  const fetchedUrls = [];
  const result = await inspectRadiopaediaCaseCandidates(
    {
      requestMode: "specific",
      diagnosis: "multiple sclerosis",
      searchSystems: ["Central Nervous System"],
    },
    {
      limit: 2,
      fetchSearchText: async (url) => {
        fetchedUrls.push(url);
        if (new URL(url).searchParams.getAll("system[]").length) {
          throw new Error("HTTP 403");
        }
        return html;
      },
    },
  );

  assert.equal(new URL(fetchedUrls[0]).searchParams.getAll("system[]").length, 1);
  assert.equal(new URL(fetchedUrls[1]).searchParams.getAll("system[]").length, 0);
  assert.equal(result.candidates[0].casePath, "/cases/multiple-sclerosis-42");
});

test("retries suspicious empty Radiopaedia search pages without cache", async () => {
  const html = await fs.readFile(path.resolve("tests", "fixtures", "radiopaedia-search-results.html"), "utf8");
  const calls = [];
  const result = await inspectRadiopaediaCaseCandidates(
    {
      requestMode: "specific",
      diagnosis: "multiple sclerosis",
    },
    {
      limit: 2,
      fetchSearchText: async (url, headers = {}) => {
        calls.push({ url, headers });
        if (!new URL(url).searchParams.has("_rp_no_cache")) {
          return "<html><body>temporarily unavailable</body></html>";
        }
        return html;
      },
    },
  );

  assert.equal(calls.length, 2);
  assert.equal(calls[1].headers["cache-control"], "no-cache");
  assert.equal(result.candidates[0].casePath, "/cases/multiple-sclerosis-42");
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

test("core review teaching points use board-style radiology pearls", () => {
  const points = buildTeachingPoints({
    request: {
      coreReviewPlan: { domain: "mr", anatomyPrompt: "pelvis" },
      studyHint: "MRI pelvis",
    },
    description:
      "Surgically proved low type inter-sphincteric fistula. The integrity of the external anal sphincter is crucial for the management's planning, also it is important to identify any side branches.",
    findings:
      "A linear fistulous tract is seen oriented vertically, passing through the left side of the inter-sphincteric plane, starting superiorly from the level of the dentate line where it is seen abutting the internal sphincter.",
    diagnosis: "Perianal fistula",
    caseTitle: "Perianal fistula",
    modalitySummary: "MRI pelvis",
    images: [{}],
  });

  assert.equal(points.length, 3);
  assert.match(points.join(" "), /MRI CORE discriminator/);
  assert.match(points.join(" "), /sphincter relationship/);
  assert.match(points.join(" "), /secondary tracts/);
  assert.equal(points.some((point) => /Surgically proved|management's planning/i.test(point)), false);
  assert.equal(points.some((point) => /This case is best reviewed|selected image/i.test(point)), false);
});

test("core review teaching points do not pad with generic non-radiology filler", () => {
  const points = buildTeachingPoints({
    request: {
      coreReviewPlan: { domain: "gi", anatomyPrompt: "abdomen" },
      studyHint: "CT abdomen",
    },
    description: "The patient had abdominal pain and was treated clinically.",
    findings: "Clinical follow-up was recommended.",
    diagnosis: "Unrecognized example",
    caseTitle: "Unrecognized example",
    modalitySummary: "CT",
    images: [{}],
  });

  assert.deepEqual(points, []);
});

test("core review teaching points reject case-course text and use subdural pearls", () => {
  const points = buildTeachingPoints({
    request: {
      coreReviewPlan: { domain: "neuro", anatomyPrompt: "head" },
      studyHint: "CT head",
    },
    description: "Improved mass effect in the orbit post resection of mass.",
    findings: "Subdural collection along the cerebral convexity with mild mass effect.",
    diagnosis: "Subdural hematoma",
    caseTitle: "Subdural hematoma",
    modalitySummary: "CT head",
    images: [{}],
  });

  assert.equal(points.length, 3);
  assert.match(points.join(" "), /crescentic extra-axial blood/);
  assert.match(points.join(" "), /midline shift/);
  assert.match(points.join(" "), /epidural hematoma/);
  assert.equal(points.some((point) => /Improved mass effect|post resection/i.test(point)), false);
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
