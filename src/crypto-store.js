import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const FORMAT_VERSION = 1;
const ALGORITHM = "aes-256-gcm";

export function parseEncryptionKey(value) {
  if (!value) throw new Error("SESSION_ENCRYPTION_KEY is required");

  const trimmed = value.trim();
  let key;
  if (/^[a-fA-F0-9]{64}$/.test(trimmed)) {
    key = Buffer.from(trimmed, "hex");
  } else {
    key = Buffer.from(trimmed, "base64");
  }

  if (key.length !== 32) {
    throw new Error("SESSION_ENCRYPTION_KEY must decode to exactly 32 bytes");
  }
  return key;
}

export function encryptText(plaintext, key, additionalData = "") {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  if (additionalData) cipher.setAAD(Buffer.from(additionalData));
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return JSON.stringify({
    v: FORMAT_VERSION,
    alg: ALGORITHM,
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    data: ciphertext.toString("base64")
  });
}

export function decryptText(payload, key, additionalData = "") {
  let envelope;
  try {
    envelope = typeof payload === "string" ? JSON.parse(payload) : payload;
  } catch {
    throw new Error("encrypted data is not valid JSON");
  }

  if (envelope?.v !== FORMAT_VERSION || envelope?.alg !== ALGORITHM) {
    throw new Error("unsupported encrypted data format");
  }

  try {
    const decipher = crypto.createDecipheriv(
      ALGORITHM,
      key,
      Buffer.from(envelope.iv, "base64")
    );
    if (additionalData) decipher.setAAD(Buffer.from(additionalData));
    decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(envelope.data, "base64")),
      decipher.final()
    ]).toString("utf8");
  } catch {
    throw new Error("encrypted data could not be decrypted; check SESSION_ENCRYPTION_KEY and file integrity");
  }
}

export function isEncryptedEnvelope(value) {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return parsed?.v === FORMAT_VERSION && parsed?.alg === ALGORITHM;
  } catch {
    return false;
  }
}

export async function writeTextAtomic(filePath, content, mode = 0o600) {
  const directory = path.dirname(filePath);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  await fs.chmod(directory, 0o700).catch(() => {});
  const tempPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  let handle;
  try {
    handle = await fs.open(tempPath, "wx", mode);
    await handle.writeFile(content, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    await fs.rename(tempPath, filePath);
    await fs.chmod(filePath, mode);
  } finally {
    if (handle) await handle.close().catch(() => {});
    await fs.rm(tempPath, { force: true }).catch(() => {});
  }
}

export async function readEncryptedJson(filePath, key, { allowPlaintextMigration = false } = {}) {
  const raw = await fs.readFile(filePath, "utf8");
  if (isEncryptedEnvelope(raw)) {
    return { value: JSON.parse(decryptText(raw, key, path.basename(filePath))), migrated: false };
  }

  if (!allowPlaintextMigration) {
    throw new Error(`unencrypted data found at ${filePath}`);
  }

  return { value: JSON.parse(raw), migrated: true };
}

export async function writeEncryptedJson(filePath, value, key) {
  const plaintext = JSON.stringify(value);
  const encrypted = encryptText(plaintext, key, path.basename(filePath));
  await writeTextAtomic(filePath, encrypted, 0o600);
}
