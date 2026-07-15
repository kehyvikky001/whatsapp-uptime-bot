import fs from "node:fs/promises";
import path from "node:path";
import {
  decryptText,
  encryptText,
  isEncryptedEnvelope,
  writeTextAtomic
} from "./crypto-store.js";

const locks = new Map();

async function withFileLock(filePath, action) {
  const previous = locks.get(filePath) || Promise.resolve();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const tail = previous.catch(() => {}).then(() => gate);
  locks.set(filePath, tail);

  await previous.catch(() => {});
  try {
    return await action();
  } finally {
    release();
    if (locks.get(filePath) === tail) locks.delete(filePath);
  }
}

function safeName(file) {
  return String(file).replace(/\//g, "__").replace(/:/g, "-");
}

async function resolveHelpers(helpers) {
  if (helpers) return helpers;
  const baileys = await import("baileys");
  return {
    BufferJSON: baileys.BufferJSON,
    initAuthCreds: baileys.initAuthCreds,
    proto: baileys.proto
  };
}

export async function useEncryptedAuthState(folder, encryptionKey, helpers) {
  const { BufferJSON, initAuthCreds, proto } = await resolveHelpers(helpers);
  await fs.mkdir(folder, { recursive: true, mode: 0o700 });
  const info = await fs.stat(folder);
  if (!info.isDirectory()) throw new Error(`${folder} is not a directory`);

  async function writeData(data, file) {
    const filePath = path.join(folder, safeName(file));
    return withFileLock(filePath, async () => {
      const plaintext = JSON.stringify(data, BufferJSON.replacer);
      const encrypted = encryptText(plaintext, encryptionKey, safeName(file));
      await writeTextAtomic(filePath, encrypted, 0o600);
    });
  }

  async function readData(file) {
    const safeFile = safeName(file);
    const filePath = path.join(folder, safeFile);
    let migrationValue = null;

    const value = await withFileLock(filePath, async () => {
      let raw;
      try {
        raw = await fs.readFile(filePath, "utf8");
      } catch (error) {
        if (error?.code === "ENOENT") return null;
        throw error;
      }

      let plaintext;
      if (isEncryptedEnvelope(raw)) {
        plaintext = decryptText(raw, encryptionKey, safeFile);
      } else {
        // One-time migration from Baileys' standard plaintext multi-file state.
        plaintext = raw;
      }

      const parsed = JSON.parse(plaintext, BufferJSON.reviver);
      if (!isEncryptedEnvelope(raw)) migrationValue = parsed;
      return parsed;
    });

    if (migrationValue !== null) await writeData(migrationValue, file);
    return value;
  }

  async function removeData(file) {
    const filePath = path.join(folder, safeName(file));
    return withFileLock(filePath, async () => {
      await fs.rm(filePath, { force: true });
    });
  }

  const creds = (await readData("creds.json")) || initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data = {};
          await Promise.all(ids.map(async (id) => {
            let value = await readData(`${type}-${id}.json`);
            if (type === "app-state-sync-key" && value) {
              value = proto.Message.AppStateSyncKeyData.fromObject(value);
            }
            data[id] = value;
          }));
          return data;
        },
        set: async (data) => {
          const tasks = [];
          for (const category of Object.keys(data)) {
            for (const id of Object.keys(data[category] || {})) {
              const value = data[category][id];
              const file = `${category}-${id}.json`;
              tasks.push(value ? writeData(value, file) : removeData(file));
            }
          }
          await Promise.all(tasks);
        }
      }
    },
    saveCreds: () => writeData(creds, "creds.json")
  };
}
