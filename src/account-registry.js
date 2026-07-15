import fs from "node:fs/promises";
import path from "node:path";
import { readEncryptedJson, writeEncryptedJson } from "./crypto-store.js";
import { HttpError, normalizePhoneNumber, validateAccountId } from "./utils.js";

export class AccountRegistry {
  constructor({ filePath, legacyFilePath, encryptionKey }) {
    this.filePath = filePath;
    this.legacyFilePath = legacyFilePath;
    this.encryptionKey = encryptionKey;
    this.accounts = new Map();
    this.writeChain = Promise.resolve();
  }

  async load() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true, mode: 0o700 });

    let sourcePath = this.filePath;
    let allowPlaintextMigration = false;
    try {
      await fs.access(sourcePath);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      sourcePath = this.legacyFilePath;
      allowPlaintextMigration = true;
    }

    try {
      const { value, migrated } = await readEncryptedJson(sourcePath, this.encryptionKey, {
        allowPlaintextMigration
      });
      if (!Array.isArray(value)) throw new Error("accounts store must contain an array");
      this.accounts = this.mapFrom(value);

      if (migrated || sourcePath !== this.filePath) {
        await this.persistMap(this.accounts);
        if (sourcePath === this.legacyFilePath) {
          await fs.rm(this.legacyFilePath, { force: true });
        }
      }
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      this.accounts = new Map();
      await this.persistMap(this.accounts);
    }
  }

  mapFrom(items) {
    const map = new Map();
    for (const account of items) {
      const id = validateAccountId(account.id);
      map.set(id, {
        id,
        phoneNumber: normalizePhoneNumber(account.phoneNumber),
        enabled: account.enabled !== false,
        createdAt: account.createdAt || new Date().toISOString(),
        updatedAt: account.updatedAt || new Date().toISOString()
      });
    }
    return map;
  }

  list() {
    return [...this.accounts.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  get(id) {
    return this.accounts.get(validateAccountId(id)) || null;
  }

  async add({ id, phoneNumber }) {
    id = validateAccountId(id);
    phoneNumber = normalizePhoneNumber(phoneNumber);
    if (this.accounts.has(id)) throw new HttpError(409, `account ${id} already exists`);

    const next = new Map(this.accounts);
    const now = new Date().toISOString();
    const account = { id, phoneNumber, enabled: true, createdAt: now, updatedAt: now };
    next.set(id, account);
    await this.persistMap(next);
    this.accounts = next;
    return account;
  }

  async setEnabled(id, enabled) {
    id = validateAccountId(id);
    const existing = this.accounts.get(id);
    if (!existing) throw new HttpError(404, `account ${id} was not found`);

    const next = new Map(this.accounts);
    const account = {
      ...existing,
      enabled: Boolean(enabled),
      updatedAt: new Date().toISOString()
    };
    next.set(id, account);
    await this.persistMap(next);
    this.accounts = next;
    return account;
  }

  async remove(id) {
    id = validateAccountId(id);
    if (!this.accounts.has(id)) return false;
    const next = new Map(this.accounts);
    next.delete(id);
    await this.persistMap(next);
    this.accounts = next;
    return true;
  }

  async persistMap(map) {
    const payload = [...map.values()].sort((a, b) => a.id.localeCompare(b.id));
    this.writeChain = this.writeChain
      .catch(() => {})
      .then(() => writeEncryptedJson(this.filePath, payload, this.encryptionKey));
    return this.writeChain;
  }
}
