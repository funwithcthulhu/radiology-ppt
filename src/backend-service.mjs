import readline from "node:readline";
import {
  buildCoreReviewQuizFromFile,
  getCoreReviewSchema,
  ingestCoreReviewPdfFiles,
  ingestCoreReviewTextFiles,
  prepareCoreReviewDeck,
  prepareCases,
  renderCoreReviewQuizSessionText,
  renderPowerPoint,
  scoreImages,
} from "./backend-api.mjs";
import { recordBackendJobFinish, recordBackendJobStart } from "./app-store.mjs";

process.env.RADIOLOGY_PPT_BACKEND_SERVICE = "1";

const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

let queue = Promise.resolve();
const serviceStartedAt = Date.now();
let handledRequests = 0;
let lastRequestAt = null;

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
      handledRequests,
      startedAt: new Date(serviceStartedAt).toISOString(),
      uptimeMs: Date.now() - serviceStartedAt,
      lastRequestAt: lastRequestAt
        ? new Date(lastRequestAt).toISOString()
        : null,
    };
  }
  if (command === "prepare") {
    return prepareCases(payload.entries || [], args);
  }
  if (command === "coreReviewPrepareDeck") {
    return prepareCoreReviewDeck(args);
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
    const session = await buildCoreReviewQuizFromFile(
      payload.questionBankPath,
      args,
    );
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
  const cleanLine = line.charCodeAt(0) === 0xfeff ? line.slice(1) : line;
  if (!cleanLine.trim()) {
    return;
  }

  let request;
  try {
    request = JSON.parse(cleanLine);
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
      message:
        "Cancel requested; host will restart the backend service if needed.",
      detail: {},
      createdAt: new Date().toISOString(),
    });
    send({ id, type: "result", payload: { ok: true } });
    return;
  }

  try {
    handledRequests += 1;
    lastRequestAt = Date.now();
    const shouldRecordJob = request.command !== "ping";
    if (shouldRecordJob) {
      await recordBackendJobStart({
        jobId: id,
        command: String(request.command || ""),
        detail: {
          payloadKeys: Object.keys(request.payload || {}),
        },
      });
    }
    const payload = await withJobEvents(id, () =>
      runCommand(request.command, request.payload || {}),
    );
    if (shouldRecordJob) {
      await recordBackendJobFinish({
        jobId: id,
        status: "completed",
        summary: `Completed ${request.command}`,
        detail: summarizeResultPayload(payload),
      });
    }
    send({ id, type: "result", payload });
  } catch (error) {
    if (request.command !== "ping") {
      await recordBackendJobFinish({
        jobId: id,
        status: "failed",
        summary: `Failed ${request.command}`,
        error: error?.message || String(error),
      });
    }
    send({
      id,
      type: "error",
      error: error?.stack || error?.message || String(error),
    });
  }
}

function summarizeResultPayload(payload) {
  if (!payload || typeof payload !== "object") {
    return {};
  }
  return {
    itemCount: Array.isArray(payload.items) ? payload.items.length : undefined,
    failureCount: Array.isArray(payload.failures)
      ? payload.failures.length
      : undefined,
    planCaseCount: payload.plan?.plannedCaseCount,
    outputPath:
      typeof payload.outputPath === "string" ? payload.outputPath : undefined,
    manifestPath:
      typeof payload.manifestPath === "string"
        ? payload.manifestPath
        : undefined,
  };
}

rl.on("line", (line) => {
  queue = queue.then(
    () => handleLine(line),
    () => handleLine(line),
  );
});

rl.on("close", () => {
  process.exit(0);
});
