import test from "node:test";
import assert from "node:assert/strict";
import { cachedValue } from "../src/cache-store.mjs";

test("persistent cache reuses stored values", async () => {
  const key = { id: `cache-test-${Date.now()}` };
  let calls = 0;
  const first = await cachedValue(
    "unit-test",
    key,
    async () => {
      calls += 1;
      return { value: "fresh" };
    },
    { ttlMs: 60_000 },
  );
  const second = await cachedValue(
    "unit-test",
    key,
    async () => {
      calls += 1;
      return { value: "unexpected" };
    },
    { ttlMs: 60_000 },
  );

  assert.deepEqual(first, { value: "fresh" });
  assert.deepEqual(second, { value: "fresh" });
  assert.equal(calls, 1);
});
