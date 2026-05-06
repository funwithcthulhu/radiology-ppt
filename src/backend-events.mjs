export function emitBackendEvent(type, message, detail = {}) {
  const payload = {
    type,
    message,
    detail,
    createdAt: new Date().toISOString(),
  };
  if (typeof globalThis.__radiologyPptEmitEvent === "function") {
    globalThis.__radiologyPptEmitEvent(payload);
    return;
  }
  process.stderr.write(`RP_EVENT ${JSON.stringify(payload)}\n`);
}

export function emitProgress(message, detail = {}) {
  emitBackendEvent("progress", message, detail);
}

export function emitWarning(message, detail = {}) {
  emitBackendEvent("warning", message, detail);
}

function formatDuration(durationMs) {
  if (!Number.isFinite(durationMs)) {
    return "";
  }
  if (durationMs < 1000) {
    return `${Math.round(durationMs)} ms`;
  }
  return `${(durationMs / 1000).toFixed(1)} s`;
}

export async function withBackendStage(
  message,
  detail,
  callback,
  options = {},
) {
  const stageDetail = detail && typeof detail === "object" ? detail : {};
  const startedAt = Date.now();
  emitBackendEvent("stage-start", message, stageDetail);

  try {
    const result = await callback();
    const durationMs = Date.now() - startedAt;
    emitBackendEvent(
      "stage-complete",
      `Completed ${message} (${formatDuration(durationMs)})`,
      {
        ...stageDetail,
        durationMs,
      },
    );
    return result;
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    const errorType = options.errorType || "stage-error";
    const errorVerb = options.errorVerb || "Failed";
    emitBackendEvent(
      errorType,
      `${errorVerb} ${message} (${formatDuration(durationMs)})`,
      {
        ...stageDetail,
        durationMs,
        error: error?.message || String(error),
      },
    );
    throw error;
  }
}
