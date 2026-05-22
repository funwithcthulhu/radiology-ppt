import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";

const SERVICE_RESPONSE_TIMEOUT_MS = 45000;

test("backend service responds to structured ping requests", async () => {
  const servicePath = path.resolve("src", "backend-service.mjs");
  const child = spawn(process.execPath, [servicePath], {
    cwd: process.cwd(),
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      NODE_NO_WARNINGS: "1",
    },
  });

  const stderr = [];
  child.stderr.on("data", (chunk) => stderr.push(chunk.toString("utf8")));

  try {
    const lines = readline.createInterface({
      input: child.stdout,
      crlfDelay: Infinity,
    });
    const responsePromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Timed out waiting for backend service ping")),
        SERVICE_RESPONSE_TIMEOUT_MS,
      );
      lines.once("line", (line) => {
        clearTimeout(timeout);
        resolve(JSON.parse(line));
      });
    });

    child.stdin.write(
      `${JSON.stringify({ id: "ping-1", command: "ping", payload: {} })}\n`,
    );
    const response = await responsePromise;
    assert.equal(response.id, "ping-1");
    assert.equal(response.type, "result");
    assert.equal(response.payload.ok, true);
    assert.equal(response.payload.protocolVersion, 1);
    assert.equal(typeof response.payload.uptimeMs, "number");
    assert.equal(response.payload.handledRequests, 1);
  } finally {
    child.kill();
  }

  assert.equal(stderr.join("").trim(), "");
});

test("backend service accepts BOM-prefixed first requests", async () => {
  const servicePath = path.resolve("src", "backend-service.mjs");
  const child = spawn(process.execPath, [servicePath], {
    cwd: process.cwd(),
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      NODE_NO_WARNINGS: "1",
    },
  });

  const stderr = [];
  child.stderr.on("data", (chunk) => stderr.push(chunk.toString("utf8")));

  try {
    const lines = readline.createInterface({
      input: child.stdout,
      crlfDelay: Infinity,
    });
    const responsePromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () =>
          reject(
            new Error(
              "Timed out waiting for BOM-prefixed backend service ping",
            ),
          ),
        SERVICE_RESPONSE_TIMEOUT_MS,
      );
      lines.once("line", (line) => {
        clearTimeout(timeout);
        resolve(JSON.parse(line));
      });
    });

    child.stdin.write(
      `\ufeff${JSON.stringify({ id: "ping-bom", command: "ping", payload: {} })}\n`,
    );
    const response = await responsePromise;
    assert.equal(response.id, "ping-bom");
    assert.equal(response.type, "result");
    assert.equal(response.payload.ok, true);
  } finally {
    child.kill();
  }

  assert.equal(stderr.join("").trim(), "");
});

test("backend service returns render validation errors without stack frames", async () => {
  const tempDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "radiology-service-error-"),
  );
  const servicePath = path.resolve("src", "backend-service.mjs");
  const child = spawn(process.execPath, [servicePath], {
    cwd: process.cwd(),
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      NODE_NO_WARNINGS: "1",
      RADIOLOGY_PPT_APP_ROOT: tempDir,
      RADIOLOGY_PPT_DATABASE_PATH: path.join(tempDir, "state.sqlite"),
    },
  });

  const stderr = [];
  child.stderr.on("data", (chunk) => stderr.push(chunk.toString("utf8")));

  try {
    const lines = readline.createInterface({
      input: child.stdout,
      crlfDelay: Infinity,
    });
    const responsePromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () =>
          reject(
            new Error(
              "Timed out waiting for backend service render validation error",
            ),
          ),
        SERVICE_RESPONSE_TIMEOUT_MS,
      );
      lines.on("line", (line) => {
        const response = JSON.parse(line);
        if (response.type !== "error") {
          return;
        }
        clearTimeout(timeout);
        resolve(response);
      });
    });

    child.stdin.write(
      `${JSON.stringify({
        id: "render-empty",
        command: "render",
        payload: { items: [], args: {} },
      })}\n`,
    );
    const response = await responsePromise;
    assert.equal(response.id, "render-empty");
    assert.equal(response.type, "error");
    assert.equal(response.error, "No prepared cases were provided for render.");
    assert.doesNotMatch(response.error, /backend-api\.mjs|at renderPowerPoint/);
  } finally {
    child.kill();
  }

  assert.equal(stderr.join("").trim(), "");
});
