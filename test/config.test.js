import test from "node:test";
import assert from "node:assert/strict";

const original = { ...process.env };

function resetEnv() {
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, original);
}

async function loadConfig(suffix) {
  return import(`../src/config.js?test=${suffix}-${Date.now()}-${Math.random()}`);
}

test("accepts valid production secrets", async () => {
  resetEnv();
  process.env.ADMIN_TOKEN = "a".repeat(64);
  process.env.SESSION_ENCRYPTION_KEY = Buffer.alloc(32, 1).toString("base64");
  const { config } = await loadConfig("valid");
  assert.equal(config.adminToken.length, 64);
  assert.equal(config.encryptionKey.length, 32);
  resetEnv();
});

test("rejects a short admin token", async () => {
  resetEnv();
  process.env.ADMIN_TOKEN = "short";
  process.env.SESSION_ENCRYPTION_KEY = Buffer.alloc(32, 1).toString("base64");
  await assert.rejects(() => loadConfig("short-token"), /at least 32/);
  resetEnv();
});

test("rejects invalid alert URL schemes", async () => {
  resetEnv();
  process.env.ADMIN_TOKEN = "a".repeat(64);
  process.env.SESSION_ENCRYPTION_KEY = Buffer.alloc(32, 1).toString("base64");
  process.env.ALERT_WEBHOOK_URL = "file:///tmp/alert";
  await assert.rejects(() => loadConfig("bad-url"), /valid HTTP or HTTPS URL/);
  resetEnv();
});
