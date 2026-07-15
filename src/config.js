import "./load-env.js";
import path from "node:path";
import { parseEncryptionKey } from "./crypto-store.js";

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

function boolean(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  if (/^(1|true|yes)$/i.test(raw)) return true;
  if (/^(0|false|no)$/i.test(raw)) return false;
  throw new Error(`${name} must be true or false`);
}

function optionalUrl(name) {
  const raw = process.env[name]?.trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol)) throw new Error();
    return url.toString();
  } catch {
    throw new Error(`${name} must be a valid HTTP or HTTPS URL`);
  }
}

const adminToken = process.env.ADMIN_TOKEN?.trim();
if (!adminToken || adminToken.length < 32) {
  throw new Error("ADMIN_TOKEN must be at least 32 characters");
}

const encryptionKey = parseEncryptionKey(process.env.SESSION_ENCRYPTION_KEY);
const dataDir = path.resolve(process.env.DATA_DIR || "./data");

export const config = Object.freeze({
  host: process.env.HOST || "0.0.0.0",
  port: integer("PORT", 8080, 1, 65535),
  logLevel: process.env.LOG_LEVEL || "info",
  adminToken,
  encryptionKey,
  dataDir,
  accountsFile: path.join(dataDir, "accounts.enc.json"),
  legacyAccountsFile: path.join(dataDir, "accounts.json"),
  sessionsDir: path.join(dataDir, "sessions"),
  reconnectBaseMs: integer("RECONNECT_BASE_MS", 3000, 1000, 60000),
  reconnectMaxMs: integer("RECONNECT_MAX_MS", 300000, 10000, 3600000),
  reconnectJitter: number("RECONNECT_JITTER", 0.25, 0, 1),
  pairingReadyTimeoutMs: integer("PAIRING_READY_TIMEOUT_MS", 15000, 1000, 120000),
  pairingCooldownMs: integer("PAIRING_COOLDOWN_MS", 30000, 0, 3600000),
  versionCacheMs: integer("VERSION_CACHE_MS", 3600000, 60000, 86400000),
  versionFetchTimeoutMs: integer("VERSION_FETCH_TIMEOUT_MS", 10000, 1000, 60000),
  watchdogIntervalMs: integer("WATCHDOG_INTERVAL_MS", 60000, 5000, 3600000),
  staleConnectingMs: integer("STALE_CONNECTING_MS", 180000, 30000, 3600000),
  alertAfterReconnectAttempts: integer("ALERT_AFTER_RECONNECT_ATTEMPTS", 3, 1, 100),
  alertWebhookUrl: optionalUrl("ALERT_WEBHOOK_URL"),
  alertWebhookBearer: process.env.ALERT_WEBHOOK_BEARER?.trim() || "",
  alertTimeoutMs: integer("ALERT_TIMEOUT_MS", 10000, 1000, 60000),
  alertCooldownMs: integer("ALERT_COOLDOWN_MS", 300000, 0, 86400000),
  publicStatus: boolean("PUBLIC_STATUS", false),
  trustProxy: boolean("TRUST_PROXY", false),
  adminRateLimitMax: integer("ADMIN_RATE_LIMIT_MAX", 120, 1, 10000),
  adminRateLimitWindowMs: integer("ADMIN_RATE_LIMIT_WINDOW_MS", 60000, 1000, 3600000),
  pairingRateLimitMax: integer("PAIRING_RATE_LIMIT_MAX", 5, 1, 100),
  pairingRateLimitWindowMs: integer("PAIRING_RATE_LIMIT_WINDOW_MS", 300000, 1000, 3600000),
  shutdownTimeoutMs: integer("SHUTDOWN_TIMEOUT_MS", 20000, 1000, 120000)
});
