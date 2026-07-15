import "dotenv/config";
import path from "node:path";

function integer(name, fallback, min, max) {
  const raw = process.env[name];
  const value = raw === undefined ? fallback : Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function number(name, fallback, min, max) {
  const raw = process.env[name];
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${name} must be a number between ${min} and ${max}`);
  }
  return value;
}

const adminToken = process.env.ADMIN_TOKEN?.trim();
if (!adminToken || adminToken.length < 24) {
  throw new Error("ADMIN_TOKEN must be at least 24 characters");
}

const dataDir = path.resolve(process.env.DATA_DIR || "./data");

export const config = Object.freeze({
  port: integer("PORT", 8080, 1, 65535),
  logLevel: process.env.LOG_LEVEL || "info",
  adminToken,
  dataDir,
  accountsFile: path.join(dataDir, "accounts.json"),
  sessionsDir: path.join(dataDir, "sessions"),
  reconnectBaseMs: integer("RECONNECT_BASE_MS", 3000, 1000, 60000),
  reconnectMaxMs: integer("RECONNECT_MAX_MS", 300000, 10000, 3600000),
  reconnectJitter: number("RECONNECT_JITTER", 0.25, 0, 1),
  pairingWaitMs: integer("PAIRING_WAIT_MS", 1500, 250, 15000)
});
