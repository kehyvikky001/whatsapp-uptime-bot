import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadEnv, parseEnv } from "../src/load-env.js";

test("parses quoted and unquoted environment values", () => {
  assert.deepEqual(parseEnv(`
# comment
PLAIN=value
SPACED=value with spaces # trailing comment
DOUBLE="line\\nnext"
SINGLE='literal # value'
export ENABLED=true
`), {
    PLAIN: "value",
    SPACED: "value with spaces",
    DOUBLE: "line\nnext",
    SINGLE: "literal # value",
    ENABLED: "true"
  });
});

test("loads environment without replacing existing values", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "wa-env-"));
  const file = path.join(dir, ".env");
  await fs.writeFile(file, "WA_TEST_ONE=from-file\nWA_TEST_TWO=second\n", { mode: 0o600 });

  process.env.WA_TEST_ONE = "existing";
  delete process.env.WA_TEST_TWO;
  try {
    assert.equal(loadEnv(file), true);
    assert.equal(process.env.WA_TEST_ONE, "existing");
    assert.equal(process.env.WA_TEST_TWO, "second");
  } finally {
    delete process.env.WA_TEST_ONE;
    delete process.env.WA_TEST_TWO;
    await fs.rm(dir, { recursive: true, force: true });
  }
});
