import {
  buildCoreReviewQuizFromFile,
  getCoreReviewSchema,
  ingestCoreReviewPdfFiles,
  ingestCoreReviewTextFiles,
  prepareCasesFromFile,
  probeCasesFromFile,
  renderCoreReviewQuizSessionText,
  renderPowerPointFromFile,
  scoreImagesFromFile,
} from "./backend-api.mjs";

function usage() {
  return [
    "This file is an internal GUI backend.",
    "Supported internal commands:",
    "  node src/cli.mjs --probe-input diagnoses.json",
    "  node src/cli.mjs --prepare-input requests.json [--images-per-case 3]",
    "  node src/cli.mjs --score-images-input prepared.json [--ollama-model moondream]",
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
      args.probeInput = readRequiredValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--prepare-input") {
      args.prepareInput = readRequiredValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--score-images-input") {
      args.scoreImagesInput = readRequiredValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--render-input") {
      args.renderInput = readRequiredValue(argv, index, arg);
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
      args.coreReviewQuiz = readRequiredValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--out") {
      args.out = readRequiredValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--title") {
      args.title = readRequiredValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--images-per-case") {
      args.imagesPerCase = readPositiveInteger(argv, index, arg);
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
      args.ollamaModel = readRequiredValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--count") {
      args.quizCount = readPositiveInteger(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--domain") {
      args.domain = readRequiredValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--question-type") {
      args.questionType = readRequiredValue(argv, index, arg);
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
      args.assetsDir = readRequiredValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--sources-dir") {
      args.sourcesDir = readRequiredValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--dpi") {
      args.dpi = readInteger(argv, index, arg, 72);
      index += 1;
      continue;
    }
    if (arg === "--max-chars") {
      args.maxChars = readInteger(argv, index, arg, 200);
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
      args.seed = readRequiredValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--source-id") {
      args.sourceId = readRequiredValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--format") {
      args.format = readRequiredValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--deck-mode") {
      args.deckMode = readRequiredValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--theme") {
      args.theme = readRequiredValue(argv, index, arg);
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

function readRequiredValue(argv, index, name) {
  const value = argv[index + 1];
  if (!value) {
    throw new Error(`Missing value for ${name}`);
  }
  return value;
}

function readPositiveInteger(argv, index, name) {
  return readInteger(argv, index, name, 1);
}

function readInteger(argv, index, name, minimum) {
  const value = Number.parseInt(argv[index + 1] ?? "", 10);
  if (!Number.isInteger(value) || value < minimum) {
    throw new Error(`${name} must be an integer of at least ${minimum}`);
  }
  return value;
}

function writeJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }

  if (args.coreReviewSchema) {
    writeJson(getCoreReviewSchema());
    return;
  }
  if (args.coreReviewIngest) {
    const corpus = await ingestCoreReviewTextFiles(args.coreReviewIngest, args);
    if (args.format === "text") {
      console.log(`Created Core Review corpus: ${corpus.outputPath}`);
      console.log(`Sources: ${corpus.sourceCount}`);
      console.log(`Chunks: ${corpus.chunkCount}`);
      return;
    }
    writeJson(corpus);
    return;
  }
  if (args.coreReviewIngestPdf) {
    const corpus = await ingestCoreReviewPdfFiles(args.coreReviewIngestPdf, args);
    if (args.format === "text") {
      console.log(`Created Core Review PDF corpus: ${corpus.outputPath}`);
      console.log(`Sources: ${corpus.sourceCount}`);
      console.log(`Assets: ${corpus.assetCount}`);
      console.log(`Chunks: ${corpus.chunkCount}`);
      return;
    }
    writeJson(corpus);
    return;
  }
  if (args.coreReviewQuiz) {
    const session = await buildCoreReviewQuizFromFile(args.coreReviewQuiz, args);
    if (args.format === "text") {
      process.stdout.write(renderCoreReviewQuizSessionText(session));
      return;
    }
    writeJson(session);
    return;
  }

  if (args.probeInput) {
    writeJson(await probeCasesFromFile(args.probeInput));
    return;
  }
  if (args.prepareInput) {
    writeJson(await prepareCasesFromFile(args.prepareInput, args));
    return;
  }
  if (args.scoreImagesInput) {
    writeJson(await scoreImagesFromFile(args.scoreImagesInput, args));
    return;
  }
  if (args.renderInput) {
    const result = await renderPowerPointFromFile(args.renderInput, args);
    console.log(`Created PowerPoint: ${result.outputPath}`);
    console.log(`Created manifest: ${result.manifestPath}`);
    return;
  }

  throw new Error(`No internal GUI command was provided.\n\n${usage()}`);
}

main().catch((error) => {
  console.error(error.message || String(error));
  process.exit(1);
});
