import fs from "node:fs/promises";
import path from "node:path";
import { cleanText, collapseWhitespace, dedupe, truncate } from "./utils.mjs";
import {
  KNOWN_CASE_SYSTEMS,
  normalizePhrase,
  parseCaseRequest,
  preferredModalitiesFromHint,
  similarityScore,
  stripModalityTerms,
  titleFromCasePath,
  tokenOverlapScore,
  wordTokens,
} from "./request-parser.mjs";
import {
  readAvoidedCasePaths,
  readIndexedRandomCases,
  readRandomHistory,
  writeRandomHistory,
} from "./app-store.mjs";
import { emitProgress, emitWarning } from "./backend-events.mjs";
import {
  APP_ROOT,
  BASE_URL,
  absoluteUrl,
  fetchText,
} from "./providers/radiopaedia-provider.mjs";

const RANDOM_HISTORY_LIMIT = 1000;
const RANDOM_HISTORY_PATH = path.join(
  APP_ROOT,
  "cache",
  "random-selection-history.json",
);
const RANDOM_SEARCH_QUERY_LIMIT = boundedInteger(
  process.env.RADIOLOGY_PPT_RANDOM_SEARCH_QUERY_LIMIT,
  8,
  1,
  20,
);
const RANDOM_SEARCH_PAGE_SCAN_LIMIT = boundedInteger(
  process.env.RADIOLOGY_PPT_RANDOM_SEARCH_PAGE_LIMIT,
  250,
  2,
  1000,
);
const RANDOM_CANDIDATE_REVIEW_LIMIT = boundedInteger(
  process.env.RADIOLOGY_PPT_RANDOM_CANDIDATE_LIMIT,
  3000,
  25,
  10000,
);
const RANDOM_SEARCH_TIME_LIMIT_MS = boundedInteger(
  process.env.RADIOLOGY_PPT_RANDOM_SEARCH_TIMEOUT_MS,
  300000,
  10000,
  900000,
);
const SEARCH_HTML_BLOCKED_PATTERN =
  /(?:Just a moment|Attention Required|cf-browser-verification|captcha|rate limit|temporarily unavailable)/i;
const SEARCH_HTML_SHELL_PATTERN =
  /(?:id="search-results"|search-results-wrapper|listing-wrapper)/i;

function boundedInteger(rawValue, defaultValue, minimum, maximum) {
  const parsed = Number.parseInt(rawValue ?? "", 10);
  if (!Number.isInteger(parsed)) {
    return defaultValue;
  }

  return Math.max(minimum, Math.min(maximum, parsed));
}

async function loadRandomHistory(historyPath = RANDOM_HISTORY_PATH) {
  if (historyPath === RANDOM_HISTORY_PATH) {
    const stored = await readRandomHistory({ limit: RANDOM_HISTORY_LIMIT });
    if (stored.length) {
      return stored;
    }
  }

  try {
    const raw = await fs.readFile(historyPath, "utf8");
    const parsed = JSON.parse(raw);
    const values = Array.isArray(parsed) ? parsed : parsed?.casePaths;
    if (!Array.isArray(values)) {
      return [];
    }
    return dedupe(
      values.map((value) => collapseWhitespace(value)).filter(Boolean),
    ).slice(0, RANDOM_HISTORY_LIMIT);
  } catch {
    return [];
  }
}

export async function saveRandomHistory(
  casePaths,
  historyPath = RANDOM_HISTORY_PATH,
) {
  if (historyPath === RANDOM_HISTORY_PATH) {
    await writeRandomHistory(casePaths, {
      source: "prepare",
      limit: RANDOM_HISTORY_LIMIT,
    });
    return;
  }

  const recent = await loadRandomHistory(historyPath);
  const next = [];
  const seen = new Set();

  for (const casePath of [...casePaths, ...recent]) {
    const clean = collapseWhitespace(casePath);
    if (!clean || seen.has(clean)) {
      continue;
    }
    seen.add(clean);
    next.push(clean);
    if (next.length >= RANDOM_HISTORY_LIMIT) {
      break;
    }
  }

  await fs.mkdir(path.dirname(historyPath), { recursive: true });
  await fs.writeFile(
    historyPath,
    `${JSON.stringify({ updatedAt: new Date().toISOString(), casePaths: next }, null, 2)}\n`,
    "utf8",
  );
}

function shouldRememberRandomEntry(request) {
  return Boolean(
    request.originalInput ||
      request.randomSpec ||
      request.randomQuery ||
      (Array.isArray(request.randomSystems) && request.randomSystems.length),
  );
}

function extractFirst(pattern, text) {
  const match = pattern.exec(text);
  return match ? match[1] : null;
}

function candidateScore(request, title, snippet = "") {
  const diagnosisScore = similarityScore(
    request.diagnosis || request.rawInput,
    title,
  );
  const snippetScore = snippet
    ? tokenOverlapScore(request.diagnosis || request.rawInput, snippet)
    : 0;
  const titleAndSnippet = `${title} ${snippet}`;
  const hintBonus =
    request.studyHint &&
    normalizePhrase(titleAndSnippet).includes(
      normalizePhrase(request.studyHint),
    )
      ? 0.03
      : 0;
  const filterBonus =
    request.filterQuery &&
    normalizePhrase(titleAndSnippet).includes(
      normalizePhrase(request.filterQuery),
    )
      ? 0.05
      : 0;

  return Math.min(
    0.99,
    Math.max(diagnosisScore, snippetScore) + hintBonus + filterBonus,
  );
}

export function parseCaseSystemsFromHtml(html) {
  const keywords = cleanText(
    extractFirst(/<meta\s+name="keywords"\s+content="([^"]+)"/i, html),
  );
  if (!keywords) {
    return [];
  }

  const keywordParts = keywords
    .split(",")
    .map((value) => cleanText(value))
    .filter(Boolean);

  return keywordParts.filter((value) => KNOWN_CASE_SYSTEMS.includes(value));
}

export function parseCaseSearchResults(html) {
  const results = [];
  const blocks = [
    ...html.matchAll(
      /<a class="[^"]*search-result-case[^"]*" href="([^"]+)">([\s\S]*?)<\/a>/g,
    ),
  ];

  for (const match of blocks) {
    const casePath = match[1];
    const body = match[2];
    const title =
      cleanText(extractFirst(/<h4[^>]*>([\s\S]*?)<\/h4>/i, body)) ||
      titleFromCasePath(casePath) ||
      "Radiopaedia case";
    const snippetText = cleanText(
      body
        .replace(/<span[^>]*>[\s\S]*?<\/span>/gi, " ")
        .replace(/<h4[^>]*>[\s\S]*?<\/h4>/i, " "),
    )
      .replace(/^Case\b/i, "")
      .trim();

    results.push({
      casePath,
      caseUrl: absoluteUrl(casePath),
      title,
      snippet: truncate(snippetText, 220),
    });
  }

  const unique = new Map();
  for (const candidate of results) {
    const key = comparableCasePath(candidate.casePath);
    if (key && !unique.has(key)) {
      unique.set(key, candidate);
    }
  }
  return [...unique.values()];
}

function parseSearchResultCandidates(html, request, limit = 5) {
  const results = parseCaseSearchResults(html).map((candidate) => ({
    ...candidate,
    score: candidateScore(request, candidate.title, candidate.snippet),
  }));

  return results
    .sort(
      (left, right) =>
        right.score - left.score || left.title.localeCompare(right.title),
    )
    .slice(0, limit);
}

function cacheBustedSearchUrl(searchUrl) {
  const url = new URL(searchUrl);
  url.searchParams.set("_rp_no_cache", String(Date.now()));
  return url.toString();
}

function searchHtmlLooksSuspicious(html) {
  const body = String(html ?? "");
  if (!body.trim()) {
    return true;
  }
  return (
    SEARCH_HTML_BLOCKED_PATTERN.test(body) ||
    (!SEARCH_HTML_SHELL_PATTERN.test(body) && body.length < 10000)
  );
}

async function fetchSearchResultCandidates(
  searchUrl,
  request,
  limit,
  fetchSearchText,
) {
  const html = await fetchSearchText(searchUrl);
  let results = parseSearchResultCandidates(html, request, limit);
  if (results.length || !searchHtmlLooksSuspicious(html)) {
    return { results, retried: false };
  }

  const retryUrl = cacheBustedSearchUrl(searchUrl);
  const retryHtml = await fetchSearchText(retryUrl, {
    "cache-control": "no-cache",
    pragma: "no-cache",
  });
  results = parseSearchResultCandidates(retryHtml, request, limit);
  return { results, retried: true };
}

export function buildCaseSearchUrl({
  query = "",
  systems = [],
  page = 1,
} = {}) {
  const searchUrl = new URL(`${BASE_URL}/search`);
  searchUrl.searchParams.set("lang", "us");
  searchUrl.searchParams.set("scope", "cases");
  searchUrl.searchParams.set("page", String(Math.max(1, page)));
  for (const system of dedupe(systems)) {
    searchUrl.searchParams.append("system[]", system);
  }
  const cleanQuery = collapseWhitespace(query);
  if (cleanQuery) {
    searchUrl.searchParams.set("q", cleanQuery);
  }
  return searchUrl.toString();
}

export function comparableCasePath(value) {
  const clean = collapseWhitespace(value).replace(/\?.*$/, "");
  try {
    const url = new URL(clean);
    return /(^|\.)radiopaedia\.org$/i.test(url.hostname) ? url.pathname : clean;
  } catch {
    return clean;
  }
}

export function extractSearchPageNumbers(html) {
  return dedupe(
    [...String(html ?? "").matchAll(/href="([^"]+)"/g)]
      .map((match) => match[1].replace(/&amp;/g, "&"))
      .filter((href) => href.includes("scope=cases"))
      .map((href) => {
        try {
          return Number.parseInt(
            new URL(href, BASE_URL).searchParams.get("page") || "",
            10,
          );
        } catch {
          return Number.NaN;
        }
      })
      .filter((value) => Number.isInteger(value) && value >= 1),
  ).sort((left, right) => left - right);
}

function shuffle(values) {
  const items = [...values];
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [items[index], items[swapIndex]] = [items[swapIndex], items[index]];
  }
  return items;
}

function rotate(values, offset) {
  if (!values.length) {
    return [];
  }
  const start = Math.abs(offset) % values.length;
  return [...values.slice(start), ...values.slice(0, start)];
}

function buildRandomSearchQueries(request) {
  const randomQuery = request.randomSpec?.queryText || "";
  const studyHint = request.studyHint || "";
  const filterQuery = request.filterQuery || "";
  const strippedHint = stripModalityTerms(studyHint);
  return dedupe([
    collapseWhitespace(
      [randomQuery, filterQuery, studyHint].filter(Boolean).join(" "),
    ),
    collapseWhitespace(
      [randomQuery, filterQuery, strippedHint].filter(Boolean).join(" "),
    ),
    collapseWhitespace([filterQuery, studyHint].filter(Boolean).join(" ")),
    collapseWhitespace([filterQuery, strippedHint].filter(Boolean).join(" ")),
    collapseWhitespace([randomQuery, filterQuery].filter(Boolean).join(" ")),
    strippedHint,
    filterQuery,
    randomQuery,
    studyHint,
    "",
  ]);
}

async function fetchRandomSearchPage(query, systems, page) {
  const html = await fetchText(buildCaseSearchUrl({ query, systems, page }));
  return {
    pageNumbers: extractSearchPageNumbers(html),
    candidates: parseCaseSearchResults(html).map((candidate) => ({
      ...candidate,
      searchedSystems: dedupe(systems || []),
      systemsFilterTrusted: Boolean((systems || []).length),
    })),
  };
}

function queueDiscoveredSearchPages(
  queue,
  queuedPages,
  visitedPages,
  pageNumbers,
) {
  const newPages = shuffle(
    dedupe(pageNumbers)
      .filter((page) => page > 0)
      .filter((page) => !queuedPages.has(page) && !visitedPages.has(page)),
  );

  for (const page of newPages) {
    queuedPages.add(page);
    queue.push(page);
  }
}

function queueNextSequentialSearchPage(queue, queuedPages, visitedPages) {
  const nextPage = Math.max(0, ...visitedPages) + 1;
  if (queuedPages.has(nextPage) || visitedPages.has(nextPage)) {
    return false;
  }
  queuedPages.add(nextPage);
  queue.push(nextPage);
  return true;
}

async function candidateSystemList(candidate, htmlCache = new Map()) {
  let html = htmlCache.get(candidate.casePath);
  if (!html) {
    const caseUrl = absoluteUrl(
      candidate.casePath.includes("?")
        ? candidate.casePath
        : `${candidate.casePath}?lang=us`,
    );
    html = await fetchText(caseUrl);
    htmlCache.set(candidate.casePath, html);
  }
  return parseCaseSystemsFromHtml(html);
}

async function candidateMatchesSystems(
  candidate,
  systems,
  htmlCache = new Map(),
  systemMode = "all",
) {
  if (!systems.length) {
    return true;
  }

  const searchedSystems = candidate.searchedSystems || [];
  if (
    candidate.systemsFilterTrusted &&
    searchedSystems.length &&
    (systemMode === "any" ||
      systems.every((system) => searchedSystems.includes(system)))
  ) {
    return true;
  }

  const caseSystems = await candidateSystemList(candidate, htmlCache);
  if (!caseSystems.length) {
    return systemMode === "any" || systems.length <= 1;
  }
  return systemMode === "any"
    ? systems.some((system) => caseSystems.includes(system))
    : systems.every((system) => caseSystems.includes(system));
}

function indexedCaseMatchesSystems(candidate, systems, systemMode = "all") {
  if (!systems.length) {
    return true;
  }

  const candidateSystems = (candidate.systems || [])
    .map((system) => normalizePhrase(system))
    .filter(Boolean);
  const requestedSystems = systems
    .map((system) => normalizePhrase(system))
    .filter(Boolean);
  if (!candidateSystems.length) {
    return systemMode === "any" || requestedSystems.length <= 1;
  }

  return systemMode === "any"
    ? requestedSystems.some((system) => candidateSystems.includes(system))
    : requestedSystems.every((system) => candidateSystems.includes(system));
}

function indexedCaseToCandidate(row) {
  return {
    casePath: row.casePath,
    caseUrl: row.caseUrl || absoluteUrl(row.casePath),
    title:
      row.caseTitle || titleFromCasePath(row.casePath) || "Radiopaedia case",
    snippet: row.qualitySummary || row.diagnosisQuery || "",
    systems: row.systems || [],
    indexedQualityScore: row.qualityScore,
    indexedPreparedCount: row.preparedCount,
    source: "case-index",
  };
}

async function collectIndexedCaseCandidatePool(request, limit, excludePaths) {
  const modality =
    request.preferredModalities?.[0] ||
    preferredModalitiesFromHint(request.studyHint || "")[0] ||
    "";
  const rows = await readIndexedRandomCases({
    limit: Math.max(limit, 12),
    excludeCasePaths: [...excludePaths],
    modality,
    system:
      (request.searchSystems || []).length === 1
        ? request.searchSystems[0]
        : "",
    query: request.diagnosis || request.rawInput,
    minSelectedImages: Math.min(
      Math.max(request.requestedImagesPerCase || 1, 1),
      2,
    ),
  });

  return rows.map(indexedCaseToCandidate);
}

async function collectIndexedRandomCasePool(request, excludePaths) {
  const systems = request.randomSpec?.systems || [];
  const systemMode = request.randomSpec?.systemMode || "all";
  const modality =
    request.preferredModalities?.[0] ||
    preferredModalitiesFromHint(request.studyHint || "")[0] ||
    "";
  const rows = await readIndexedRandomCases({
    limit: Math.max(request.randomSpec.count + 24, 48),
    excludeCasePaths: [...excludePaths],
    modality,
    system: systems.length === 1 ? systems[0] : "",
    query: request.randomSpec?.queryText || "",
    minSelectedImages: Math.min(
      Math.max(request.requestedImagesPerCase || 1, 1),
      2,
    ),
  });
  const candidates = rows
    .map(indexedCaseToCandidate)
    .filter((candidate) =>
      indexedCaseMatchesSystems(candidate, systems, systemMode),
    );

  if (candidates.length) {
    emitProgress("Found cached random candidates", {
      request: request.rawInput,
      candidateCount: candidates.length,
      source: "case-index",
    });
  }
  return shuffle(candidates);
}

async function pickMixedCandidates(candidates, desiredCount, htmlCache) {
  const picks = [];
  const usedSystems = new Set();
  const pickedPaths = new Set();

  const attemptPick = async (requireNovelSystem) => {
    for (const candidate of candidates) {
      if (picks.length >= desiredCount) {
        return;
      }
      if (pickedPaths.has(candidate.casePath)) {
        continue;
      }

      const caseSystems = candidate.systems?.length
        ? candidate.systems
        : await candidateSystemList(candidate, htmlCache);
      const hasNovelSystem = caseSystems.some(
        (system) => !usedSystems.has(system),
      );
      if (requireNovelSystem && caseSystems.length && !hasNovelSystem) {
        continue;
      }

      picks.push(candidate);
      pickedPaths.add(candidate.casePath);
      caseSystems.forEach((system) => usedSystems.add(system));
    }
  };

  await attemptPick(true);
  await attemptPick(false);
  return picks.slice(0, desiredCount);
}

function addRandomCandidate(candidateMap, candidate) {
  const casePath = comparableCasePath(candidate.casePath);
  if (!casePath || candidateMap.has(casePath)) {
    return false;
  }
  candidateMap.set(casePath, candidate);
  return true;
}

async function pickRandomCaseCandidates(
  request,
  {
    excludePaths = new Set(),
    allowReuseIfNeeded = true,
    allowLiveSearch = true,
  } = {},
) {
  const systems = request.randomSpec?.systems || [];
  const systemMode = request.randomSpec?.systemMode || "all";
  const candidateMap = new Map();
  const htmlCache = new Map();
  const targetPoolSize = Math.max(
    request.randomSpec.count * 5,
    request.randomSpec.count + 40,
    80,
  );
  const startedAt = Date.now();
  let reviewedCandidates = 0;
  let searchedPages = 0;

  const liveQueries = allowLiveSearch
    ? buildRandomSearchQueries(request).slice(0, RANDOM_SEARCH_QUERY_LIMIT)
    : [];
  for (const query of liveQueries) {
    if (candidateMap.size >= targetPoolSize) {
      break;
    }
    if (Date.now() - startedAt > RANDOM_SEARCH_TIME_LIMIT_MS) {
      break;
    }

    emitProgress("Searching Radiopaedia random cases", {
      query,
      systems,
      pageLimit: RANDOM_SEARCH_PAGE_SCAN_LIMIT,
    });

    const queue = [1];
    const queuedPages = new Set(queue);
    const visitedPages = new Set();
    let emptyPagesInARow = 0;

    while (queue.length) {
      if (
        candidateMap.size >= targetPoolSize ||
        searchedPages >= RANDOM_SEARCH_PAGE_SCAN_LIMIT ||
        reviewedCandidates >= RANDOM_CANDIDATE_REVIEW_LIMIT ||
        Date.now() - startedAt > RANDOM_SEARCH_TIME_LIMIT_MS
      ) {
        break;
      }

      const page = queue.shift();
      queuedPages.delete(page);
      if (visitedPages.has(page)) {
        continue;
      }
      visitedPages.add(page);
      searchedPages += 1;

      let pageResult;
      try {
        pageResult = await fetchRandomSearchPage(query, systems, page);
      } catch (error) {
        emitWarning("Radiopaedia random page could not be read", {
          query,
          systems,
          page,
          message: error.message,
        });
        emptyPagesInARow += 1;
        if (emptyPagesInARow >= 3) {
          break;
        }
        if (!queue.length) {
          queueNextSequentialSearchPage(queue, queuedPages, visitedPages);
        }
        continue;
      }

      const { candidates, pageNumbers } = pageResult;
      emitProgress("Scanned Radiopaedia random page", {
        query,
        systems,
        page,
        candidates: candidates.length,
        totalPagesScanned: searchedPages,
      });
      queueDiscoveredSearchPages(queue, queuedPages, visitedPages, pageNumbers);
      emptyPagesInARow = candidates.length ? 0 : emptyPagesInARow + 1;
      if (emptyPagesInARow >= 3) {
        break;
      }
      if (!queue.length) {
        queueNextSequentialSearchPage(queue, queuedPages, visitedPages);
      }

      for (const candidate of shuffle(candidates)) {
        if (
          Date.now() - startedAt > RANDOM_SEARCH_TIME_LIMIT_MS ||
          reviewedCandidates >= RANDOM_CANDIDATE_REVIEW_LIMIT
        ) {
          break;
        }
        reviewedCandidates += 1;
        if (
          excludePaths.has(comparableCasePath(candidate.casePath)) ||
          candidateMap.has(comparableCasePath(candidate.casePath))
        ) {
          continue;
        }
        if (
          !(await candidateMatchesSystems(
            candidate,
            systems,
            htmlCache,
            systemMode,
          ))
        ) {
          continue;
        }
        addRandomCandidate(candidateMap, candidate);
        if (candidateMap.size >= targetPoolSize) {
          break;
        }
      }

      if (candidateMap.size >= targetPoolSize) {
        break;
      }
    }
  }

  if (candidateMap.size < request.randomSpec.count) {
    for (const candidate of await collectIndexedRandomCasePool(
      request,
      excludePaths,
    )) {
      addRandomCandidate(candidateMap, candidate);
      if (candidateMap.size >= request.randomSpec.count) {
        break;
      }
    }
  }

  const shuffledCandidates = shuffle([...candidateMap.values()]);
  emitProgress("Selecting random cases", {
    request: request.rawInput,
    candidateCount: shuffledCandidates.length,
    requestedCount: request.randomSpec.count,
  });
  let picks =
    request.randomSpec?.diversify === "mixed"
      ? await pickMixedCandidates(
          shuffledCandidates,
          request.randomSpec.count,
          htmlCache,
        )
      : shuffledCandidates.slice(0, request.randomSpec.count);
  if (
    picks.length < request.randomSpec.count &&
    excludePaths.size > 0 &&
    allowReuseIfNeeded
  ) {
    emitWarning(
      "Unused random cases were exhausted in the current search window; filling remaining slots with older cases",
      {
        request: request.rawInput,
        requestedCount: request.randomSpec.count,
        freshPicksFound: picks.length,
      },
    );

    const pickedPaths = new Set(
      picks.map((candidate) => comparableCasePath(candidate.casePath)),
    );
    const fallbackPicks = await pickRandomCaseCandidates(request, {
      excludePaths: pickedPaths,
      allowReuseIfNeeded: false,
      allowLiveSearch,
    });
    const supplemental = [];
    for (const candidate of fallbackPicks) {
      const casePath = comparableCasePath(candidate.casePath);
      if (pickedPaths.has(casePath)) {
        continue;
      }
      supplemental.push(candidate);
      pickedPaths.add(casePath);
      if (picks.length + supplemental.length >= request.randomSpec.count) {
        break;
      }
    }
    picks = picks.concat(supplemental);
    if (picks.length < request.randomSpec.count) {
      emitWarning("Random case pool returned fewer cases than requested", {
        request: request.rawInput,
        requestedCount: request.randomSpec.count,
        picksFound: picks.length,
      });
    }
  } else if (
    picks.length < request.randomSpec.count &&
    excludePaths.size > 0 &&
    !allowReuseIfNeeded
  ) {
    emitWarning("Unused random search returned fewer cases than requested", {
      request: request.rawInput,
      requestedCount: request.randomSpec.count,
      freshPicksFound: picks.length,
    });
  }
  if (!picks.length) {
    const filterBits = dedupe([
      ...(request.randomSpec.systems || []),
      request.randomSpec.queryText,
      request.studyHint,
    ]).filter(Boolean);
    const filterText = filterBits.length ? ` (${filterBits.join(" | ")})` : "";
    const stoppedText =
      Date.now() - startedAt > RANDOM_SEARCH_TIME_LIMIT_MS ||
      reviewedCandidates >= RANDOM_CANDIDATE_REVIEW_LIMIT ||
      searchedPages >= RANDOM_SEARCH_PAGE_SCAN_LIMIT
        ? " within the search limits"
        : "";
    throw new Error(
      `No suitable random Radiopaedia cases were found for "${request.rawInput}"${filterText}${stoppedText}. Try broader filters or fewer constraints.`,
    );
  }

  const fallbackCandidates = shuffledCandidates
    .slice(request.randomSpec.count)
    .map((candidate) => ({
      casePath: candidate.casePath,
      title: candidate.title,
    }));

  return picks.map((candidate, index) => ({
    ...candidate,
    fallbackCandidates: rotate(fallbackCandidates, index),
  }));
}

export async function expandCaseRequests(
  inputs,
  {
    readRandomHistory = false,
    writeRandomHistory = false,
    historyPath = RANDOM_HISTORY_PATH,
    allowRandomHistoryFallback = false,
    allowLiveSearch = true,
  } = {},
) {
  const expanded = [];
  const selectedPaths = new Set(
    readRandomHistory
      ? (await loadRandomHistory(historyPath)).map(comparableCasePath)
      : [],
  );
  if (readRandomHistory && historyPath === RANDOM_HISTORY_PATH) {
    for (const casePath of await readAvoidedCasePaths()) {
      selectedPaths.add(comparableCasePath(casePath));
    }
  }
  const historySelections = [];

  for (const item of inputs) {
    const request = parseCaseRequest(item);
    const requestExcludedPaths = new Set(
      (request.excludeCasePaths ?? [])
        .map((value) => comparableCasePath(value))
        .filter(Boolean),
    );
    if (request.selectedCasePath) {
      const selectedCasePath = comparableCasePath(request.selectedCasePath);
      if (requestExcludedPaths.has(selectedCasePath)) {
        continue;
      }
      if (shouldRememberRandomEntry(request)) {
        historySelections.push(selectedCasePath);
      }
      selectedPaths.add(selectedCasePath);
      expanded.push(request);
      continue;
    }

    if (!request.randomSpec) {
      expanded.push(request);
      continue;
    }

    const picks = await pickRandomCaseCandidates(request, {
      excludePaths: new Set([...selectedPaths, ...requestExcludedPaths]),
      allowReuseIfNeeded: allowRandomHistoryFallback,
      allowLiveSearch,
    });
    for (const pick of picks) {
      emitProgress("Selected random case", {
        title: pick.title,
        casePath: pick.casePath,
      });
      selectedPaths.add(comparableCasePath(pick.casePath));
      historySelections.push(comparableCasePath(pick.casePath));
      expanded.push(
        parseCaseRequest({
          rawInput: collapseWhitespace(
            [pick.title, request.studyHint].filter(Boolean).join(", "),
          ),
          diagnosis: pick.title,
          studyHint: request.studyHint,
          secondaryModality: request.secondaryModality,
          ageGroup: request.ageGroup,
          topicFocus: request.topicFocus,
          difficulty: request.difficulty,
          requestedImagesPerCase: request.requestedImagesPerCase,
          selectedCasePath: pick.casePath,
          selectedCaseTitle: pick.title,
          fallbackCandidates: pick.fallbackCandidates || [],
          originalInput: request.rawInput,
          randomQuery: request.randomSpec.queryText,
          randomSystems: request.randomSpec.systems,
          randomDiversity: request.randomSpec.diversify,
          requestId: request.requestId,
          includeClinicalHistory: request.includeClinicalHistory,
          useOllamaAssist: request.useOllamaAssist,
          ollamaModel: request.ollamaModel,
        }),
      );
    }
  }

  if (writeRandomHistory && historySelections.length) {
    await saveRandomHistory(historySelections, historyPath);
  }

  return expanded;
}

function buildSearchQueries(request) {
  const diagnosisTokens = wordTokens(request.diagnosis);
  const queries = [
    request.searchText,
    collapseWhitespace(
      [request.diagnosis, request.filterQuery].filter(Boolean).join(" "),
    ),
    request.diagnosis,
  ];

  if (diagnosisTokens.length > 2) {
    for (let index = 0; index < diagnosisTokens.length; index += 1) {
      queries.push(
        diagnosisTokens
          .filter((_, tokenIndex) => tokenIndex !== index)
          .join(" "),
      );
    }
  }

  if (diagnosisTokens.length >= 2) {
    queries.push(diagnosisTokens.slice(0, 2).join(" "));
    queries.push(
      `${diagnosisTokens[0]} ${diagnosisTokens[diagnosisTokens.length - 1]}`,
    );
  }

  if (diagnosisTokens.length >= 1) {
    queries.push(diagnosisTokens[0]);
  }

  return dedupe(
    queries.map((query) => collapseWhitespace(query)).filter(Boolean),
  );
}

export async function inspectRadiopaediaCaseCandidates(
  input,
  { limit = 5, fetchSearchText = fetchText } = {},
) {
  const request = parseCaseRequest(input);
  const excludedPaths = new Set(
    (request.excludeCasePaths ?? [])
      .map((value) => comparableCasePath(value))
      .filter(Boolean),
  );
  if (request.selectedCasePath) {
    if (excludedPaths.has(comparableCasePath(request.selectedCasePath))) {
      return {
        ...request,
        candidates: [],
        suggestedCasePath: null,
        suggestedTitle: null,
        needsReview: true,
      };
    }
    const title =
      request.selectedCaseTitle ||
      titleFromCasePath(request.selectedCasePath) ||
      request.diagnosis ||
      "Radiopaedia case";
    return {
      ...request,
      candidates: [
        {
          casePath: request.selectedCasePath,
          caseUrl: absoluteUrl(request.selectedCasePath),
          title,
          snippet: request.originalInput
            ? `Randomly selected from "${request.originalInput}".`
            : "",
          score: 0.99,
          matchedQuery: request.originalInput
            ? "random-selection"
            : "manual-selection",
        },
      ],
      suggestedCasePath: request.selectedCasePath,
      suggestedTitle: title,
      needsReview: false,
    };
  }
  const candidateMap = new Map();
  const searchFailures = [];

  for (const query of buildSearchQueries(request)) {
    const searchSystemAttempts = (request.searchSystems || []).length
      ? [request.searchSystems || [], []]
      : [[]];

    for (const systems of searchSystemAttempts) {
      const searchUrl = buildCaseSearchUrl({ query, systems });
      let searchResult;
      try {
        searchResult = await fetchSearchResultCandidates(
          searchUrl,
          request,
          Math.max(limit * 2, 6),
          fetchSearchText,
        );
      } catch (error) {
        searchFailures.push({
          query,
          systems,
          message: error.message,
        });
        continue;
      }

      const results = searchResult.results;
      if (searchResult.retried) {
        emitWarning(
          "Radiopaedia search returned an empty or invalid page; retried without cache",
          {
            request: request.rawInput,
            query,
            systems,
            results: results.length,
          },
        );
      }

      for (const candidate of results) {
        if (excludedPaths.has(comparableCasePath(candidate.casePath))) {
          continue;
        }
        const existing = candidateMap.get(candidate.casePath);
        if (!existing || candidate.score > existing.score) {
          candidateMap.set(candidate.casePath, {
            ...candidate,
            matchedQuery: query,
          });
        }
      }

      const provisional = [...candidateMap.values()].sort(
        (left, right) => right.score - left.score,
      );
      if (provisional.length >= limit && provisional[0]?.score >= 0.84) {
        break;
      }
    }

    const provisional = [...candidateMap.values()].sort(
      (left, right) => right.score - left.score,
    );
    if (provisional.length >= limit && provisional[0]?.score >= 0.84) {
      break;
    }
  }

  if (!candidateMap.size) {
    for (const candidate of await collectIndexedCaseCandidatePool(
      request,
      limit,
      excludedPaths,
    )) {
      if (!excludedPaths.has(comparableCasePath(candidate.casePath))) {
        candidateMap.set(candidate.casePath, {
          ...candidate,
          score: Math.max(
            0.82,
            candidateScore(request, candidate.title, candidate.snippet),
          ),
          matchedQuery: "case-index",
        });
      }
      if (candidateMap.size >= limit) {
        break;
      }
    }
  }

  if (!candidateMap.size && searchFailures.length) {
    emitWarning("Radiopaedia case search failed for request", {
      request: request.rawInput,
      attempts: searchFailures.length,
      sampleFailures: searchFailures.slice(0, 3),
    });
  }

  const candidates = [...candidateMap.values()]
    .sort(
      (left, right) =>
        right.score - left.score || left.title.localeCompare(right.title),
    )
    .slice(0, limit);
  const best = candidates[0] ?? null;
  const second = candidates[1] ?? null;

  return {
    ...request,
    candidates,
    suggestedCasePath: best?.casePath ?? null,
    suggestedTitle: best?.title ?? null,
    needsReview:
      !best ||
      best.score < 0.78 ||
      Boolean(second && best.score - second.score < 0.05 && best.score < 0.94),
  };
}

export async function searchCasePath(input) {
  const probe = await inspectRadiopaediaCaseCandidates(input, { limit: 5 });
  if (!probe.candidates.length) {
    throw new Error(
      `No Radiopaedia case results found for "${probe.rawInput}".`,
    );
  }
  return probe.candidates[0].casePath;
}
