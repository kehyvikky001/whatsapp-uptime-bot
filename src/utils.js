import crypto from "node:crypto";

export class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.name = "HttpError";
    this.statusCode = statusCode;
  }
}

export function normalizePhoneNumber(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) {
    throw new HttpError(400, "phoneNumber must contain 8 to 15 digits including country code");
  }
  return digits;
}

export function validateAccountId(value) {
  const id = String(value ?? "").trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{1,63}$/.test(id)) {
    throw new HttpError(400, "id must be 2 to 64 characters using letters, digits, underscore or hyphen");
  }
  return id;
}

export function reconnectDelay(attempt, baseMs, maxMs, jitterRatio, random = Math.random) {
  const exponent = Math.max(0, Math.min(attempt, 16));
  const raw = Math.min(maxMs, baseMs * (2 ** exponent));
  const spread = raw * jitterRatio;
  return Math.max(baseMs, Math.round(raw - spread + random() * spread * 2));
}

export function timingSafeTokenMatch(supplied, expected) {
  if (typeof supplied !== "string" || typeof expected !== "string") return false;
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitFor(predicate, timeoutMs, intervalMs = 100) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = predicate();
    if (value) return value;
    await sleep(intervalMs);
  }
  return null;
}

export function publicAccount(account) {
  return {
    id: account.id,
    phoneNumber: account.phoneNumber.replace(/.(?=.{4})/g, "•"),
    enabled: account.enabled,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt
  };
}
