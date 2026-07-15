import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizePhoneNumber,
  reconnectDelay,
  timingSafeTokenMatch,
  validateAccountId
} from "../src/utils.js";

test("normalizes phone numbers", () => {
  assert.equal(normalizePhoneNumber("+234 801 234 5678"), "2348012345678");
});

test("rejects invalid phone numbers", () => {
  assert.throws(() => normalizePhoneNumber("123"));
});

test("validates account ids", () => {
  assert.equal(validateAccountId("personal_1"), "personal_1");
  assert.throws(() => validateAccountId("../bad"));
});

test("backoff is bounded", () => {
  assert.equal(reconnectDelay(0, 3000, 300000, 0, () => 0.5), 3000);
  assert.equal(reconnectDelay(20, 3000, 300000, 0, () => 0.5), 300000);
});

test("token comparison", () => {
  assert.equal(timingSafeTokenMatch("abc", "abc"), true);
  assert.equal(timingSafeTokenMatch("abc", "abcd"), false);
  assert.equal(timingSafeTokenMatch("abc", "xyz"), false);
});
