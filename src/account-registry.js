import fs from "node:fs/promises";
import path from "node:path";
import { normalizePhoneNumber, validateAccountId } from "./utils.js";

export class AccountRegistry {
  constructor(filePath) {
    this.filePath = filePath;
    this.accounts = new Map();
    this.writeChain = Promise.resolve();
  }

  async load() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });

    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) throw new Error("accounts file must contain an array");

      for (const account of parsed) {
        const id = validateAccountId(account.id);
        this.accounts.set(id, {
          id,
          phoneNumber: normalizePhoneNumber(account.phoneNumber),
          enabled: account.enabled !== false,
          createdAt: account.createdAt || new Date().toISOString(),
          updatedAt: account.updatedAt || new Date().toISOString()
        });
      }
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      await this.persist();
    }
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

    if (this.accounts.has(id)) throw new Error(`account ${id} already exists`);

    const now = new Date().toISOString();
    const account = { id, phoneNumber, enabled: true, createdAt: now, updatedAt: now };
    this.accounts.set(id, account);
    await this.persist();
    return account;
  }

  async setEnabled(id, enabled) {
    id = validateAccountId(id);
    const account = this.accounts.get(id);
    if (!account) throw new Error(`account ${id} was not found`);

    account.enabled = Boolean(enabled);
    account.updatedAt = new Date().toISOString();
    await this.persist();
    return account;
  }

  async remove(id) {
    id = validateAccountId(id);
    const existed = this.accounts.delete(id);
    if (existed) await this.persist();
    return existed;
  }

  async persist() {
    const payload = JSON.stringify(this.list(), null, 2) + "\n";
    const tempPath = `${this.filePath}.tmp`;

    this.writeChain = this.writeChain.then(async () => {
      await fs.writeFile(tempPath, payload, { mode: 0o600 });
      await fs.rename(tempPath, this.filePath);
    });

    return this.writeChain;
  }
}
