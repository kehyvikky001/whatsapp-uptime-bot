import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../src/config.js";

const checks = [];
function record(name, ok, detail = "") {
  checks.push({ name, ok, detail });
}

record("Node.js >= 20", Number(process.versions.node.split(".")[0]) >= 20, process.versions.node);
record("ADMIN_TOKEN length", config.adminToken.length >= 32, `${config.adminToken.length} characters`);
record("SESSION_ENCRYPTION_KEY", config.encryptionKey.length === 32, `${config.encryptionKey.length} bytes`);

try {
  await fs.mkdir(config.dataDir, { recursive: true, mode: 0o700 });
  const probe = path.join(config.dataDir, `.preflight-${process.pid}`);
  await fs.writeFile(probe, "ok", { mode: 0o600 });
  await fs.rm(probe, { force: true });
  record("Persistent data directory writable", true, config.dataDir);
} catch (error) {
  record("Persistent data directory writable", false, error.message);
}

for (const check of checks) {
  console.log(`${check.ok ? "PASS" : "FAIL"}  ${check.name}${check.detail ? ` — ${check.detail}` : ""}`);
}

if (checks.some((check) => !check.ok)) process.exit(1);
