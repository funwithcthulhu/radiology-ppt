import readline from "node:readline";
import {
  buildCoreReviewQuizFromFile,
  getCoreReviewSchema,
  ingestCoreReviewPdfFiles,
  ingestCoreReviewTextFiles,
  prepareCases,
  probeCasesFromFile,
  renderCoreReviewQuizSessionText,
  renderPowerPoint,
  scoreImages,
} from "./backend-api.mjs";

process.env.RADIOLOGY_PPT_BACKEND_SERVICE = "1";

const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

let queue = Promise.resolve();

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function eventFor(id, payload) {
  send({
    id,
    type: "event",
    payload,
  });
}

async function withJobEvents(id, action) {
  const previousEmitter = globalThis.__radiologyPptEmitEvent;
  globalThis.__radiologyPptEmitEvent = (payload) => eventFor(id, payload);
  try {
    return await action();
  } finally {
    if (previousEmitter) {
      globalThis.__radiologyPptEmitEvent = previousEmitter;
    } else {
      delete globalThis.__radiologyPptEmitEvent;
    }
  }
}

async function runCommand(command, payload = {}) {
  const args = payload.args || {};
  if (command === "ping") {
    return {
      ok: true,
      pid: process.pid,
      service: "radiology-ppt-backend",
      protocolVersion: 1,
    };
  }
  if (command === "prepare") {
    return prepareCases(payload.entries || [], args);
  }
  if (command === "scoreImages") {
    return scoreImages(
      payload.item ? { items: [payload.item] } : { items: payload.items || [] },
      args,
    );
  }
  if (command === "render") {
    return renderPowerPoint({ items: payload.items || [] }, args);
  }
  if (command === "probe") {
    return probeCasesFromFile(payload.inputPath);
  }
  if (command === "coreReviewSchema") {
    return getCoreReviewSchema();
  }
  if (command === "coreReviewIngest") {
    return ingestCoreReviewTextFiles(payload.inputPaths || [], args);
  }
  if (command === "coreReviewIngestPdf") {
    return ingestCoreReviewPdfFiles(payload.inputPaths || [], args);
  }
  if (command === "coreReviewQuiz") {
    const session = await buildCoreReviewQuizFromFile(payload.questionBankPath, args);
    return args.format === "text"
      ? { text: renderCoreReviewQuizSessionText(session) }
      : session;
  }
  if (command === "shutdown") {
    setImmediate(() => process.exit(0));
    return { ok: true };
  }

  throw new Error(`Unknown backend service command: ${command}`);
}

async function handleLine(line) {
  if (!line.trim()) {
    return;
  }

  let request;
  try {
    request = JSON.parse(line);
  } catch (error) {
    send({
      id: "",
      type: "error",
      error: `Could not parse backend service request JSON: ${error.message}`,
    });
    return;
  }

  const id = String(request.id || "");
  if (!id) {
    send({
      id,
      type: "error",
      error: "Backend service request is missing an id.",
    });
    return;
  }

  if (request.command === "cancel") {
    eventFor(id, {
      type: "warning",
      message: "Cancel requested; host will restart the backend service if needed.",
      detail: {},
      createdAt: new Date().toISOString(),
    });
    send({ id, type: "result", payload: { ok: true } });
    return;
  }

  try {
    const payload = await withJobEvents(id, () => runCommand(request.command, request.payload || {}));
    send({ id, type: "result", payload });
  } catch (error) {
    send({
      id,
      type: "error",
      error: error?.stack || error?.message || String(error),
    });
  }
}

rl.on("line", (line) => {
  queue = queue.then(() => handleLine(line), () => handleLine(line));
});

rl.on("close", () => {
  process.exit(0);
});
