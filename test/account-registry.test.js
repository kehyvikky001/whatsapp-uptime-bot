import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AccountRegistry } from "../src/account-registry.js";

const key = Buffer.alloc(32, 3);

async function registryFixture() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "account-registry-"));
  return {
    dir,
    registry: new AccountRegistry({
      filePath: path.join(dir, "accounts.enc.json"),
      legacyFilePath: path.join(dir, "accounts.json"),
      encryptionKey: key
    })
  };
}

test("persists account changes in encrypted form", async () => {
  const { dir, registry } = await registryFixture();
  await registry.load();
  await registry.add({ id: "main_1", phoneNumber: "+234 801 234 5678" });
  await registry.setEnabled("main_1", false);

  const raw = await fs.readFile(path.join(dir, "accounts.enc.json"), "utf8");
  assert.equal(raw.includes("2348012345678"), false);

  const reloaded = new AccountRegistry({
    filePath: path.join(dir, "accounts.enc.json"),
    legacyFilePath: path.join(dir, "accounts.json"),
    encryptionKey: key
  });
  await reloaded.load();
  assert.equal(reloaded.get("main_1").enabled, false);
});

test("migrates plaintext legacy account records", async () => {
  const { dir, registry } = await registryFixture();
  await fs.writeFile(path.join(dir, "accounts.json"), JSON.stringify([
    { id: "legacy_1", phoneNumber: "2348012345678", enabled: true }
  ]));
  await registry.load();
  assert.equal(registry.get("legacy_1").phoneNumber, "2348012345678");
  const encrypted = await fs.readFile(path.join(dir, "accounts.enc.json"), "utf8");
  assert.equal(encrypted.includes("2348012345678"), false);
});
