import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const target = path.resolve(process.argv[2] || ".env");
try {
  await fs.access(target);
  console.error(`${target} already exists; refusing to overwrite it`);
  process.exit(1);
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

const adminToken = crypto.randomBytes(32).toString("hex");
const encryptionKey = crypto.randomBytes(32).toString("base64");
const content = `HOST=0.0.0.0
PORT=8080
LOG_LEVEL=info
ADMIN_TOKEN=${adminToken}
SESSION_ENCRYPTION_KEY=${encryptionKey}
DATA_DIR=./data
RECONNECT_BASE_MS=3000
RECONNECT_MAX_MS=300000
RECONNECT_JITTER=0.25
PAIRING_READY_TIMEOUT_MS=15000
PAIRING_COOLDOWN_MS=30000
VERSION_CACHE_MS=3600000
VERSION_FETCH_TIMEOUT_MS=10000
WATCHDOG_INTERVAL_MS=60000
STALE_CONNECTING_MS=180000
ALERT_AFTER_RECONNECT_ATTEMPTS=3
ALERT_WEBHOOK_URL=
ALERT_WEBHOOK_BEARER=
ALERT_TIMEOUT_MS=10000
ALERT_COOLDOWN_MS=300000
PUBLIC_STATUS=false
TRUST_PROXY=false
ADMIN_RATE_LIMIT_MAX=120
ADMIN_RATE_LIMIT_WINDOW_MS=60000
PAIRING_RATE_LIMIT_MAX=5
PAIRING_RATE_LIMIT_WINDOW_MS=300000
SHUTDOWN_TIMEOUT_MS=20000
`;

await fs.writeFile(target, content, { mode: 0o600, flag: "wx" });
console.log(`Created ${target} with restrictive permissions.`);
console.log("Store SESSION_ENCRYPTION_KEY in a password manager before pairing accounts.");
