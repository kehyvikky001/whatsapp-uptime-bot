import test from "node:test";
import assert from "node:assert/strict";
import { AlertSink } from "../src/alerts.js";

test("disabled alert sink is a no-op", async () => {
  const sink = new AlertSink({
    url: "", bearerToken: "", timeoutMs: 1000, cooldownMs: 1000,
    logger: { warn() {} }
  });
  assert.equal(await sink.send("test", {}), false);
});

test("successful alerts are deduplicated during cooldown", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return { ok: true }; };
  try {
    const sink = new AlertSink({
      url: "https://alerts.example.test/hook",
      bearerToken: "token",
      timeoutMs: 1000,
      cooldownMs: 60000,
      logger: { warn() {} }
    });
    assert.equal(await sink.send("logout", { accountId: "a" }), true);
    assert.equal(await sink.send("logout", { accountId: "a" }), false);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("failed alert delivery can be retried", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; throw new Error("offline"); };
  try {
    const sink = new AlertSink({
      url: "https://alerts.example.test/hook",
      bearerToken: "",
      timeoutMs: 1000,
      cooldownMs: 60000,
      logger: { warn() {} }
    });
    assert.equal(await sink.send("logout", { accountId: "a" }), false);
    assert.equal(await sink.send("logout", { accountId: "a" }), false);
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
