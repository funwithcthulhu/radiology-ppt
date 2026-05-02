import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  cleanText,
  collapseWhitespace,
  dedupe,
  redactTerms,
  slugify,
  truncate,
} from "./utils.mjs";
import {
  KNOWN_CASE_SYSTEMS,
  canonicalCropMode,
  canonicalMarkupStyle,
  normalizePhrase,
  normalizedDifficulty,
  parseCaseRequest,
  preferredModalitiesFromHint,
  similarityScore,
  stripModalityTerms,
  titleFromCasePath,
  tokenOverlapScore,
} from "./request-parser.mjs";
import {
  APP_ROOT,
  BASE_URL,
  IMAGE_BASE_URL,
  RESOURCE_ROOT,
  absoluteUrl,
  downloadFile,
  fetchJson,
  fetchText,
  fileExists,
} from "./radiopaedia-client.mjs";

const FOCUS_CROP_SCRIPT = path.join(RESOURCE_ROOT, "scripts", "focus_crop.py");
const FOCUS_CROP_EXE = path.join(APP_ROOT, "scripts", "focus_crop.exe");
const execFileAsync = promisify(execFile);
const RANDOM_HISTORY_LIMIT = 240;
const RANDOM_HISTORY_PATH = path.join(APP_ROOT, "cache", "random-selection-history.json");
const RANDOM_SEARCH_QUERY_LIMIT = 5;
const RANDOM_SEARCH_PAGE_LIMIT = 3;
const RANDOM_CANDIDATE_REVIEW_LIMIT = 48;
const RANDOM_SEARCH_TIME_LIMIT_MS = 45000;
let PYTHON_RUNTIME_PROMISE = null;
let OLLAMA_MODELS_PROMISE = null;


async function loadRandomHistory(historyPath = RANDOM_HISTORY_PATH) {
  try {
    const raw = await fs.readFile(historyPath, "utf8");
    const parsed = JSON.parse(raw);
    const values = Array.isArray(parsed) ? parsed : parsed?.casePaths;
    if (!Array.isArray(values)) {
      return [];
    }
    return dedupe(values.map((value) => collapseWhitespace(value)).filter(Boolean)).slice(0, RANDOM_HISTORY_LIMIT);
  } catch {
    return [];
  }
}

export async function saveRandomHistory(casePaths, historyPath = RANDOM_HISTORY_PATH) {
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

async function pythonRuntime() {
  if (!PYTHON_RUNTIME_PROMISE) {
    PYTHON_RUNTIME_PROMISE = (async () => {
      const candidates = [
        process.env.PYTHON ? { command: process.env.PYTHON, prefixArgs: [] } : null,
        { command: "python", prefixArgs: [] },
        { command: "py", prefixArgs: ["-3"] },
      ].filter(Boolean);

      for (const candidate of candidates) {
        try {
          await execFileAsync(candidate.command, [...candidate.prefixArgs, "--version"], {
            timeout: 8000,
          });
          return candidate;
        } catch {
          // try the next runtime
        }
      }

      return null;
    })();
  }

  return PYTHON_RUNTIME_PROMISE;
}

async function listOllamaModels() {
  if (!OLLAMA_MODELS_PROMISE) {
    OLLAMA_MODELS_PROMISE = (async () => {
      try {
        const { stdout } = await execFileAsync("ollama", ["list"], {
          timeout: 8000,
        });
        return stdout
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => line.split(/\s+/)[0])
          .filter((name) => name && name.toLowerCase() !== "name");
      } catch {
        return [];
      }
    })();
  }

  return OLLAMA_MODELS_PROMISE;
}

async function discoverOllamaVisionModel() {
  const models = await listOllamaModels();
  const patterns = [
    /vision/i,
    /llava/i,
    /moondream/i,
    /minicpm/i,
    /qwen.*vl/i,
    /bakllava/i,
  ];

  for (const pattern of patterns) {
    const match = models.find((name) => pattern.test(name));
    if (match) {
      return match;
    }
  }

  return null;
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

function licenseNameFromUrl(url) {
  if (!url) {
    return "Unknown license";
  }
  if (url.includes("by-nc-sa/4.0")) {
    return "CC BY-NC-SA 4.0";
  }
  if (url.includes("by-nc-sa/3.0")) {
    return "CC BY-NC-SA 3.0";
  }
  if (url.includes("by-sa/")) {
    return "CC BY-SA";
  }
  if (url.includes("creativecommons.org")) {
    return "Creative Commons";
  }
  return url;
}

async function applyFocusCrop(imagePath, focusPoints, { cropMode = "default", markupStyle = "none" } = {}) {
  const hasFocusPoints = Array.isArray(focusPoints) && focusPoints.length > 0;
  const normalizedCropMode = canonicalCropMode(cropMode);
  const normalizedMarkupStyle = canonicalMarkupStyle(markupStyle);
  if (!hasFocusPoints) {
    return imagePath;
  }

  const extension = path.extname(imagePath) || ".jpg";
  const variant = [normalizedCropMode, normalizedMarkupStyle]
    .filter((value) => value && value !== "default" && value !== "none")
    .join("-");
  const focusedPath = imagePath.replace(
    new RegExp(`${extension.replace(".", "\\.")}$`),
    `-focus${variant ? `-${variant}` : ""}${extension}`,
  );
  try {
    const args = [
      imagePath,
      focusedPath,
      JSON.stringify(focusPoints),
      JSON.stringify({
        cropMode: normalizedCropMode,
        markupStyle: normalizedMarkupStyle,
      }),
    ];
    if (await fileExists(FOCUS_CROP_EXE)) {
      await execFileAsync(FOCUS_CROP_EXE, args, { timeout: 20000 });
      return focusedPath;
    }

    const runtime = await pythonRuntime();
    if (!runtime) {
      return imagePath;
    }
    await execFileAsync(runtime.command, [...runtime.prefixArgs, FOCUS_CROP_SCRIPT, ...args], {
      timeout: 20000,
    });
    return focusedPath;
  } catch {
    return imagePath;
  }
}

async function scoreImageWithOllama(imagePath, { visionModel, caseTitle, diagnosisQuery }) {
  if (!visionModel) {
    return null;
  }

  try {
    const imageBase64 = (await fs.readFile(imagePath)).toString("base64");
    const response = await fetch("http://127.0.0.1:11434/api/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: visionModel,
        stream: false,
        format: "json",
        prompt:
          `You are scoring a radiology teaching image from a case titled "${caseTitle}". ` +
          `Rate how useful the image is for showing the relevant pathology or anatomy for diagnosis "${diagnosisQuery}". ` +
          'Reply only as JSON with keys "score" (0-10 integer) and "reason" (max 12 words).',
        images: [imageBase64],
      }),
    });
    if (!response.ok) {
      return null;
    }

    const payload = await response.json();
    const text = String(payload?.response ?? "").trim();
    if (!text) {
      return null;
    }

    const parsed = JSON.parse(text);
    const score = Number.parseInt(parsed?.score, 10);
    return {
      score: Number.isInteger(score) ? Math.max(0, Math.min(10, score)) : null,
      reason: truncate(cleanText(parsed?.reason || ""), 80),
    };
  } catch {
    return null;
  }
}

function representativeIndices(length, currentIndex) {
  const candidates = [
    currentIndex,
    Math.floor(length / 2),
    Math.floor(length * 0.25),
    Math.floor(length * 0.75),
    0,
    length - 1,
  ];

  return dedupe(
    candidates.filter((value) => Number.isInteger(value) && value >= 0 && value < length),
  );
}

function candidateScore(request, title, snippet = "") {
  const diagnosisScore = similarityScore(request.diagnosis || request.rawInput, title);
  const snippetScore = snippet ? tokenOverlapScore(request.diagnosis || request.rawInput, snippet) : 0;
  const titleAndSnippet = `${title} ${snippet}`;
  const hintBonus =
    request.studyHint && normalizePhrase(titleAndSnippet).includes(normalizePhrase(request.studyHint)) ? 0.03 : 0;
  const filterBonus =
    request.filterQuery && normalizePhrase(titleAndSnippet).includes(normalizePhrase(request.filterQuery)) ? 0.05 : 0;

  return Math.min(0.99, Math.max(diagnosisScore, snippetScore) + hintBonus + filterBonus);
}

function parseCaseSystemsFromHtml(html) {
  const keywords = cleanText(extractFirst(/<meta\s+name="keywords"\s+content="([^"]+)"/i, html));
  if (!keywords) {
    return [];
  }

  const keywordParts = keywords
    .split(",")
    .map((value) => cleanText(value))
    .filter(Boolean);

  return keywordParts.filter((value) => KNOWN_CASE_SYSTEMS.includes(value));
}

function parseCaseSearchResults(html) {
  const results = [];
  const blocks = [...html.matchAll(/<a class="[^"]*search-result-case[^"]*" href="([^"]+)">([\s\S]*?)<\/a>/g)];

  for (const match of blocks) {
    const casePath = match[1];
    const body = match[2];
    const title =
      cleanText(extractFirst(/<h4[^>]*>([\s\S]*?)<\/h4>/i, body)) || titleFromCasePath(casePath) || "Radiopaedia case";
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

  return dedupe(results.map((candidate) => JSON.stringify(candidate))).map((value) => JSON.parse(value));
}

function parseSearchResultCandidates(html, request, limit = 5) {
  const results = parseCaseSearchResults(html).map((candidate) => ({
    ...candidate,
    score: candidateScore(request, candidate.title, candidate.snippet),
  }));

  return results
    .sort((left, right) => right.score - left.score || left.title.localeCompare(right.title))
    .slice(0, limit);
}

function buildCaseSearchUrl({ query = "", systems = [], page = 1 } = {}) {
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

function extractSearchPageNumbers(html) {
  return dedupe(
    [...html.matchAll(/href="[^"]*page=(\d+)[^"]*scope=cases[^"]*"/g)]
      .map((match) => Number.parseInt(match[1], 10))
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

function buildRandomSearchQueries(request) {
  const randomQuery = request.randomSpec?.queryText || "";
  const studyHint = request.studyHint || "";
  const filterQuery = request.filterQuery || "";
  const strippedHint = stripModalityTerms(studyHint);
  return dedupe([
    collapseWhitespace([randomQuery, filterQuery, studyHint].filter(Boolean).join(" ")),
    collapseWhitespace([randomQuery, filterQuery, strippedHint].filter(Boolean).join(" ")),
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

async function collectRandomCasePool(query, systems) {
  const pageOneHtml = await fetchText(buildCaseSearchUrl({ query, systems, page: 1 }));
  const pageNumbers = extractSearchPageNumbers(pageOneHtml);
  const desiredPageCount = Math.min(pageNumbers.length || 1, RANDOM_SEARCH_PAGE_LIMIT);
  const extraPages = pageNumbers
    .filter((page) => page > 1)
    .slice(0, Math.max(0, desiredPageCount - 1));
  const pagesToFetch = dedupe([1, ...extraPages]);
  const poolMap = new Map();

  for (const page of pagesToFetch) {
    const html =
      page === 1 ? pageOneHtml : await fetchText(buildCaseSearchUrl({ query, systems, page }));

    for (const candidate of parseCaseSearchResults(html)) {
      if (!poolMap.has(candidate.casePath)) {
        poolMap.set(candidate.casePath, candidate);
      }
    }
  }

  return [...poolMap.values()];
}

async function candidateSystemList(candidate, htmlCache = new Map()) {
  let html = htmlCache.get(candidate.casePath);
  if (!html) {
    const caseUrl = absoluteUrl(candidate.casePath.includes("?") ? candidate.casePath : `${candidate.casePath}?lang=us`);
    html = await fetchText(caseUrl);
    htmlCache.set(candidate.casePath, html);
  }
  return parseCaseSystemsFromHtml(html);
}

async function candidateMatchesSystems(candidate, systems, htmlCache = new Map(), systemMode = "all") {
  if (!systems.length) {
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

      const caseSystems = await candidateSystemList(candidate, htmlCache);
      const hasNovelSystem = caseSystems.some((system) => !usedSystems.has(system));
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

async function pickRandomCaseCandidates(request, { excludePaths = new Set(), allowReuseIfNeeded = true } = {}) {
  const systems = request.randomSpec?.systems || [];
  const systemMode = request.randomSpec?.systemMode || "all";
  const candidateMap = new Map();
  const htmlCache = new Map();
  const targetPoolSize = Math.max(request.randomSpec.count + 14, 24);
  const startedAt = Date.now();
  let reviewedCandidates = 0;

  for (const query of buildRandomSearchQueries(request).slice(0, RANDOM_SEARCH_QUERY_LIMIT)) {
    if (Date.now() - startedAt > RANDOM_SEARCH_TIME_LIMIT_MS) {
      break;
    }
    const pool = await collectRandomCasePool(query, systems);
    for (const candidate of shuffle(pool)) {
      if (Date.now() - startedAt > RANDOM_SEARCH_TIME_LIMIT_MS || reviewedCandidates >= RANDOM_CANDIDATE_REVIEW_LIMIT) {
        break;
      }
      reviewedCandidates += 1;
      if (excludePaths.has(candidate.casePath) || candidateMap.has(candidate.casePath)) {
        continue;
      }
      if (!(await candidateMatchesSystems(candidate, systems, htmlCache, systemMode))) {
        continue;
      }
      candidateMap.set(candidate.casePath, candidate);
      if (candidateMap.size >= targetPoolSize) {
        break;
      }
    }

    if (candidateMap.size >= targetPoolSize) {
      break;
    }
  }

  const shuffledCandidates = shuffle([...candidateMap.values()]);
  const picks =
    request.randomSpec?.diversify === "mixed"
      ? await pickMixedCandidates(shuffledCandidates, request.randomSpec.count, htmlCache)
      : shuffledCandidates.slice(0, request.randomSpec.count);
  if (picks.length < request.randomSpec.count && excludePaths.size > 0 && allowReuseIfNeeded) {
    return pickRandomCaseCandidates(request, {
      excludePaths: new Set(),
      allowReuseIfNeeded: false,
    });
  }
  if (!picks.length) {
    const filterBits = dedupe([...(request.randomSpec.systems || []), request.randomSpec.queryText, request.studyHint]).filter(Boolean);
    const filterText = filterBits.length ? ` (${filterBits.join(" | ")})` : "";
    const stoppedText =
      Date.now() - startedAt > RANDOM_SEARCH_TIME_LIMIT_MS || reviewedCandidates >= RANDOM_CANDIDATE_REVIEW_LIMIT
        ? " within the search limits"
        : "";
    throw new Error(`No suitable random Radiopaedia cases were found for "${request.rawInput}"${filterText}${stoppedText}. Try broader filters or fewer constraints.`);
  }

  const fallbackCandidates = shuffledCandidates.slice(request.randomSpec.count).map((candidate) => ({
    casePath: candidate.casePath,
    title: candidate.title,
  }));

  return picks.map((candidate) => ({
    ...candidate,
    fallbackCandidates,
  }));
}

export async function expandCaseRequests(
  inputs,
  { readRandomHistory = false, writeRandomHistory = false, historyPath = RANDOM_HISTORY_PATH } = {},
) {
  const expanded = [];
  const selectedPaths = new Set(readRandomHistory ? await loadRandomHistory(historyPath) : []);
  const historySelections = [];

  for (const item of inputs) {
    const request = parseCaseRequest(item);
    const requestExcludedPaths = new Set((request.excludeCasePaths ?? []).map((value) => collapseWhitespace(value)).filter(Boolean));
    if (request.selectedCasePath) {
      if (requestExcludedPaths.has(request.selectedCasePath)) {
        continue;
      }
      if (shouldRememberRandomEntry(request)) {
        historySelections.push(request.selectedCasePath);
      }
      selectedPaths.add(request.selectedCasePath);
      expanded.push(request);
      continue;
    }

    if (!request.randomSpec) {
      expanded.push(request);
      continue;
    }

    const picks = await pickRandomCaseCandidates(request, {
      excludePaths: new Set([...selectedPaths, ...requestExcludedPaths]),
    });
    for (const pick of picks) {
      selectedPaths.add(pick.casePath);
      historySelections.push(pick.casePath);
      expanded.push(
        parseCaseRequest({
          rawInput: collapseWhitespace([pick.title, request.studyHint].filter(Boolean).join(", ")),
          diagnosis: pick.title,
          studyHint: request.studyHint,
          secondaryModality: request.secondaryModality,
          ageGroup: request.ageGroup,
          topicFocus: request.topicFocus,
          difficulty: request.difficulty,
          cropMode: request.cropMode,
          markupStyle: request.markupStyle,
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
    collapseWhitespace([request.diagnosis, request.filterQuery].filter(Boolean).join(" ")),
    request.diagnosis,
  ];

  if (diagnosisTokens.length > 2) {
    for (let index = 0; index < diagnosisTokens.length; index += 1) {
      queries.push(diagnosisTokens.filter((_, tokenIndex) => tokenIndex !== index).join(" "));
    }
  }

  if (diagnosisTokens.length >= 2) {
    queries.push(diagnosisTokens.slice(0, 2).join(" "));
    queries.push(`${diagnosisTokens[0]} ${diagnosisTokens[diagnosisTokens.length - 1]}`);
  }

  if (diagnosisTokens.length >= 1) {
    queries.push(diagnosisTokens[0]);
  }

  return dedupe(queries.map((query) => collapseWhitespace(query)).filter(Boolean));
}

export async function inspectRadiopaediaCaseCandidates(input, { limit = 5 } = {}) {
  const request = parseCaseRequest(input);
  const excludedPaths = new Set((request.excludeCasePaths ?? []).map((value) => collapseWhitespace(value)).filter(Boolean));
  if (request.selectedCasePath) {
    if (excludedPaths.has(request.selectedCasePath)) {
      return {
        ...request,
        candidates: [],
        suggestedCasePath: null,
        suggestedTitle: null,
        needsReview: true,
      };
    }
    const title = request.selectedCaseTitle || titleFromCasePath(request.selectedCasePath) || request.diagnosis || "Radiopaedia case";
    return {
      ...request,
      candidates: [
        {
          casePath: request.selectedCasePath,
          caseUrl: absoluteUrl(request.selectedCasePath),
          title,
          snippet: request.originalInput ? `Randomly selected from "${request.originalInput}".` : "",
          score: 0.99,
          matchedQuery: request.originalInput ? "random-selection" : "manual-selection",
        },
      ],
      suggestedCasePath: request.selectedCasePath,
      suggestedTitle: title,
      needsReview: false,
    };
  }
  const candidateMap = new Map();

  for (const query of buildSearchQueries(request)) {
    const searchUrl = buildCaseSearchUrl({ query, systems: request.searchSystems || [] });
    const html = await fetchText(searchUrl);
    const results = parseSearchResultCandidates(html, request, Math.max(limit * 2, 6));

    for (const candidate of results) {
      if (excludedPaths.has(candidate.casePath)) {
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

    const provisional = [...candidateMap.values()].sort((left, right) => right.score - left.score);
    if (provisional.length >= limit && provisional[0]?.score >= 0.84) {
      break;
    }
  }

  const candidates = [...candidateMap.values()]
    .sort((left, right) => right.score - left.score || left.title.localeCompare(right.title))
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

async function searchCasePath(input) {
  const probe = await inspectRadiopaediaCaseCandidates(input, { limit: 5 });
  if (!probe.candidates.length) {
    throw new Error(`No Radiopaedia case results found for "${probe.rawInput}".`);
  }
  return probe.candidates[0].casePath;
}

async function fetchStudy(studyId, caseUrl) {
  const studyUrl = `${BASE_URL}/studies/${studyId}/annotated_viewer_json?lang=us&only_findings=true`;
  const payload = await fetchJson(studyUrl, {
    referer: caseUrl,
  });

  return payload.study;
}

function buildImageCandidates(study) {
  const candidates = [];
  const studyHasAnnotations = (study.series ?? []).some((series) => {
    const frames = series.frames ?? [];
    return extractSeriesAnnotationIndices(series, frames.length).length > 0;
  });

  for (const series of study.series ?? []) {
    const files = series.encodings?.thumbnailed_files ?? [];
    const frames = series.frames ?? [];
    const usableLength = Math.min(files.length, frames.length);

    if (!usableLength) {
      continue;
    }

    const currentIndex = Math.max(0, frames.findIndex((frame) => frame.current));
    const keyImageIndex = frames.findIndex((frame) => frame.id === study.case_key_image_id);
    const annotationIndices = extractSeriesAnnotationIndices(series, usableLength);
    const candidateIndices = buildRelevantFrameIndices({
      usableLength,
      currentIndex,
      keyImageIndex,
      annotationIndices,
      studyHasAnnotations,
    });

    for (const index of candidateIndices) {
      const frame = frames[index];
      const file = files[index];
      const fileName = file?.original ?? file?.small ?? file?.thumb;

      if (!frame?.id || !fileName) {
        continue;
      }

      const annotationDistance = nearestDistance(index, annotationIndices);
      const isAnnotated = annotationIndices.includes(index);
      const isKeyImage = Number.isInteger(keyImageIndex) && index === keyImageIndex;
      const isCurrent = index === currentIndex;
      const focusPoints = extractFrameFocusPoints(series, index);
      candidates.push({
        url: `${IMAGE_BASE_URL}/${frame.id}/${fileName}`,
        label: [study.modality, series.specifics, series.perspective].filter(Boolean).join(" • "),
        studyId: study.id,
        seriesId: series.series_id,
        modality: study.modality,
        frameId: frame.id,
        sliceIndex: index,
        viewSignature: [series.specifics, series.perspective].filter(Boolean).join(" • "),
        annotationDistance,
        hasSeriesAnnotations: annotationIndices.length > 0,
        isAnnotated,
        isKeyImage,
        isCurrent,
        focusPoints,
        frameWidth: frame.width,
        frameHeight: frame.height,
        relevantScore: computeFrameRelevanceScore({
          index,
          currentIndex,
          keyImageIndex,
          annotationIndices,
          annotationDistance,
          studyHasAnnotations,
        }),
      });
    }
  }

  return dedupe(candidates.map((candidate) => JSON.stringify(candidate))).map((value) => JSON.parse(value));
}

function extractFrameFocusPoints(series, frameIndex) {
  const points = [];

  for (const annotation of series.annotations ?? []) {
    const arrowPoints = (annotation.arrow_positions ?? [])
      .filter((position) => position?.slice_idx === frameIndex)
      .map((position) => ({ x: position.x, y: position.y, kind: "arrow" }));
    const labelPoints = (annotation.label_positions ?? [])
      .filter((position) => position?.slice_idx === frameIndex)
      .map((position) => ({ x: position.x, y: position.y, kind: "label" }));

    if (arrowPoints.length) {
      points.push(...arrowPoints);
    } else {
      points.push(...labelPoints);
    }
  }

  return points.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
}

function extractSeriesAnnotationIndices(series, usableLength) {
  return dedupe(
    (series.annotations ?? [])
      .flatMap((annotation) => [
        ...(annotation.label_positions ?? []).map((position) => position?.slice_idx),
        ...(annotation.arrow_positions ?? []).map((position) => position?.slice_idx),
      ])
      .filter((value) => Number.isInteger(value) && value >= 0 && value < usableLength),
  ).sort((left, right) => left - right);
}

function nearestDistance(index, targets) {
  if (!targets.length) {
    return null;
  }
  return Math.min(...targets.map((target) => Math.abs(target - index)));
}

function buildRelevantFrameIndices({ usableLength, currentIndex, keyImageIndex, annotationIndices, studyHasAnnotations }) {
  const indices = [];

  if (annotationIndices.length) {
    indices.push(...annotationIndices);
    if (Number.isInteger(keyImageIndex) && keyImageIndex >= 0 && annotationIndices.includes(keyImageIndex)) {
      indices.push(keyImageIndex);
    }
    if (Number.isInteger(currentIndex) && currentIndex >= 0 && annotationIndices.includes(currentIndex)) {
      indices.push(currentIndex);
    }
  } else if (!studyHasAnnotations) {
    indices.push(
      currentIndex - 1,
      currentIndex,
      currentIndex + 1,
    );
    if (Number.isInteger(keyImageIndex) && keyImageIndex >= 0) {
      indices.unshift(keyImageIndex);
    }
  } else {
    if (Number.isInteger(keyImageIndex) && keyImageIndex >= 0) {
      indices.push(keyImageIndex);
    }
    if (Number.isInteger(currentIndex) && currentIndex >= 0) {
      indices.push(currentIndex);
    }
  }

  return dedupe(
    indices.filter((value) => Number.isInteger(value) && value >= 0 && value < usableLength),
  );
}

function computeFrameRelevanceScore({ index, currentIndex, keyImageIndex, annotationIndices, annotationDistance, studyHasAnnotations }) {
  let score = 0;

  if (annotationIndices.includes(index)) {
    score += 420;
  }

  if (Number.isInteger(keyImageIndex) && index === keyImageIndex) {
    score += 160;
  } else if (annotationDistance !== null) {
    score += Math.max(0, 70 - annotationDistance * 30);
  } else if (!studyHasAnnotations) {
    score += Math.max(0, 58 - Math.abs(index - currentIndex) * 18);
  } else if (index === currentIndex) {
    score += 8;
  } else {
    score -= 30;
  }

  return score;
}

function pickDistinctImages(imageCandidates, desiredCount) {
  const sorted = [...imageCandidates].sort(
    (left, right) =>
      right.relevantScore - left.relevantScore ||
      left.seriesId - right.seriesId ||
      left.sliceIndex - right.sliceIndex,
  );

  const selected = [];
  const usedFrames = new Set();
  const usedSeries = new Set();
  const usedViews = new Set();

  const pick = (predicate) => {
    for (const candidate of sorted) {
      if (selected.length >= desiredCount) {
        return;
      }
      if (usedFrames.has(candidate.frameId) || !predicate(candidate)) {
        continue;
      }

      selected.push(candidate);
      usedFrames.add(candidate.frameId);
      usedSeries.add(candidate.seriesId);
      usedViews.add(candidate.viewSignature);
    }
  };

  pick((candidate) => candidate.relevantScore >= 150 && !usedSeries.has(candidate.seriesId));
  pick((candidate) => candidate.relevantScore >= 150 && !usedViews.has(candidate.viewSignature));
  pick((candidate) => candidate.relevantScore >= 150);
  pick((candidate) => !usedSeries.has(candidate.seriesId));
  pick((candidate) => !usedViews.has(candidate.viewSignature));
  pick(() => true);

  return selected.slice(0, desiredCount);
}

function selectRelevantImages(imageCandidates, desiredCount, { excludeFrameIds = [] } = {}) {
  const excluded = new Set((excludeFrameIds ?? []).map((value) => String(value)));
  const candidatePool = excluded.size
    ? imageCandidates.filter((candidate) => !excluded.has(String(candidate.frameId)))
    : imageCandidates;
  const effectivePool = candidatePool;
  if (!effectivePool.length) {
    return [];
  }

  const annotatedCandidates = effectivePool.filter((candidate) => candidate.isAnnotated);
  if (annotatedCandidates.length) {
    return pickDistinctImages(annotatedCandidates, Math.min(desiredCount, annotatedCandidates.length));
  }

  const strongCandidates = effectivePool.filter(
    (candidate) => candidate.isKeyImage || candidate.isCurrent || candidate.relevantScore >= 40,
  );
  const selected = pickDistinctImages(strongCandidates.length ? strongCandidates : effectivePool, desiredCount);

  while (
    selected.length > 1 &&
    !selected[selected.length - 1].isAnnotated &&
    !selected[selected.length - 1].isKeyImage &&
    selected[selected.length - 1].relevantScore < 40
  ) {
    selected.pop();
  }

  return selected.slice(0, desiredCount);
}

function imageStrengthScore(image) {
  const ollamaBonus = Number.isFinite(image.ollamaScore) ? image.ollamaScore * 8 : 0;
  return image.relevantScore + ollamaBonus + (image.isAnnotated ? 120 : 0) + (image.isKeyImage ? 40 : 0);
}

function evaluateSelectedImages(images, requestedCount, difficulty = "") {
  const strongImages = images.filter((image) => image.isAnnotated || image.isKeyImage || imageStrengthScore(image) >= 180);
  const adequateImages = images.filter((image) => image.isAnnotated || image.isKeyImage || imageStrengthScore(image) >= 120);
  const warnings = [];
  const difficultyMode = normalizedDifficulty(difficulty);

  if (images.length < Math.min(requestedCount, 2)) {
    warnings.push(`Only ${images.length} clearly relevant image${images.length === 1 ? "" : "s"} found.`);
  }
  if (!adequateImages.length) {
    warnings.push("Selected images do not convincingly show the relevant pathology.");
  } else if (difficultyMode !== "hard" && requestedCount >= 3 && strongImages.length < 2) {
    warnings.push("The image set is still weak for a 3-image teaching slide.");
  }
  if (difficultyMode === "easy" && strongImages.length < Math.min(requestedCount, 2)) {
    warnings.push("Easy mode prefers cases with at least two very conspicuous teaching images.");
  }

  return {
    requestedCount,
    selectedCount: images.length,
    strongCount: strongImages.length,
    adequateCount: adequateImages.length,
    overallScore:
      images.reduce((sum, image) => sum + imageStrengthScore(image), 0) +
      strongImages.length * 120 +
      adequateImages.length * 40,
    shouldReroll: warnings.length > 0,
    warnings,
    summary: warnings.length
      ? warnings.join(" ")
      : `${images.length} relevant image${images.length === 1 ? "" : "s"} selected.`,
  };
}

async function maybeScoreSelectedImagesWithOllama(images, request, caseTitle) {
  if (!request.useOllamaAssist) {
    return images;
  }

  const visionModel = collapseWhitespace(request.ollamaModel || "") || (await discoverOllamaVisionModel());
  if (!visionModel) {
    return images;
  }

  for (const image of images) {
    const review = await scoreImageWithOllama(image.localPath, {
      visionModel,
      caseTitle,
      diagnosisQuery: request.diagnosis || request.rawInput,
    });
    if (!review || !Number.isFinite(review.score)) {
      continue;
    }
    image.ollamaScore = review.score;
    image.ollamaReason = review.reason || "";
  }

  return images.sort(
    (left, right) =>
      (Number.isFinite(right.ollamaScore) ? right.ollamaScore : -1) -
      (Number.isFinite(left.ollamaScore) ? left.ollamaScore : -1) ||
      right.relevantScore - left.relevantScore,
  );
}

function extractPatientData(html) {
  const text = cleanText(html);
  const patientSection = extractFirst(
    /\bPatient Data\b(.*?)(?:\bFrom the case:|\bCase Discussion\b|\bDiscussion\b|\bFindings\b|\bImaging\b|$)/i,
    text,
  ) || "";
  const source = patientSection || text;
  const age = cleanText(extractFirst(/\bAge:\s*(.*?)(?=\s+(?:Gender|Sex):|$)/i, source));
  const gender = cleanText(extractFirst(/\b(?:Gender|Sex):\s*(.*?)(?=\s+(?:From the case:|Case Discussion|Discussion|Findings|Imaging|CT|MRI|X-ray|Ultrasound|Fluoroscopy|PET|$))/i, source));
  return {
    age: scrubPatientDataValue(age),
    gender: scrubPatientDataValue(gender),
  };
}

function scrubPatientDataValue(value) {
  return collapseWhitespace(value)
    .replace(/\b(?:Presentation|From the case:|Case Discussion|Discussion|Findings|Imaging)\b.*$/i, "")
    .replace(/[.;:,]+$/g, "")
    .trim();
}

function formatPatientAgeForIntro(age) {
  const text = scrubPatientDataValue(age);
  if (!text) {
    return "";
  }

  const numericOnly = /^(\d+(?:\.\d+)?)$/.exec(text);
  if (numericOnly) {
    return `${numericOnly[1]}-year-old`;
  }

  const unitMatch = /^(\d+(?:\.\d+)?)\s*(years?|yrs?|y|months?|mos?|m|weeks?|wks?|w|days?|d)(?:\s*old)?$/i.exec(text);
  if (unitMatch) {
    const unitMap = {
      y: "year",
      yr: "year",
      yrs: "year",
      year: "year",
      years: "year",
      m: "month",
      mo: "month",
      mos: "month",
      month: "month",
      months: "month",
      w: "week",
      wk: "week",
      wks: "week",
      week: "week",
      weeks: "week",
      d: "day",
      day: "day",
      days: "day",
    };
    const unit = unitMap[unitMatch[2].toLowerCase()] || unitMatch[2].toLowerCase();
    return `${unitMatch[1]}-${unit}-old`;
  }

  if (/^(adult|pediatric|paediatric|neonatal|infant|child|adolescent|elderly)$/i.test(text)) {
    return text.toLowerCase().replace("paediatric", "pediatric");
  }

  return text;
}

function formatPatientGenderForIntro(gender) {
  const text = scrubPatientDataValue(gender).toLowerCase();
  if (!text) {
    return "";
  }
  if (/^m(?:ale)?$/.test(text)) {
    return "male";
  }
  if (/^f(?:emale)?$/.test(text)) {
    return "female";
  }
  return text;
}

function articleForPhrase(phrase) {
  return /^(?:8|11|18|adult|elderly|infant|adolescent|[aeiou])/i.test(phrase) ? "an" : "a";
}

function buildDemographicIntro(patientData) {
  const age = formatPatientAgeForIntro(patientData?.age);
  const gender = formatPatientGenderForIntro(patientData?.gender);

  if (age && gender) {
    return `The patient is ${articleForPhrase(age)} ${age} ${gender}.`;
  }
  if (age) {
    return `The patient is ${articleForPhrase(age)} ${age} patient.`;
  }
  if (gender) {
    return `The patient is ${gender}.`;
  }
  return "";
}

function buildClinicalHistoryText({ request, patientData }) {
  if (!request.includeClinicalHistory) {
    return "";
  }
  if (normalizedDifficulty(request.difficulty) === "hard") {
    return "";
  }

  return buildDemographicIntro(patientData);
}

function cleanRedactedTeachingText(text) {
  return cleanText(text)
    .replace(/\[[^\]]*hidden[^\]]*\]/gi, " ")
    .replace(/\bcase of\s+(?:acute|chronic|typical|classic)\s+(?=with\b|without\b|in\b|on\b|for\b|$)/gi, "case ")
    .replace(/\bcase of\s+(?=with\b|without\b|in\b|on\b|for\b|$)/gi, "case ")
    .replace(/\btypical\s+(?=with\b|without\b|in\b|on\b|for\b|$)/gi, "typical presentation ")
    .replace(/\bconsistent\s+(?=with\b|without\b|in\b|on\b|for\b|$)/gi, "consistent appearance ")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/^[,.;:\-\s]+/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function buildTeachingPoints({ request, description, findings, diagnosis, caseTitle, modalitySummary, images }) {
  const bullets = [];
  const seen = new Set();

  const candidateSentences = [findings, description]
    .filter(Boolean)
    .flatMap((text) => cleanText(text).split(/(?<=[.!?])\s+/));

  for (const sentence of candidateSentences) {
    const bullet = truncate(
      cleanRedactedTeachingText(redactTerms(sentence, [diagnosis, caseTitle])),
      135,
    );
    const key = normalizePhrase(bullet);
    if (!bullet || bullet.length < 18 || seen.has(key)) {
      continue;
    }
    seen.add(key);
    bullets.push(bullet);
    if (bullets.length >= 3) {
      break;
    }
  }

  if (bullets.length < 2 && request.studyHint) {
    const studyBullet = `Focus on the ${request.studyHint} images where the abnormality is most conspicuous.`;
    const key = normalizePhrase(studyBullet);
    if (!seen.has(key)) {
      seen.add(key);
      bullets.push(studyBullet);
    }
  }

  if (bullets.length < 3 && modalitySummary) {
    const modalityBullet = `This case is best reviewed as a ${modalitySummary} teaching example with ${images.length} selected image${images.length === 1 ? "" : "s"}.`;
    const key = normalizePhrase(modalityBullet);
    if (!seen.has(key)) {
      seen.add(key);
      bullets.push(modalityBullet);
    }
  }

  return bullets.slice(0, 3);
}

function buildPromptText(rawText, diagnosis, caseTitle) {
  const cleaned = cleanText(rawText);
  if (!cleaned) {
    return "Review the images on the next slide and identify the most likely diagnosis.";
  }

  const redacted = redactTerms(cleaned, [diagnosis, caseTitle]);
  if (!redacted || redacted === cleaned || redacted.length < 50) {
    return "Review the images on the next slide and identify the most likely diagnosis.";
  }

  return truncate(redacted, 430);
}

function createFooterText(caseData) {
  const parts = [
    "Radiopaedia",
    caseData.rid,
    caseData.author,
    caseData.licenseName,
    caseData.displayUrl,
  ].filter(Boolean);

  return parts.join(" • ");
}

function orderStudiesByPreference(studies, preferredModalities) {
  if (!preferredModalities.length) {
    return studies;
  }

  const matching = studies.filter((study) => preferredModalities.includes(study.modality));
  const other = studies.filter((study) => !preferredModalities.includes(study.modality));
  return matching.length ? matching.concat(other) : studies;
}

function validateCasePage({ request, caseTitle, rid, studyIds, description }) {
  const hasRealRid = /^rID-\d+$/i.test(rid);
  const hasStudies = studyIds.length > 0;
  if (hasRealRid && hasStudies) {
    return;
  }

  const requested = request.selectedCasePath || request.rawInput;
  throw new Error(
    `Could not validate "${requested}" as a real public Radiopaedia case with image studies. Check the URL, or pick the case again from search results.`,
  );
}

async function fetchRadiopaediaCaseByPath(request, casePath, { cacheDir, imagesPerCase = 3, caseTitleHint = "" }) {
  const caseUrl = absoluteUrl(casePath.includes("?") ? casePath : `${casePath}?lang=us`);
  const html = await fetchText(caseUrl);
  const displayUrl = (() => {
    const parsed = new URL(caseUrl);
    return `${parsed.host}${parsed.pathname}`;
  })();

  const caseTitle =
    cleanText(extractFirst(/<title>(.*?)\s+\|\s+Radiology Case\s+\|\s+Radiopaedia\.org<\/title>/i, html)) ||
    cleanText(caseTitleHint) ||
    request.diagnosis;
  const author = cleanText(extractFirst(/<meta\s+name="author"\s+content="([^"]+)"/i, html));
  const licenseUrl = extractFirst(/<link\s+rel="license"[^>]+href="([^"]+)"/i, html);
  const licenseName = licenseNameFromUrl(licenseUrl);
  const description = cleanText(
    extractFirst(/<meta\s+property="og:description"\s+content="([^"]+)"/i, html),
  );
  const patientData = extractPatientData(html);
  const ridMatch = extractFirst(/<meta\s+name='dc\.identifier'\s+content='[^']*(rID-\d+)'/i, html);
  const rid = ridMatch || "rID unavailable";
  const studyIds = dedupe([...html.matchAll(/\/studies\/(\d+)/g)].map((match) => match[1]));
  const caseSlug = slugify(caseTitle) || slugify(request.rawInput) || "radiopaedia-case";

  validateCasePage({ request, caseTitle, rid, studyIds, description });

  const studies = [];
  for (const studyId of studyIds.slice(0, 8)) {
    try {
      studies.push(await fetchStudy(studyId, caseUrl));
    } catch (error) {
      console.warn(`Warning: unable to load study ${studyId} for ${caseTitle}: ${error.message}`);
    }
  }

  const orderedStudies = orderStudiesByPreference(studies, request.preferredModalities);
  const preferredStudies = request.preferredModalities.length
    ? orderedStudies.filter((study) => request.preferredModalities.includes(study.modality))
    : orderedStudies;
  if (request.preferredModalities.length && !preferredStudies.length) {
    throw new Error(`No ${request.preferredModalities.join("/")} studies were found for "${caseTitle}".`);
  }

  const imageCandidates = [];
  for (const study of preferredStudies) {
    imageCandidates.push(...buildImageCandidates(study));
  }

  const fallbackOgImage = extractFirst(/<meta\s+property="og:image"\s+content="([^"]+)"/i, html);
  if (!imageCandidates.length && fallbackOgImage) {
    imageCandidates.push({
      url: fallbackOgImage,
      label: "Key image",
      studyId: null,
      seriesId: null,
      modality: orderedStudies[0]?.modality ?? null,
    });
  }

  if (!imageCandidates.length) {
    throw new Error(`No usable images were found for "${caseTitle}".`);
  }

  const selectedImages = selectRelevantImages(imageCandidates, Math.max(1, imagesPerCase), {
    excludeFrameIds: request.excludeFrameIds || [],
  });
  const imageDir = path.join(cacheDir, "images", caseSlug);
  const images = [];
  const variantTag = [canonicalCropMode(request.cropMode || ""), canonicalMarkupStyle(request.markupStyle || "")]
    .filter((value) => value && value !== "default" && value !== "none")
    .join("-");

  for (let index = 0; index < selectedImages.length; index += 1) {
    const image = selectedImages[index];
    const parsedUrl = new URL(image.url);
    const extension = path.extname(parsedUrl.pathname) || ".jpg";
    const localPath = path.join(
      imageDir,
      `${String(index + 1).padStart(2, "0")}-${image.frameId}${variantTag ? `-${variantTag}` : ""}${extension}`,
    );

    await downloadFile(image.url, localPath);
    const focusedPath = await applyFocusCrop(localPath, image.focusPoints, {
      cropMode: request.cropMode,
      markupStyle: request.markupStyle,
    });
    images.push({
      ...image,
      localPath: focusedPath,
    });
  }

  await maybeScoreSelectedImagesWithOllama(images, request, caseTitle);
  const quality = evaluateSelectedImages(images, Math.max(1, imagesPerCase), request.difficulty);

  const findings = orderedStudies.map((study) => study.findings).find(Boolean) || "";
  const revealSummary = truncate(cleanText(findings || description), 440);
  const effectiveDiagnosis = request.originalInput ? caseTitle : request.diagnosis;
  const effectiveRawInput = request.originalInput
    ? collapseWhitespace([caseTitle, request.studyHint].filter(Boolean).join(", "))
    : request.rawInput;
  const promptText = buildPromptText(findings || description, effectiveDiagnosis, caseTitle);
  const modalitySummary = dedupe(orderedStudies.map((study) => study.modality).filter(Boolean)).join(", ") || "Unknown";
  const caseIntro = buildClinicalHistoryText({
    request,
    patientData,
  });
  const teachingPoints = buildTeachingPoints({
    request,
    description,
    findings,
    diagnosis: effectiveDiagnosis,
    caseTitle,
    modalitySummary,
    images,
  });

  return {
    casePath: casePath.includes("?") ? casePath : `${casePath}?lang=us`,
    rawInput: effectiveRawInput,
    originalInput: request.originalInput || null,
    requestId: request.requestId || null,
    diagnosisQuery: effectiveDiagnosis,
    studyHint: request.studyHint,
    caseTitle,
    caseUrl,
    author,
    licenseUrl,
    licenseName,
    rid,
    description,
    promptText,
    revealSummary: revealSummary || "Diagnosis sourced from the linked Radiopaedia case.",
    footerText: createFooterText({
      author,
      displayUrl,
      licenseName,
      rid,
    }),
    displayUrl,
    modalitySummary,
    studyCount: orderedStudies.length,
    patientData,
    caseIntro,
    teachingPoints,
    quality,
    images,
  };
}

export async function fetchRadiopaediaCase(input, { cacheDir, imagesPerCase = 3 }) {
  const request = parseCaseRequest(input);
  const fallbackCandidates = Array.isArray(request.fallbackCandidates) ? request.fallbackCandidates : [];
  const excludedPaths = new Set((request.excludeCasePaths ?? []).map((value) => collapseWhitespace(value)).filter(Boolean));
  const candidateQueue = [];

  if (request.selectedCasePath && !excludedPaths.has(request.selectedCasePath)) {
    candidateQueue.push(request.selectedCasePath);
  }

  for (const candidate of fallbackCandidates) {
    if (candidate?.casePath && !excludedPaths.has(candidate.casePath)) {
      candidateQueue.push(candidate.casePath);
    }
  }

  if (!candidateQueue.length || !request.selectedCasePath) {
    const probe = await inspectRadiopaediaCaseCandidates(request, { limit: 6 });
    for (const candidate of probe.candidates) {
      if (!excludedPaths.has(candidate.casePath)) {
        candidateQueue.push(candidate.casePath);
      }
    }
  }

  const dedupedQueue = dedupe(candidateQueue);
  if (!dedupedQueue.length) {
    throw new Error(`No Radiopaedia case results found for "${request.rawInput}".`);
  }

  let lastError = null;
  let bestCase = null;
  const attemptErrors = [];
  for (const candidatePath of dedupedQueue) {
    const caseTitleHint =
      candidatePath === request.selectedCasePath
        ? request.selectedCaseTitle || request.diagnosis
        : fallbackCandidates.find((candidate) => candidate.casePath === candidatePath)?.title || "";

    try {
      const caseData = await fetchRadiopaediaCaseByPath(request, candidatePath, {
        cacheDir,
        imagesPerCase,
        caseTitleHint,
      });
      if (!bestCase || caseData.quality.overallScore > bestCase.quality.overallScore) {
        bestCase = caseData;
      }
      if (!caseData.quality.shouldReroll) {
        return caseData;
      }
    } catch (error) {
      lastError = error;
      attemptErrors.push({
        casePath: candidatePath,
        message: error.message,
      });
    }
  }

  if (bestCase) {
    return bestCase;
  }

  if (attemptErrors.length) {
    const reasons = dedupe(attemptErrors.map((attempt) => attempt.message).filter(Boolean)).slice(0, 3);
    const reasonText = reasons.length ? ` ${reasons.join(" ")}` : "";
    throw new Error(
      `No suitable Radiopaedia case could be prepared for "${request.rawInput}" after trying ${attemptErrors.length} candidate${attemptErrors.length === 1 ? "" : "s"}.${reasonText}`,
    );
  }

  throw lastError || new Error(`No Radiopaedia case results found for "${request.rawInput}".`);
}
