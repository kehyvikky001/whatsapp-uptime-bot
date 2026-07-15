import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  decryptText,
  encryptText,
  isEncryptedEnvelope,
  parseEncryptionKey,
  readEncryptedJson,
  writeEncryptedJson
} from "../src/crypto-store.js";

const key = Buffer.alloc(32, 7);

test("parses base64 and hex encryption keys", () => {
  assert.deepEqual(parseEncryptionKey(key.toString("base64")), key);
  assert.deepEqual(parseEncryptionKey(key.toString("hex")), key);
  assert.throws(() => parseEncryptionKey("bad"));
});

test("encrypts with authenticated additional data", () => {
  const payload = encryptText("secret", key, "file-a");
  assert.equal(isEncryptedEnvelope(payload), true);
  assert.equal(decryptText(payload, key, "file-a"), "secret");
  assert.throws(() => decryptText(payload, key, "file-b"));
});

test("writes and reads encrypted JSON atomically", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "crypto-store-"));
  const file = path.join(dir, "data.json");
  await writeEncryptedJson(file, { ok: true }, key);
  const raw = await fs.readFile(file, "utf8");
  assert.equal(raw.includes('"ok"'), false);
  assert.deepEqual((await readEncryptedJson(file, key)).value, { ok: true });
});
