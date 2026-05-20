import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildCoreReviewCasePlan,
  buildCoreReviewQuestionBankFromCorpus,
  buildCoreReviewQuizSession,
  coreReviewSchemaSummary,
  ingestCoreReviewSources,
  loadCoreReviewCorpus,
  loadCoreReviewQuestionBank,
  mergeCoreReviewCorpora,
  renderCoreReviewQuizText,
} from "./core_review/index.mjs";
import { ingestCoreReviewPdfs } from "./core_review/pdf-ingest.mjs";
import {
  emitProgress,
  emitWarning,
  withBackendStage,
} from "./backend-events.mjs";
import { recordCaseIndex } from "./app-store.mjs";
import { scorePreparedItemsWithOllama } from "./ollama-review.mjs";
import {
  expandCaseRequests,
  fetchRadiopaediaCase,
  saveRandomHistory,
} from "./radiopaedia.mjs";
import { parseCaseRequest, parseCaseRequestList } from "./request-parser.mjs";
import {
  collapseWhitespace,
  dedupe,
  formatTimestamp,
  slugify,
} from "./utils.mjs";
import { radiopaediaProvider } from "./providers/radiopaedia-provider.mjs";

const RESOURCE_ROOT =
  process.env.RADIOLOGY_PPT_RESOURCE_ROOT ||
  path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const APP_ROOT = process.env.RADIOLOGY_PPT_APP_ROOT || RESOURCE_ROOT;
const RANDOM_PREPARE_FALLBACK_ATTEMPTS = boundedInteger(
  process.env.RADIOLOGY_PPT_RANDOM_PREPARE_FALLBACK_ATTEMPTS,
  8,
  0,
  40,
);
const RANDOM_PREPARE_REPLACEMENT_ATTEMPTS = boundedInteger(
  process.env.RADIOLOGY_PPT_RANDOM_PREPARE_REPLACEMENT_ATTEMPTS,
  8,
  0,
  40,
);
const CORE_REVIEW_PREPARE_BATCH_SIZE = boundedInteger(
  process.env.RADIOLOGY_PPT_CORE_REVIEW_PREPARE_BATCH_SIZE,
  6,
  1,
  30,
);
const CORE_REVIEW_CANDIDATE_MULTIPLIER = boundedInteger(
  process.env.RADIOLOGY_PPT_CORE_REVIEW_CANDIDATE_MULTIPLIER,
  8,
  1,
  12,
);
const CORE_REVIEW_CASE_CANDIDATE_LIMIT = boundedInteger(
  process.env.RADIOLOGY_PPT_CORE_REVIEW_CASE_CANDIDATE_LIMIT,
  8,
  3,
  20,
);
const CASE_PREPARE_CONCURRENCY = boundedInteger(
  process.env.RADIOLOGY_PPT_CASE_PREPARE_CONCURRENCY,
  2,
  1,
  6,
);
const CORE_REVIEW_DEFAULT_QUESTION_BANK_PATH = path.join(
  RESOURCE_ROOT,
  "src",
  "core_review",
  "default-question-bank.json",
);
const CORE_REVIEW_LIBRARY_TEXT_CORPUS_PATH = path.join(
  APP_ROOT,
  "library",
  "board-review",
  "corpus.json",
);
const CORE_REVIEW_LIBRARY_PDF_CORPUS_PATH = path.join(
  APP_ROOT,
  "library",
  "board-review",
  "pdf-corpus.json",
);
const CORE_REVIEW_QUESTION_SOURCE_MODES = new Set([
  "bundled",
  "library",
  "question-bank",
]);

function boundedInteger(rawValue, defaultValue, minimum, maximum) {
  const parsed = Number.parseInt(rawValue ?? "", 10);
  if (!Number.isInteger(parsed)) {
    return defaultValue;
  }

  return Math.max(minimum, Math.min(maximum, parsed));
}

function normalizeStandaloneQuestionCounts(counts = {}) {
  return {
    nis: boundedInteger(counts.nis, 0, 0, 50),
    physics: boundedInteger(counts.physics, 0, 0, 50),
  };
}

function standaloneQuestionTotal(counts = {}) {
  const normalized = normalizeStandaloneQuestionCounts(counts);
  return normalized.nis + normalized.physics;
}

export function coreReviewStandaloneQuestionCountsForTotal(
  totalReviewItemCount,
) {
  const requestedTotal = boundedInteger(totalReviewItemCount, 50, 1, 150);
  if (requestedTotal < 4) {
    return { nis: 0, physics: 0 };
  }
  if (requestedTotal < 20) {
    return { nis: 1, physics: 1 };
  }
  return { nis: 2, physics: 2 };
}

export function coreReviewCaseCountForTotal(totalReviewItemCount) {
  const requestedTotal = boundedInteger(totalReviewItemCount, 50, 1, 150);
  return Math.max(
    1,
    requestedTotal -
      standaloneQuestionTotal(
        coreReviewStandaloneQuestionCountsForTotal(requestedTotal),
      ),
  );
}

async function buildDeck(options) {
  const deck = await import("./deck.mjs");
  return deck.buildDeck(options);
}

export function normalizeCaseRequestEntries(entries) {
  const normalized = parseCaseRequestList(entries)
    .map((entry) => {
      if (typeof entry === "string") {
        return parseCaseRequest(entry);
      }
      if (entry && typeof entry === "object") {
        return parseCaseRequest(entry);
      }
      return null;
    })
    .filter(Boolean)
    .filter((entry) => entry.rawInput);

  const unique = [];
  const seen = new Set();
  for (const entry of normalized) {
    if (entry.randomSpec && !entry.selectedCasePath) {
      unique.push(entry);
      continue;
    }
    const key = JSON.stringify({
      rawInput: entry.rawInput,
      selectedCasePath: entry.selectedCasePath || "",
    });
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(entry);
    }
  }

  return unique;
}

export function normalizePreparedItems(payload) {
  const items = Array.isArray(payload) ? payload : payload?.items;
  if (!Array.isArray(items)) {
    throw new Error("Prepared input must contain an array of items.");
  }

  return items
    .map((item) => ({
      request: parseCaseRequest(
        item.request || item.entry || item.sourceRequest || item,
      ),
      caseData: item.caseData || item.case || item,
    }))
    .filter((item) => item.request?.rawInput && item.caseData?.caseTitle);
}

async function validateRenderPreparedItems(rawItems) {
  const failures = [];
  for (let index = 0; index < rawItems.length; index += 1) {
    const item = rawItems[index];
    const caseNumber = index + 1;
    const caseData = preparedItemCaseData(item);
    const request = preparedItemRequest(item);

    if (!caseData) {
      failures.push(`Case ${caseNumber} is missing case data.`);
      continue;
    }

    const caseTitle = collapseWhitespace(caseData.caseTitle || "");
    const caseIdentifier = collapseWhitespace(
      caseData.casePath || caseData.caseUrl || request?.selectedCasePath || "",
    );

    if (!request?.rawInput) {
      failures.push(
        `${caseRenderLabel(caseNumber, caseTitle)} is missing a source request.`,
      );
    }
    if (!caseTitle) {
      failures.push(`Case ${caseNumber} is missing a case title.`);
    }
    if (!caseIdentifier) {
      failures.push(
        `${caseRenderLabel(caseNumber, caseTitle)} is missing a case identifier.`,
      );
    }
    if (!Array.isArray(caseData.images)) {
      failures.push(
        `${caseRenderLabel(caseNumber, caseTitle)} is missing an images array.`,
      );
      continue;
    }

    for (
      let imageIndex = 0;
      imageIndex < caseData.images.length;
      imageIndex += 1
    ) {
      const image = caseData.images[imageIndex];
      const imageNumber = imageIndex + 1;
      const imageLabel = `Image ${imageNumber} for ${imageCaseRenderLabel(
        caseNumber,
        caseTitle,
      )}`;

      if (!image || typeof image !== "object" || Array.isArray(image)) {
        failures.push(`${imageLabel} is not a valid image object.`);
        continue;
      }

      const localPath = collapseWhitespace(image.localPath || "");
      if (!localPath) {
        failures.push(`${imageLabel} is missing a localPath.`);
        continue;
      }
      if (isUnsupportedImagePath(localPath)) {
        failures.push(
          `${imageLabel} uses an unsupported image path: ${localPath}. Expected a local file path.`,
        );
        continue;
      }

      try {
        const stat = await fs.stat(localPath);
        if (!stat.isFile()) {
          failures.push(`${imageLabel} is not a file: ${localPath}`);
        }
      } catch {
        failures.push(`${imageLabel} was not found: ${localPath}`);
      }
    }
  }

  if (failures.length) {
    throw new Error(
      `Cannot render PowerPoint because prepared case data is incomplete:\n- ${failures.join(
        "\n- ",
      )}`,
    );
  }
}

function preparedItemCaseData(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    return null;
  }
  const caseData = item.caseData || item.case || item;
  return caseData && typeof caseData === "object" && !Array.isArray(caseData)
    ? caseData
    : null;
}

function preparedItemRequest(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    return null;
  }
  try {
    return parseCaseRequest(
      item.request || item.entry || item.sourceRequest || item,
    );
  } catch {
    return null;
  }
}

function caseRenderLabel(caseNumber, caseTitle) {
  return caseTitle ? `Case ${caseNumber} "${caseTitle}"` : `Case ${caseNumber}`;
}

function imageCaseRenderLabel(caseNumber, caseTitle) {
  return caseTitle ? `case "${caseTitle}"` : `case ${caseNumber}`;
}

function isUnsupportedImagePath(localPath) {
  return (
    /^[a-z][a-z\d+.-]*:/i.test(localPath) && !/^[a-z]:[\\/]/i.test(localPath)
  );
}

async function validateRenderOutputPath(outputPath) {
  try {
    const stat = await fs.stat(outputPath);
    if (stat.isDirectory()) {
      throw new Error(
        `Cannot render PowerPoint because the output path is a directory: ${outputPath}`,
      );
    }
  } catch (error) {
    if (error?.code === "ENOENT") {
      return;
    }
    if (/^Cannot render PowerPoint because/.test(error?.message || "")) {
      throw error;
    }
    throw new Error(
      `Cannot render PowerPoint because the output path cannot be checked: ${outputPath}. ${error?.message || error}`,
    );
  }
}

export async function prepareCaseItems(
  rawEntries,
  args,
  { readRandomHistory = true, writeRandomHistory = false } = {},
) {
  emitProgress("Normalizing case requests");
  let entries = normalizeCaseRequestEntries(rawEntries).map((entry) =>
    parseCaseRequest({
      ...entry,
      includeClinicalHistory: Boolean(args.useClinicalHistory),
      useOllamaAssist: Boolean(args.useOllamaAssist || entry.useOllamaAssist),
      ollamaModel: collapseWhitespace(
        args.ollamaModel || entry.ollamaModel || "",
      ),
    }),
  );
  entries = await withBackendStage(
    "case request expansion",
    { inputCount: entries.length },
    () =>
      expandCaseRequests(entries, {
        readRandomHistory,
        writeRandomHistory,
        allowRandomHistoryFallback: args.onlyNewRandomCases === false,
      }),
  );
  emitProgress("Preparing case previews", { requestCount: entries.length });

  const cacheDir = path.join(APP_ROOT, "cache");
  const prepareConcurrency = boundedInteger(
    args.casePrepareConcurrency,
    CASE_PREPARE_CONCURRENCY,
    1,
    6,
  );
  const preparedResults = await withBackendStage(
    "case preview preparation",
    { requestCount: entries.length },
    () =>
      mapWithConcurrency(entries, prepareConcurrency, (entry) =>
        prepareEntry(entry, args, cacheDir),
      ),
  );
  const uniqueResults = await withBackendStage(
    "duplicate random case check",
    { requestCount: preparedResults.length },
    () =>
      replaceDuplicateRandomPreparedResults(
        preparedResults,
        entries,
        args,
        cacheDir,
      ),
  );
  const items = uniqueResults.map((result) => result.item).filter(Boolean);
  if (writeRandomHistory) {
    await rememberRandomHistoryFromPreparedItems(items);
  }

  return {
    entries,
    items,
    failures: uniqueResults.map((result) => result.failure).filter(Boolean),
  };
}

export async function prepareCases(entries, args) {
  emitProgress("Starting case preparation");
  const prepared = await prepareCaseItems(entries, args, {
    readRandomHistory: true,
    writeRandomHistory: true,
  });
  scheduleFallbackCasePrefetch(prepared.items);
  return prepared;
}

export async function prepareCoreReviewDeck(args) {
  emitProgress("Planning Core Review case requests");
  const requestedReviewItemCount = boundedInteger(
    args.caseCount || args.count,
    50,
    1,
    150,
  );
  const standaloneQuestionCounts = coreReviewStandaloneQuestionCountsForTotal(
    requestedReviewItemCount,
  );
  const requestedCaseCount = coreReviewCaseCountForTotal(
    requestedReviewItemCount,
  );
  const candidateCaseCount = Math.min(
    300,
    Math.max(
      requestedCaseCount,
      requestedCaseCount * CORE_REVIEW_CANDIDATE_MULTIPLIER,
      requestedCaseCount + 120,
    ),
  );
  const plan = await buildCoreReviewCasePlan({
    ...args,
    caseCount: requestedCaseCount,
    candidateCaseCount,
    totalReviewItemCount: requestedReviewItemCount,
    standaloneQuestionCounts,
    allowAlternateModality: true,
  });
  emitProgress("Starting Core Review case preparation", {
    requestedReviewItemCount,
    requestedCaseCount: plan.requestedCaseCount,
    plannedCaseCount: plan.plannedCaseCount,
    standaloneQuestionCounts,
    caseMix: plan.caseMix,
    modalityMix: plan.modalityMix,
  });
  const prepared = await prepareCoreReviewCaseItems(
    plan.entries,
    {
      ...args,
      onlyNewRandomCases: args.onlyNewRandomCases !== false,
      caseCandidateLimit:
        args.caseCandidateLimit || CORE_REVIEW_CASE_CANDIDATE_LIMIT,
      casePrepareConcurrency: args.casePrepareConcurrency || 1,
    },
    requestedCaseCount,
  );
  emitProgress("Core Review case preparation complete", {
    requestedReviewItemCount,
    requestedCaseCount,
    preparedCaseCount: prepared.items.length,
    standaloneQuestionCount: standaloneQuestionTotal(standaloneQuestionCounts),
    candidatePoolSize: plan.entries.length,
  });
  scheduleFallbackCasePrefetch(prepared.items);
  return {
    plan,
    ...prepared,
  };
}

async function prepareCoreReviewCaseItems(entries, args, requestedCaseCount) {
  const items = [];
  const failures = [];
  const candidateFailures = [];
  const attemptedEntries = [];
  const usedCasePaths = new Set();

  for (
    let index = 0;
    index < entries.length && items.length < requestedCaseCount;
    index += CORE_REVIEW_PREPARE_BATCH_SIZE
  ) {
    const batch = entries
      .slice(index, index + CORE_REVIEW_PREPARE_BATCH_SIZE)
      .map((entry) =>
        parseCaseRequest({
          ...entry,
          caseCandidateLimit:
            entry.caseCandidateLimit ||
            args.caseCandidateLimit ||
            CORE_REVIEW_CASE_CANDIDATE_LIMIT,
          excludeCasePaths: dedupe([
            ...(entry.excludeCasePaths || []),
            ...usedCasePaths,
          ]),
        }),
      );
    attemptedEntries.push(...batch);
    emitProgress("Preparing Core Review candidate batch", {
      targetCaseCount: requestedCaseCount,
      preparedCaseCount: items.length,
      candidateStart: index + 1,
      candidateEnd: index + batch.length,
      candidatePoolSize: entries.length,
    });

    const prepared = await prepareCaseItems(batch, args, {
      readRandomHistory: true,
      writeRandomHistory: false,
    });
    candidateFailures.push(...prepared.failures);

    for (const item of prepared.items) {
      const casePath = normalizedCasePath(
        item.caseData?.casePath || item.request?.selectedCasePath || "",
      );
      if (casePath && usedCasePaths.has(casePath)) {
        const title =
          item.caseData?.caseTitle || item.request?.rawInput || casePath;
        emitWarning(
          "Duplicate Core Review case skipped while filling requested count",
          {
            caseTitle: title,
            casePath,
          },
        );
        failures.push(`Skipped duplicate Core Review case "${title}".`);
        continue;
      }

      if (casePath) {
        usedCasePaths.add(casePath);
      }
      items.push(item);
      if (items.length >= requestedCaseCount) {
        break;
      }
    }
  }

  if (items.length < requestedCaseCount) {
    emitWarning(
      "Core Review prepared fewer cases than requested after exhausting the candidate pool",
      {
        requestedCaseCount,
        preparedCaseCount: items.length,
        candidatePoolSize: entries.length,
      },
    );
    failures.push(
      `Core Review prepared ${items.length} of ${requestedCaseCount} requested case(s) after trying ${attemptedEntries.length} candidate request(s). ${candidateFailures.slice(0, 3).join(" ")}`,
    );
  }

  if (items.length) {
    await rememberRandomHistoryFromPreparedItems(items);
  }

  return {
    entries: attemptedEntries,
    items,
    failures,
  };
}

export async function scoreImages(payload, args) {
  emitProgress("Starting optional Ollama image scoring");
  const items = normalizePreparedItems(payload);
  if (!items.length) {
    throw new Error("No prepared cases were provided for image scoring.");
  }

  return {
    items: await scorePreparedItemsWithOllama(items, {
      ollamaModel: args.ollamaModel || "",
    }),
  };
}

export async function renderPowerPoint(payload, args) {
  emitProgress("Starting PowerPoint render");
  const rawItems = Array.isArray(payload) ? payload : payload?.items;
  if (!Array.isArray(rawItems)) {
    throw new Error("Prepared input must contain an array of items.");
  }
  if (!rawItems.length) {
    throw new Error("No prepared cases were provided for render.");
  }
  await validateRenderPreparedItems(rawItems);

  const items = normalizePreparedItems({ items: rawItems });
  if (!items.length) {
    throw new Error("No prepared cases were provided for render.");
  }

  const entries = items.map((item) => item.request);
  const cases = items.map((item) => item.caseData);
  const deckTitle = args.title || defaultDeckTitle(entries);
  const stamp = formatTimestamp();
  const fileStem = `${slugify(deckTitle) || "radiology-case-deck"}-${stamp}`;
  const outputPath = ensurePptxPath(
    path.resolve(
      args.out || path.join(APP_ROOT, "outputs", `${fileStem}.pptx`),
    ),
  );
  const manifestPath = path.join(
    path.dirname(outputPath),
    `${path.parse(outputPath).name}.json`,
  );
  const scratchDir = path.join(
    APP_ROOT,
    "scratch",
    path.parse(outputPath).name,
  );
  const deckMode = args.deckMode || "case-conference";
  const coreReviewQuestions =
    deckMode === "core-review"
      ? await selectCoreReviewStandaloneQuestions(cases, deckTitle, args)
      : [];

  await validateRenderOutputPath(outputPath);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(
    manifestPath,
    `${JSON.stringify(toManifest(cases, entries, deckTitle, deckMode), null, 2)}\n`,
    "utf8",
  );

  const result = await withBackendStage(
    "PowerPoint render",
    { caseCount: cases.length, outputPath },
    () =>
      buildDeck({
        cases,
        deckTitle,
        outputPath,
        scratchDir,
        deckMode,
        coreReviewQuestions,
        coreReviewCaseBankPath: args.caseBankPath || "",
        theme: args.theme || "classic",
        includeTeachingPoints: Boolean(args.includeTeachingPoints),
      }),
  );

  emitProgress("PowerPoint render complete", { outputPath: result.outputPath });

  return {
    outputPath: result.outputPath,
    manifestPath,
  };
}

export function getCoreReviewSchema() {
  return coreReviewSchemaSummary();
}

export async function ingestCoreReviewTextFiles(inputPaths, args) {
  emitProgress("Importing Core Review text sources", {
    sourceCount: inputPaths.length,
  });
  const outputPath = path.resolve(
    args.out || path.join(APP_ROOT, "library", "board-review", "corpus.json"),
  );
  const corpus = await ingestCoreReviewSources(inputPaths, {
    outputPath,
    domain: args.domain || "",
    tags: args.tags || [],
  });

  return { outputPath, ...corpus };
}

export async function ingestCoreReviewPdfFiles(inputPaths, args) {
  emitProgress("Importing Core Boards PDFs", {
    sourceCount: inputPaths.length,
  });
  const outputPath = path.resolve(
    args.out ||
      path.join(APP_ROOT, "library", "board-review", "pdf-corpus.json"),
  );
  return ingestCoreReviewPdfs(inputPaths, {
    outputPath,
    domain: args.domain || "",
    tags: args.tags || [],
    title: args.title || "",
    sourceId: args.sourceId || "",
    assetsDir: args.assetsDir ? path.resolve(args.assetsDir) : "",
    sourcesDir: args.sourcesDir ? path.resolve(args.sourcesDir) : "",
    dpi: args.dpi || 144,
    maxChars: args.maxChars || 1600,
    noRenderPages: Boolean(args.noRenderPages),
    noExtractImages: Boolean(args.noExtractImages),
    noCopySource: Boolean(args.noCopySource),
  });
}

export async function buildCoreReviewQuizFromFile(questionBankPath, args) {
  const questionBank = await loadCoreReviewQuestionBank(questionBankPath);
  return buildCoreReviewQuizSession(questionBank, {
    count: args.quizCount,
    domain: args.domain || "",
    questionType: args.questionType || "",
    seed: args.seed || "",
  });
}

export function renderCoreReviewQuizSessionText(session) {
  return renderCoreReviewQuizText(session);
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(limit, items.length));

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

async function prepareEntry(entry, args, cacheDir) {
  const isCoreReviewCandidate = Boolean(entry.coreReviewPlan);
  try {
    const fetchCase = () =>
      fetchRadiopaediaCase(entry, {
        cacheDir,
        imagesPerCase: entry.requestedImagesPerCase || args.imagesPerCase,
        maxFallbackAttempts: isRandomPreparedRequest(entry)
          ? RANDOM_PREPARE_FALLBACK_ATTEMPTS
          : null,
        candidateLimit:
          entry.caseCandidateLimit || args.caseCandidateLimit || 6,
        acceptFirstUsable: isCoreReviewCandidate,
      });
    const caseData = await withBackendStage(
      "case preparation",
      { request: entry.rawInput },
      fetchCase,
      {
        errorType: isCoreReviewCandidate ? "progress" : "stage-error",
        errorVerb: isCoreReviewCandidate ? "Skipped" : "Failed",
      },
    );
    await recordCaseIndex({
      caseData,
      request: entry,
      source: isRandomPreparedRequest(entry) ? "random" : "specific",
    });
    emitProgress("Prepared case", {
      request: entry.rawInput,
      caseTitle: caseData.caseTitle,
    });
    return { item: { request: entry, caseData }, failure: null };
  } catch (error) {
    if (isCoreReviewCandidate) {
      emitProgress("Skipped Core Review candidate", {
        request: entry.rawInput,
        reason: error.message,
      });
    } else {
      emitWarning("Case preparation failed", {
        request: entry.rawInput,
        error: error.message,
      });
    }
    return {
      item: null,
      failure: `Unable to prepare case for "${entry.rawInput}": ${error.message}`,
    };
  }
}

function normalizedCasePath(value) {
  const clean = collapseWhitespace(value).replace(/\?.*$/, "");
  try {
    const url = new URL(clean);
    return /(^|\.)radiopaedia\.org$/i.test(url.hostname) ? url.pathname : clean;
  } catch {
    return clean;
  }
}

function isRandomPreparedRequest(request) {
  return Boolean(
    request?.originalInput ||
      request?.randomQuery ||
      request?.randomSpec ||
      (Array.isArray(request?.randomSystems) && request.randomSystems.length),
  );
}

function retryEntryForDuplicateRandomCase(request, excludedPaths) {
  return parseCaseRequest({
    ...request,
    requestMode: "random",
    randomCount: 1,
    randomQuery: request.randomQuery || request.randomSpec?.queryText || "",
    randomSystems: request.randomSystems || request.randomSpec?.systems || [],
    rawInput: request.originalInput || request.rawInput,
    diagnosis: "",
    selectedCasePath: "",
    selectedCaseTitle: "",
    excludeCasePaths: excludedPaths,
  });
}

async function prepareReplacementRandomCase(
  request,
  excludedPaths,
  args,
  cacheDir,
) {
  let exclusions = dedupe(
    excludedPaths.map((value) => normalizedCasePath(value)).filter(Boolean),
  );
  let lastFailure = null;

  for (
    let attempt = 1;
    attempt <= RANDOM_PREPARE_REPLACEMENT_ATTEMPTS;
    attempt += 1
  ) {
    const retrySeed = retryEntryForDuplicateRandomCase(request, exclusions);
    let retryEntries = [];
    try {
      retryEntries = await expandCaseRequests([retrySeed], {
        readRandomHistory: true,
        writeRandomHistory: false,
        allowRandomHistoryFallback: args.onlyNewRandomCases === false,
      });
    } catch (error) {
      lastFailure = error.message;
      break;
    }

    const retryEntry = retryEntries[0];
    const retryCasePath = normalizedCasePath(
      retryEntry?.selectedCasePath || "",
    );
    if (!retryEntry || !retryCasePath || exclusions.includes(retryCasePath)) {
      lastFailure = "No unused replacement random case was found.";
      if (retryCasePath) {
        exclusions = dedupe([...exclusions, retryCasePath]);
      }
      continue;
    }

    emitProgress("Preparing replacement random case", {
      request: request.rawInput,
      attempt,
      casePath: retryEntry.selectedCasePath,
      title: retryEntry.selectedCaseTitle,
    });
    const retry = await prepareEntry(retryEntry, args, cacheDir);
    const preparedPath = normalizedCasePath(
      retry.item?.caseData?.casePath || retryEntry.selectedCasePath,
    );
    if (retry.item && preparedPath && !exclusions.includes(preparedPath)) {
      return retry;
    }

    lastFailure =
      retry.failure ||
      `Replacement random case "${retryEntry.selectedCaseTitle || retryEntry.selectedCasePath}" could not be prepared.`;
    exclusions = dedupe(
      [...exclusions, retryCasePath, preparedPath].filter(Boolean),
    );
  }

  return {
    item: null,
    failure: lastFailure || "No replacement random case could be prepared.",
  };
}

async function replaceDuplicateRandomPreparedResults(
  preparedResults,
  entries,
  args,
  cacheDir,
) {
  const uniqueResults = [];
  const usedCasePaths = new Set();
  const unavailableCasePaths = new Set();

  for (let index = 0; index < preparedResults.length; index += 1) {
    let result = preparedResults[index];
    const request = result.item?.request || entries[index];
    let casePath = normalizedCasePath(result.item?.caseData?.casePath || "");

    if (!result.item && isRandomPreparedRequest(request)) {
      emitWarning("Random case failed to prepare; looking for a replacement", {
        request: request.rawInput,
        failure: result.failure,
      });
      const excludedPaths = dedupe(
        [
          ...usedCasePaths,
          ...unavailableCasePaths,
          request.selectedCasePath,
          ...(request.excludeCasePaths || []),
        ]
          .map((value) => normalizedCasePath(value))
          .filter(Boolean),
      );
      result = await prepareReplacementRandomCase(
        request,
        excludedPaths,
        args,
        cacheDir,
      );
      casePath = normalizedCasePath(result.item?.caseData?.casePath || "");
    }

    if (
      result.item &&
      casePath &&
      usedCasePaths.has(casePath) &&
      isRandomPreparedRequest(request)
    ) {
      emitWarning("Duplicate random case detected; looking for an alternate", {
        request: request.rawInput,
        duplicateCasePath: casePath,
      });

      const excludedPaths = dedupe(
        [
          ...usedCasePaths,
          casePath,
          request.selectedCasePath,
          ...(request.excludeCasePaths || []),
        ]
          .map((value) => normalizedCasePath(value))
          .filter(Boolean),
      );
      const retry = await prepareReplacementRandomCase(
        request,
        excludedPaths,
        args,
        cacheDir,
      );
      const retryCasePath = normalizedCasePath(
        retry.item?.caseData?.casePath || "",
      );

      if (retry.item && retryCasePath && !usedCasePaths.has(retryCasePath)) {
        result = retry;
        casePath = retryCasePath;
      } else {
        emitWarning(
          "No unique alternate random case was available; dropping duplicate case",
          {
            request: request.rawInput,
            duplicateCasePath: casePath,
          },
        );
        uniqueResults.push({
          item: null,
          failure: `Skipped duplicate random case "${result.item.caseData.caseTitle}" because no unique alternate was available.`,
        });
        continue;
      }
    }

    if (casePath) {
      if (result.item) {
        usedCasePaths.add(casePath);
      } else {
        unavailableCasePaths.add(casePath);
      }
    }
    uniqueResults.push(result);
  }

  return uniqueResults;
}

async function rememberRandomHistoryFromPreparedItems(items) {
  const casePaths = items
    .filter(
      (item) =>
        item.request?.originalInput ||
        item.request?.randomQuery ||
        item.request?.randomSystems?.length,
    )
    .map((item) => item.caseData?.casePath || item.request?.selectedCasePath)
    .filter(Boolean);

  if (casePaths.length) {
    await saveRandomHistory(casePaths);
  }
}

function perDomainCoreReviewQuestionCount(caseCount) {
  return caseCount >= 8 ? 2 : 1;
}

function standaloneQuestionCountsFromPreparedCases(cases) {
  for (const caseData of cases) {
    const counts = caseData?.coreReviewPlan?.standaloneQuestionCounts;
    if (!counts) {
      continue;
    }
    const normalized = normalizeStandaloneQuestionCounts(counts);
    if (standaloneQuestionTotal(normalized) > 0) {
      return normalized;
    }
  }

  const perDomain = perDomainCoreReviewQuestionCount(cases.length);
  return { nis: perDomain, physics: perDomain };
}

function normalizeCoreReviewQuestionSource(value) {
  const normalized = collapseWhitespace(value || "").toLowerCase();
  if (!normalized) {
    return "";
  }
  if (["bundled", "bundled-free", "default", "free"].includes(normalized)) {
    return "bundled";
  }
  if (
    [
      "library",
      "imported-library",
      "imported",
      "local-library",
      "corpus",
    ].includes(normalized)
  ) {
    return "library";
  }
  if (
    [
      "question-bank",
      "question_bank",
      "json",
      "custom-bank",
      "custom-json",
    ].includes(normalized)
  ) {
    return "question-bank";
  }
  return "";
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function tryLoadDefaultCoreReviewQuestionBank() {
  try {
    return await loadCoreReviewQuestionBank(
      CORE_REVIEW_DEFAULT_QUESTION_BANK_PATH,
    );
  } catch (error) {
    emitWarning("Bundled Core Review question bank could not be loaded", {
      questionBankPath: CORE_REVIEW_DEFAULT_QUESTION_BANK_PATH,
      message: error.message,
    });
    return null;
  }
}

function resolveCoreReviewQuestionImage(question, questionBankPath) {
  const image = question?.image;
  if (!image || typeof image !== "object") {
    return question;
  }

  const imagePath = collapseWhitespace(image.path || "");
  if (!imagePath || path.isAbsolute(imagePath)) {
    return question;
  }

  return {
    ...question,
    image: {
      ...image,
      path: path.resolve(path.dirname(questionBankPath), imagePath),
    },
  };
}

function resolveCoreReviewQuestionBankSource(args = {}) {
  const requestedSource = normalizeCoreReviewQuestionSource(
    args.coreReviewQuestionSource ||
      process.env.RADIOLOGY_PPT_CORE_REVIEW_QUESTION_SOURCE ||
      "",
  );
  const questionBankPath = collapseWhitespace(
    args.coreReviewQuestionBankPath ||
      process.env.RADIOLOGY_PPT_CORE_REVIEW_QUESTION_BANK ||
      "",
  );

  if (
    requestedSource &&
    CORE_REVIEW_QUESTION_SOURCE_MODES.has(requestedSource)
  ) {
    return {
      source: requestedSource,
      questionBankPath,
    };
  }

  return {
    source: questionBankPath ? "question-bank" : "bundled",
    questionBankPath,
  };
}

function resolveLoadedQuestionBank(questionBank) {
  if (!questionBank?.path) {
    return questionBank;
  }
  return {
    ...questionBank,
    questions: questionBank.questions.map((question) =>
      resolveCoreReviewQuestionImage(question, questionBank.path),
    ),
  };
}

async function loadCoreReviewQuestionBankForRender(args = {}) {
  const resolved = resolveCoreReviewQuestionBankSource(args);
  if (resolved.source === "question-bank") {
    if (!resolved.questionBankPath) {
      emitWarning("Core Review question bank path was not provided", {
        requestedSource: resolved.source,
      });
      return tryLoadDefaultCoreReviewQuestionBank();
    }
    try {
      const questionBank = await loadCoreReviewQuestionBank(
        resolved.questionBankPath,
      );
      return resolveLoadedQuestionBank(questionBank);
    } catch (error) {
      emitWarning("Core Review question bank could not be loaded", {
        questionBankPath: resolved.questionBankPath,
        message: error.message,
      });
      return tryLoadDefaultCoreReviewQuestionBank();
    }
  }

  if (resolved.source === "library") {
    const corpusPaths = [
      CORE_REVIEW_LIBRARY_TEXT_CORPUS_PATH,
      CORE_REVIEW_LIBRARY_PDF_CORPUS_PATH,
    ];
    const existingPaths = [];
    for (const corpusPath of corpusPaths) {
      if (await pathExists(corpusPath)) {
        existingPaths.push(corpusPath);
      }
    }
    if (!existingPaths.length) {
      emitWarning(
        "No imported Core Review sources were found; falling back to bundled questions",
        {
          expectedPaths: corpusPaths,
        },
      );
      return tryLoadDefaultCoreReviewQuestionBank();
    }

    try {
      const corpora = await Promise.all(
        existingPaths.map((corpusPath) => loadCoreReviewCorpus(corpusPath)),
      );
      const mergedCorpus = mergeCoreReviewCorpora(corpora);
      const questionBank = buildCoreReviewQuestionBankFromCorpus(mergedCorpus, {
        title: "Imported Core Review Sources",
      });
      if (!questionBank.questions.length) {
        emitWarning(
          "Imported Core Review sources did not yield usable review questions",
          {
            corpusPaths: existingPaths,
          },
        );
        return tryLoadDefaultCoreReviewQuestionBank();
      }
      return questionBank;
    } catch (error) {
      emitWarning("Imported Core Review sources could not be loaded", {
        corpusPaths: existingPaths,
        message: error.message,
      });
      return tryLoadDefaultCoreReviewQuestionBank();
    }
  }

  return tryLoadDefaultCoreReviewQuestionBank();
}

function pickStandaloneDomainQuestions(questionBank, domain, count, seed) {
  if (!questionBank) {
    return [];
  }
  return buildCoreReviewQuizSession(questionBank, {
    count,
    domain,
    seed,
  }).questions;
}

function supplementStandaloneDomainQuestions(
  primary,
  fallback,
  domain,
  count,
  seed,
) {
  const selected = pickStandaloneDomainQuestions(primary, domain, count, seed);
  if (selected.length >= count || !fallback || fallback === primary) {
    return selected;
  }

  const excludedIds = new Set(selected.map((question) => question.id));
  const fallbackQuestions = pickStandaloneDomainQuestions(
    {
      ...fallback,
      questions: fallback.questions.filter(
        (question) => !excludedIds.has(question.id),
      ),
    },
    domain,
    count - selected.length,
    `${seed}|fallback`,
  );
  return [...selected, ...fallbackQuestions];
}

async function selectCoreReviewStandaloneQuestions(
  cases,
  deckTitle,
  args = {},
) {
  const questionBank = await loadCoreReviewQuestionBankForRender(args);
  if (!questionBank?.questions?.length) {
    return [];
  }
  const defaultQuestionBank =
    questionBank.path === CORE_REVIEW_DEFAULT_QUESTION_BANK_PATH
      ? questionBank
      : await tryLoadDefaultCoreReviewQuestionBank();
  const seedBase = [
    deckTitle,
    ...cases.map(
      (caseData) =>
        caseData.casePath || caseData.caseTitle || caseData.rawInput || "",
    ),
  ]
    .filter(Boolean)
    .join("|");
  const standaloneQuestionCounts =
    standaloneQuestionCountsFromPreparedCases(cases);

  return [
    ...supplementStandaloneDomainQuestions(
      questionBank,
      defaultQuestionBank,
      "nis",
      standaloneQuestionCounts.nis,
      `${seedBase}|nis`,
    ),
    ...supplementStandaloneDomainQuestions(
      questionBank,
      defaultQuestionBank,
      "physics",
      standaloneQuestionCounts.physics,
      `${seedBase}|physics`,
    ),
  ];
}

function defaultDeckTitle(entries) {
  if (entries.length === 1) {
    return `${entries[0].rawInput} case review`;
  }
  return "Radiology case review";
}

function scheduleFallbackCasePrefetch(items) {
  if (process.env.RADIOLOGY_PPT_BACKEND_SERVICE !== "1") {
    return;
  }
  if (process.env.RADIOLOGY_PPT_PREFETCH_FALLBACKS !== "1") {
    return;
  }

  const fallbackPaths = [];
  const seen = new Set();
  for (const item of items || []) {
    for (const fallback of item.request?.fallbackCandidates || []) {
      const casePath = collapseWhitespace(fallback.casePath || "");
      if (casePath && !seen.has(casePath)) {
        seen.add(casePath);
        fallbackPaths.push(casePath);
      }
      if (fallbackPaths.length >= 8) {
        break;
      }
    }
    if (fallbackPaths.length >= 8) {
      break;
    }
  }

  if (!fallbackPaths.length) {
    return;
  }

  setTimeout(async () => {
    for (const casePath of fallbackPaths) {
      try {
        await radiopaediaProvider.fetchText(
          radiopaediaProvider.absoluteUrl(casePath),
        );
      } catch {
        // Background cache warming must never affect the foreground review workflow.
      }
    }
  }, 0);
}

function ensurePptxPath(outPath) {
  if (outPath.toLowerCase().endsWith(".pptx")) {
    return outPath;
  }
  return `${outPath}.pptx`;
}

function toManifest(cases, entries, deckTitle, deckMode) {
  return {
    createdAt: new Date().toISOString(),
    deckTitle,
    deckMode,
    requestedEntries: entries.map((entry) => ({
      rawInput: entry.rawInput,
      originalInput: entry.originalInput || null,
      diagnosis: entry.diagnosis,
      studyHint: entry.studyHint,
      selectedCasePath: entry.selectedCasePath || null,
      secondaryModality: entry.secondaryModality || null,
      ageGroup: entry.ageGroup || null,
      topicFocus: entry.topicFocus || null,
      difficulty: entry.difficulty || null,
      requestedImagesPerCase: entry.requestedImagesPerCase || null,
      coreReviewPlan: entry.coreReviewPlan || null,
    })),
    cases: cases.map((caseData) => ({
      rawInput: caseData.rawInput,
      originalInput: caseData.originalInput || null,
      diagnosisQuery: caseData.diagnosisQuery,
      studyHint: caseData.studyHint,
      coreReviewPlan: caseData.coreReviewPlan || null,
      caseTitle: caseData.caseTitle,
      caseUrl: caseData.caseUrl,
      author: caseData.author,
      licenseName: caseData.licenseName,
      licenseUrl: caseData.licenseUrl,
      rid: caseData.rid,
      modalitySummary: caseData.modalitySummary,
      studyCount: caseData.studyCount,
      caseIntro: caseData.caseIntro,
      teachingPoints: caseData.teachingPoints || [],
      quality: caseData.quality,
      imageCandidateCount: Array.isArray(caseData.imageCandidateBank)
        ? caseData.imageCandidateBank.length
        : null,
      images: caseData.images.map((image) => ({
        label: image.label,
        url: image.url,
        localPath: image.localPath,
        frameId: image.frameId || "",
        modality: image.modality || "",
        relevantScore: image.relevantScore,
        selectionExplanation: image.selectionExplanation || "",
        audit: image.audit || {},
        ollamaScore: image.ollamaScore ?? null,
      })),
    })),
  };
}
