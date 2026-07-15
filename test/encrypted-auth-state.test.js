import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { useEncryptedAuthState } from "../src/encrypted-auth-state.js";

const helpers = {
  BufferJSON: {
    replacer: (_key, value) => Buffer.isBuffer(value)
      ? { type: "Buffer", data: [...value] }
      : value,
    reviver: (_key, value) => value?.type === "Buffer" && Array.isArray(value.data)
      ? Buffer.from(value.data)
      : value
  },
  initAuthCreds: () => ({ registered: false, seed: Buffer.from("seed") }),
  proto: {
    Message: {
      AppStateSyncKeyData: { fromObject: (value) => value }
    }
  }
};

test("encrypted auth state migrates plaintext credentials", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "auth-state-"));
  const key = Buffer.alloc(32, 9);
  const credsPath = path.join(dir, "creds.json");
  await fs.writeFile(credsPath, JSON.stringify({ registered: false }));

  try {
    const { state, saveCreds } = await useEncryptedAuthState(dir, key, helpers);
    assert.equal(state.creds.registered, false);
    await saveCreds();
    const raw = await fs.readFile(credsPath, "utf8");
    assert.equal(raw.includes('"registered"'), false);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("encrypted auth keys round trip and delete", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "auth-keys-"));
  const key = Buffer.alloc(32, 7);
  try {
    const { state } = await useEncryptedAuthState(dir, key, helpers);
    await state.keys.set({ session: { alpha: { value: Buffer.from("secret") } } });
    const first = await state.keys.get("session", ["alpha"]);
    assert.equal(Buffer.from(first.alpha.value).toString(), "secret");
    await state.keys.set({ session: { alpha: null } });
    const second = await state.keys.get("session", ["alpha"]);
    assert.equal(second.alpha, null);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
