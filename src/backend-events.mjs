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
