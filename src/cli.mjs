import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildDeck } from "./deck.mjs";
import {
  expandCaseRequests,
  fetchRadiopaediaCase,
  inspectRadiopaediaCaseCandidates,
  parseCaseRequest,
  saveRandomHistory,
} from "./radiopaedia.mjs";
import { collapseWhitespace, formatTimestamp, slugify } from "./utils.mjs";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

function usage() {
  return [
    "Usage:",
    '  node src/cli.mjs --diagnosis "multiple sclerosis, mri brain"',
    "  node src/cli.mjs --input diagnoses.txt [--title \"Resident Review\"] [--out outputs\\deck.pptx]",
    "  node src/cli.mjs --probe-input diagnoses.json",
    "  node src/cli.mjs --prepare-input requests.json [--images-per-case 3]",
    "  node src/cli.mjs --render-input prepared.json [--title \"Resident Review\"] [--out outputs\\deck.pptx] [--theme classic] [--include-teaching-points]",
  ].join("\n");
}

function parseArgs(argv) {
  const args = {
    diagnoses: [],
    imagesPerCase: 3,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--diagnosis") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --diagnosis");
      }
      args.diagnoses.push(value);
      index += 1;
      continue;
    }
    if (arg === "--input") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --input");
      }
      args.input = value;
      index += 1;
      continue;
    }
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

async function loadEntries(inputPath) {
  const raw = await fs.readFile(inputPath, "utf8");
  const trimmed = raw.trim();

  if (!trimmed) {
    return [];
  }

  if (trimmed.startsWith("[")) {
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) {
      throw new Error("JSON input must be an array.");
    }
    return parsed;
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

function toManifest(cases, entries, deckTitle) {
  return {
    createdAt: new Date().toISOString(),
    deckTitle,
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

async function prepareCaseItems(rawEntries, args, { readRandomHistory = true, writeRandomHistory = false } = {}) {
  let entries = normalizeEntries(rawEntries).map((entry) =>
    parseCaseRequest({
      ...entry,
      includeClinicalHistory: Boolean(args.useClinicalHistory),
      useOllamaAssist: Boolean(args.useOllamaAssist),
    }),
  );
  entries = await expandCaseRequests(entries, {
    readRandomHistory,
    writeRandomHistory,
  });

  const cacheDir = path.join(PROJECT_ROOT, "cache");
  const items = [];
  const failures = [];

  for (const entry of entries) {
    try {
      const caseData = await fetchRadiopaediaCase(entry, {
        cacheDir,
        imagesPerCase: entry.requestedImagesPerCase || args.imagesPerCase,
      });
      items.push({ request: entry, caseData });
    } catch (error) {
      failures.push(`Unable to prepare case for "${entry.rawInput}": ${error.message}`);
    }
  }

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
    path.resolve(args.out || path.join(PROJECT_ROOT, "outputs", `${fileStem}.pptx`)),
  );
  const manifestPath = path.join(path.dirname(outputPath), `${path.parse(outputPath).name}.json`);
  const scratchDir = path.join(PROJECT_ROOT, "scratch", path.parse(outputPath).name);

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(
    manifestPath,
    `${JSON.stringify(toManifest(cases, entries, deckTitle), null, 2)}\n`,
    "utf8",
  );

  const result = await buildDeck({
    cases,
    deckTitle,
    outputPath,
    scratchDir,
    theme: args.theme || "classic",
    includeTeachingPoints: Boolean(args.includeTeachingPoints),
  });

  await rememberRandomHistoryFromPreparedItems(items);

  console.log(`Created PowerPoint: ${result.outputPath}`);
  console.log(`Created manifest: ${manifestPath}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
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

  let entries = normalizeEntries(args.diagnoses);
  if (args.input) {
    const fromFile = normalizeEntries(await loadEntries(path.resolve(args.input)));
    entries = normalizeEntries(entries.concat(fromFile));
  }

  if (!entries.length) {
    throw new Error(`No diagnoses provided.\n\n${usage()}`);
  }

  const prepared = await prepareCaseItems(entries, args, {
    readRandomHistory: true,
    writeRandomHistory: false,
  });
  const cases = prepared.items.map((item) => item.caseData);

  if (!cases.length) {
    throw new Error("No cases could be built from the supplied diagnoses.");
  }

  const tempPath = path.join(PROJECT_ROOT, "scratch", `prepared-${formatTimestamp()}.json`);
  await fs.mkdir(path.dirname(tempPath), { recursive: true });
  await fs.writeFile(tempPath, `${JSON.stringify({ items: prepared.items }, null, 2)}\n`, "utf8");
  try {
    await runRender(tempPath, args);
  } finally {
    await fs.rm(tempPath, { force: true });
  }

  if (prepared.failures.length) {
    console.log("Warnings:");
    for (const failure of prepared.failures) {
      console.log(`- ${failure}`);
    }
  }
}

main().catch((error) => {
  console.error(error.message || String(error));
  process.exit(1);
});
