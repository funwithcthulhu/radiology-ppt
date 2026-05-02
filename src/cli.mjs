import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { buildDeck } from "./deck.mjs";
import {
  buildCoreReviewQuizSession,
  coreReviewSchemaSummary,
  ingestCoreReviewSources,
  loadCoreReviewQuestionBank,
  renderCoreReviewQuizText,
} from "./core_review/index.mjs";
import {
  expandCaseRequests,
  fetchRadiopaediaCase,
  inspectRadiopaediaCaseCandidates,
  saveRandomHistory,
} from "./radiopaedia.mjs";
import { parseCaseRequest } from "./request-parser.mjs";
import { collapseWhitespace, formatTimestamp, slugify } from "./utils.mjs";

const RESOURCE_ROOT =
  process.env.RADIOLOGY_PPT_RESOURCE_ROOT || path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const APP_ROOT = process.env.RADIOLOGY_PPT_APP_ROOT || RESOURCE_ROOT;
const CORE_REVIEW_PDF_INGEST_SCRIPT = path.join(RESOURCE_ROOT, "scripts", "core_review_pdf_ingest.py");
const CORE_REVIEW_PDF_INGEST_EXE = path.join(APP_ROOT, "scripts", "core_review_pdf_ingest.exe");
const execFileAsync = promisify(execFile);
let PYTHON_RUNTIME_PROMISE = null;

function usage() {
  return [
    "This file is an internal GUI backend.",
    "Supported internal commands:",
    "  node src/cli.mjs --probe-input diagnoses.json",
    "  node src/cli.mjs --prepare-input requests.json [--images-per-case 3] [--use-ollama-assist] [--ollama-model moondream]",
    "  node src/cli.mjs --render-input prepared.json [--title \"Resident Review\"] [--out outputs\\deck.pptx] [--deck-mode case-conference] [--theme classic] [--include-teaching-points]",
    "  node src/cli.mjs --core-review-schema",
    "  node src/cli.mjs --core-review-ingest notes.md guide.txt [--out library\\board-review\\corpus.json]",
    "  node src/cli.mjs --core-review-ingest-pdf book.pdf atlas.pdf [--out library\\board-review\\pdf-corpus.json] [--domain msk] [--format text]",
    "  node src/cli.mjs --core-review-quiz question-bank.json [--count 10] [--domain thoracic] [--question-type single_best_answer] [--format text]",
  ].join("\n");
}

function collectArgumentList(argv, index, name) {
  const values = [];
  let cursor = index + 1;
  while (cursor < argv.length && !String(argv[cursor]).startsWith("--")) {
    values.push(argv[cursor]);
    cursor += 1;
  }
  if (!values.length) {
    throw new Error(`Missing value for ${name}`);
  }
  return { values, nextIndex: cursor - 1 };
}

function parseArgs(argv) {
  const args = {
    imagesPerCase: 3,
    quizCount: 10,
    format: "json",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--probe-input") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --probe-input");
      }
      args.probeInput = value;
      index += 1;
      continue;
    }
    if (arg === "--prepare-input") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --prepare-input");
      }
      args.prepareInput = value;
      index += 1;
      continue;
    }
    if (arg === "--render-input") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --render-input");
      }
      args.renderInput = value;
      index += 1;
      continue;
    }
    if (arg === "--core-review-schema") {
      args.coreReviewSchema = true;
      continue;
    }
    if (arg === "--core-review-ingest") {
      const { values, nextIndex } = collectArgumentList(argv, index, "--core-review-ingest");
      args.coreReviewIngest = values;
      index = nextIndex;
      continue;
    }
    if (arg === "--core-review-ingest-pdf") {
      const { values, nextIndex } = collectArgumentList(argv, index, "--core-review-ingest-pdf");
      args.coreReviewIngestPdf = values;
      index = nextIndex;
      continue;
    }
    if (arg === "--core-review-quiz") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --core-review-quiz");
      }
      args.coreReviewQuiz = value;
      index += 1;
      continue;
    }
    if (arg === "--out") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --out");
      }
      args.out = value;
      index += 1;
      continue;
    }
    if (arg === "--title") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --title");
      }
      args.title = value;
      index += 1;
      continue;
    }
    if (arg === "--images-per-case") {
      const value = Number.parseInt(argv[index + 1] ?? "", 10);
      if (!Number.isInteger(value) || value < 1) {
        throw new Error("--images-per-case must be a positive integer");
      }
      args.imagesPerCase = value;
      index += 1;
      continue;
    }
    if (arg === "--use-clinical-history") {
      args.useClinicalHistory = true;
      continue;
    }
    if (arg === "--use-ollama-assist") {
      args.useOllamaAssist = true;
      continue;
    }
    if (arg === "--ollama-model") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --ollama-model");
      }
      args.ollamaModel = value;
      index += 1;
      continue;
    }
    if (arg === "--count") {
      const value = Number.parseInt(argv[index + 1] ?? "", 10);
      if (!Number.isInteger(value) || value < 1) {
        throw new Error("--count must be a positive integer");
      }
      args.quizCount = value;
      index += 1;
      continue;
    }
    if (arg === "--domain") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --domain");
      }
      args.domain = value;
      index += 1;
      continue;
    }
    if (arg === "--question-type") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --question-type");
      }
      args.questionType = value;
      index += 1;
      continue;
    }
    if (arg === "--tags") {
      const { values, nextIndex } = collectArgumentList(argv, index, "--tags");
      args.tags = values;
      index = nextIndex;
      continue;
    }
    if (arg === "--assets-dir") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --assets-dir");
      }
      args.assetsDir = value;
      index += 1;
      continue;
    }
    if (arg === "--sources-dir") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --sources-dir");
      }
      args.sourcesDir = value;
      index += 1;
      continue;
    }
    if (arg === "--dpi") {
      const value = Number.parseInt(argv[index + 1] ?? "", 10);
      if (!Number.isInteger(value) || value < 72) {
        throw new Error("--dpi must be an integer of at least 72");
      }
      args.dpi = value;
      index += 1;
      continue;
    }
    if (arg === "--no-render-pages") {
      args.noRenderPages = true;
      continue;
    }
    if (arg === "--no-extract-images") {
      args.noExtractImages = true;
      continue;
    }
    if (arg === "--no-copy-source") {
      args.noCopySource = true;
      continue;
    }
    if (arg === "--seed") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --seed");
      }
      args.seed = value;
      index += 1;
      continue;
    }
    if (arg === "--source-id") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --source-id");
      }
      args.sourceId = value;
      index += 1;
      continue;
    }
    if (arg === "--format") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --format");
      }
      args.format = value;
      index += 1;
      continue;
    }
    if (arg === "--deck-mode") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --deck-mode");
      }
      args.deckMode = value;
      index += 1;
      continue;
    }
    if (arg === "--theme") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --theme");
      }
      args.theme = value;
      index += 1;
      continue;
    }
    if (arg === "--include-teaching-points") {
      args.includeTeachingPoints = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      args.help = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

async function pythonRuntime() {
  if (!PYTHON_RUNTIME_PROMISE) {
    PYTHON_RUNTIME_PROMISE = (async () => {
      const candidates = [
        process.env.RADIOLOGY_PPT_PYTHON ? { command: process.env.RADIOLOGY_PPT_PYTHON, prefixArgs: [] } : null,
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
          // try the next local runtime
        }
      }
      return null;
    })();
  }

  return PYTHON_RUNTIME_PROMISE;
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function loadEntries(inputPath) {
  const raw = await fs.readFile(inputPath, "utf8");
  const trimmed = raw.trim();

  if (!trimmed) {
    return [];
  }

  if (/^[\[{\"]/.test(trimmed)) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed;
      }
      if (typeof parsed === "string" || (parsed && typeof parsed === "object")) {
        return [parsed];
      }
      throw new Error("JSON input must be an array, object, or string.");
    } catch (error) {
      if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
        throw error;
      }
    }
  }

  return trimmed
    .split(/\r?\n/)
    .map((line) => line.replace(/#.*$/, ""))
    .map((line) => collapseWhitespace(line))
    .filter(Boolean);
}

function normalizeEntries(entries) {
  const normalized = entries
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

function defaultDeckTitle(entries) {
  if (entries.length === 1) {
    return `${entries[0].rawInput} case review`;
  }
  return "Radiology case review";
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
    })),
    cases: cases.map((caseData) => ({
      rawInput: caseData.rawInput,
      originalInput: caseData.originalInput || null,
      diagnosisQuery: caseData.diagnosisQuery,
      studyHint: caseData.studyHint,
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
      imageCandidateCount: Array.isArray(caseData.imageCandidateBank) ? caseData.imageCandidateBank.length : null,
      images: caseData.images.map((image) => ({
        label: image.label,
        url: image.url,
        localPath: image.localPath,
        relevantScore: image.relevantScore,
        ollamaScore: image.ollamaScore ?? null,
      })),
    })),
  };
}

function normalizePreparedItems(payload) {
  const items = Array.isArray(payload) ? payload : payload?.items;
  if (!Array.isArray(items)) {
    throw new Error("Prepared input must contain an array of items.");
  }

  return items
    .map((item) => ({
      request: parseCaseRequest(item.request || item.entry || item.sourceRequest || item),
      caseData: item.caseData || item.case || item,
    }))
    .filter((item) => item.request?.rawInput && item.caseData?.caseTitle);
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

async function prepareCaseItems(rawEntries, args, { readRandomHistory = true, writeRandomHistory = false } = {}) {
  let entries = normalizeEntries(rawEntries).map((entry) =>
      parseCaseRequest({
        ...entry,
        includeClinicalHistory: Boolean(args.useClinicalHistory),
        useOllamaAssist: Boolean(args.useOllamaAssist || entry.useOllamaAssist),
        ollamaModel: collapseWhitespace(args.ollamaModel || entry.ollamaModel || ""),
      }),
  );
  entries = await expandCaseRequests(entries, {
    readRandomHistory,
    writeRandomHistory,
  });

  const cacheDir = path.join(APP_ROOT, "cache");
  const preparedResults = await mapWithConcurrency(entries, 3, async (entry) => {
    try {
      const caseData = await fetchRadiopaediaCase(entry, {
        cacheDir,
        imagesPerCase: entry.requestedImagesPerCase || args.imagesPerCase,
      });
      return { item: { request: entry, caseData }, failure: null };
    } catch (error) {
      return { item: null, failure: `Unable to prepare case for "${entry.rawInput}": ${error.message}` };
    }
  });
  const items = preparedResults.map((result) => result.item).filter(Boolean);
  const failures = preparedResults.map((result) => result.failure).filter(Boolean);

  return {
    entries,
    items,
    failures,
  };
}

async function rememberRandomHistoryFromPreparedItems(items) {
  const casePaths = items
    .filter((item) => item.request?.originalInput || item.request?.randomQuery || item.request?.randomSystems?.length)
    .map((item) => item.request?.selectedCasePath || item.caseData?.casePath)
    .filter(Boolean);

  if (casePaths.length) {
    await saveRandomHistory(casePaths);
  }
}

async function runProbe(inputPath) {
  const entries = await expandCaseRequests(
    normalizeEntries(await loadEntries(path.resolve(inputPath))),
    {
      readRandomHistory: true,
      writeRandomHistory: false,
    },
  );
  if (!entries.length) {
    throw new Error("No diagnoses provided for probe.");
  }

  const results = [];
  for (const entry of entries) {
    results.push(await inspectRadiopaediaCaseCandidates(entry, { limit: 5 }));
  }

  process.stdout.write(`${JSON.stringify({ entries: results }, null, 2)}\n`);
}

async function runPrepare(inputPath, args) {
  const prepared = await prepareCaseItems(await loadEntries(path.resolve(inputPath)), args, {
    readRandomHistory: true,
    writeRandomHistory: false,
  });
  process.stdout.write(`${JSON.stringify(prepared, null, 2)}\n`);
}

async function runRender(inputPath, args) {
  const raw = JSON.parse(await fs.readFile(path.resolve(inputPath), "utf8"));
  const items = normalizePreparedItems(raw);
  if (!items.length) {
    throw new Error("No prepared cases were provided for render.");
  }

  const entries = items.map((item) => item.request);
  const cases = items.map((item) => item.caseData);
  const deckTitle = args.title || defaultDeckTitle(entries);
  const stamp = formatTimestamp();
  const fileStem = `${slugify(deckTitle) || "radiology-case-deck"}-${stamp}`;
  const outputPath = ensurePptxPath(
    path.resolve(args.out || path.join(APP_ROOT, "outputs", `${fileStem}.pptx`)),
  );
  const manifestPath = path.join(path.dirname(outputPath), `${path.parse(outputPath).name}.json`);
  const scratchDir = path.join(APP_ROOT, "scratch", path.parse(outputPath).name);
  const deckMode = args.deckMode || "case-conference";

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(
    manifestPath,
    `${JSON.stringify(toManifest(cases, entries, deckTitle, deckMode), null, 2)}\n`,
    "utf8",
  );

  const result = await buildDeck({
    cases,
    deckTitle,
    outputPath,
    scratchDir,
    deckMode,
    theme: args.theme || "classic",
    includeTeachingPoints: Boolean(args.includeTeachingPoints),
  });

  await rememberRandomHistoryFromPreparedItems(items);

  console.log(`Created PowerPoint: ${result.outputPath}`);
  console.log(`Created manifest: ${manifestPath}`);
}

async function runCoreReviewSchema() {
  process.stdout.write(`${JSON.stringify(coreReviewSchemaSummary(), null, 2)}\n`);
}

async function runCoreReviewIngest(inputPaths, args) {
  const outputPath = path.resolve(
    args.out || path.join(APP_ROOT, "library", "board-review", "corpus.json"),
  );
  const corpus = await ingestCoreReviewSources(inputPaths, {
    outputPath,
    domain: args.domain || "",
    tags: args.tags || [],
  });

  if (args.format === "text") {
    console.log(`Created Core Review corpus: ${outputPath}`);
    console.log(`Sources: ${corpus.sourceCount}`);
    console.log(`Chunks: ${corpus.chunkCount}`);
    return;
  }

  process.stdout.write(`${JSON.stringify({ outputPath, ...corpus }, null, 2)}\n`);
}

async function runCoreReviewIngestPdf(inputPaths, args) {
  const outputPath = path.resolve(
    args.out || path.join(APP_ROOT, "library", "board-review", "pdf-corpus.json"),
  );
  const hasBundledHelper = await fileExists(CORE_REVIEW_PDF_INGEST_EXE);
  const runtime = hasBundledHelper ? null : await pythonRuntime();
  if (!hasBundledHelper && !runtime) {
    throw new Error("No Python runtime was found for Core Review PDF ingestion.");
  }

  const command = hasBundledHelper ? CORE_REVIEW_PDF_INGEST_EXE : runtime.command;
  const commandArgs = hasBundledHelper
    ? [...inputPaths]
    : [...runtime.prefixArgs, CORE_REVIEW_PDF_INGEST_SCRIPT, ...inputPaths];

  commandArgs.push("--out", outputPath, "--format", args.format || "json");

  if (args.domain) {
    commandArgs.push("--domain", args.domain);
  }
  if (Array.isArray(args.tags) && args.tags.length) {
    commandArgs.push("--tags", ...args.tags);
  }
  if (args.title) {
    commandArgs.push("--title", args.title);
  }
  if (args.sourceId) {
    commandArgs.push("--source-id", args.sourceId);
  }
  if (args.assetsDir) {
    commandArgs.push("--assets-dir", path.resolve(args.assetsDir));
  }
  if (args.sourcesDir) {
    commandArgs.push("--sources-dir", path.resolve(args.sourcesDir));
  }
  if (args.dpi) {
    commandArgs.push("--dpi", String(args.dpi));
  }
  if (args.noRenderPages) {
    commandArgs.push("--no-render-pages");
  }
  if (args.noExtractImages) {
    commandArgs.push("--no-extract-images");
  }
  if (args.noCopySource) {
    commandArgs.push("--no-copy-source");
  }

  const { stdout, stderr } = await execFileAsync(command, commandArgs, {
    maxBuffer: 200 * 1024 * 1024,
  });
  if (stdout) {
    process.stdout.write(stdout);
  }
  if (stderr) {
    process.stderr.write(stderr);
  }
}

async function runCoreReviewQuiz(questionBankPath, args) {
  const questionBank = await loadCoreReviewQuestionBank(questionBankPath);
  const session = buildCoreReviewQuizSession(questionBank, {
    count: args.quizCount,
    domain: args.domain || "",
    questionType: args.questionType || "",
    seed: args.seed || "",
  });

  if (args.format === "text") {
    process.stdout.write(renderCoreReviewQuizText(session));
    return;
  }

  process.stdout.write(`${JSON.stringify(session, null, 2)}\n`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }

  if (args.coreReviewSchema) {
    await runCoreReviewSchema();
    return;
  }
  if (args.coreReviewIngest) {
    await runCoreReviewIngest(args.coreReviewIngest, args);
    return;
  }
  if (args.coreReviewIngestPdf) {
    await runCoreReviewIngestPdf(args.coreReviewIngestPdf, args);
    return;
  }
  if (args.coreReviewQuiz) {
    await runCoreReviewQuiz(args.coreReviewQuiz, args);
    return;
  }

  if (args.probeInput) {
    await runProbe(args.probeInput);
    return;
  }
  if (args.prepareInput) {
    await runPrepare(args.prepareInput, args);
    return;
  }
  if (args.renderInput) {
    await runRender(args.renderInput, args);
    return;
  }

  throw new Error(`No internal GUI command was provided.\n\n${usage()}`);
}

main().catch((error) => {
  console.error(error.message || String(error));
  process.exit(1);
});
