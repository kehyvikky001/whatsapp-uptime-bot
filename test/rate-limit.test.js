import test from "node:test";
import assert from "node:assert/strict";
import { createRateLimiter } from "../src/rate-limit.js";

function response() {
  return {
    headers: {}, statusCode: 200, payload: null,
    set(name, value) { this.headers[name] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.payload = value; return this; }
  };
}

test("rate limiter blocks excess requests", () => {
  const middleware = createRateLimiter({ windowMs: 60000, max: 2 });
  const req = { ip: "127.0.0.1" };
  let calls = 0;
  middleware(req, response(), () => { calls += 1; });
  middleware(req, response(), () => { calls += 1; });
  const third = response();
  middleware(req, third, () => { calls += 1; });
  assert.equal(calls, 2);
  assert.equal(third.statusCode, 429);
});
