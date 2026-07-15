import test from "node:test";
import assert from "node:assert/strict";
import { summarizeAccountHealth } from "../src/health.js";

test("idle service is healthy", () => {
  assert.deepEqual(summarizeAccountHealth([]), {
    state: "idle", enabled: 0, connected: 0, actionRequired: 0, healthy: true
  });
});

test("all enabled accounts connected is healthy", () => {
  assert.equal(summarizeAccountHealth([
    { enabled: true, status: "connected" },
    { enabled: false, status: "stopped" }
  ]).state, "healthy");
});

test("logged out account requires action", () => {
  const result = summarizeAccountHealth([{ enabled: true, status: "logged_out" }]);
  assert.equal(result.state, "action_required");
  assert.equal(result.healthy, false);
});
