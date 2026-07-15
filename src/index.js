import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import express from "express";
import helmet from "helmet";
import pino from "pino";
import client from "prom-client";
import { AlertSink } from "./alerts.js";
import { config } from "./config.js";
import { AccountRegistry } from "./account-registry.js";
import { summarizeAccountHealth } from "./health.js";
import { createRateLimiter } from "./rate-limit.js";
import { SessionManager } from "./session-manager.js";
import { HttpError, publicAccount, timingSafeTokenMatch } from "./utils.js";

await fs.mkdir(config.dataDir, { recursive: true, mode: 0o700 });
await fs.mkdir(config.sessionsDir, { recursive: true, mode: 0o700 });
await fs.access(config.dataDir, fsConstants.W_OK).catch(async () => {
  const probe = `${config.dataDir}/.write-probe-${process.pid}`;
  await fs.writeFile(probe, "ok", { mode: 0o600 });
  await fs.rm(probe, { force: true });
});

const logger = pino({
  level: config.logLevel,
  redact: {
    paths: [
      "req.headers.authorization",
      "authorization",
      "phoneNumber",
      "*.phoneNumber",
      "pairingCode",
      "*.pairingCode",
      "encryptionKey",
      "*.encryptionKey"
    ],
    censor: "[redacted]"
  }
});

const register = new client.Registry();
client.collectDefaultMetrics({ register });
const metrics = {
  connections: new client.Gauge({
    name: "whatsapp_account_connected",
    help: "Whether a configured WhatsApp account is connected",
    labelNames: ["account"],
    registers: [register]
  }),
  reconnects: new client.Counter({
    name: "whatsapp_reconnect_attempts_total",
    help: "Reconnect attempts",
    labelNames: ["account"],
    registers: [register]
  }),
  disconnects: new client.Counter({
    name: "whatsapp_disconnects_total",
    help: "Observed disconnects",
    labelNames: ["account"],
    registers: [register]
  }),
  watchdogRecoveries: new client.Counter({
    name: "whatsapp_watchdog_recoveries_total",
    help: "Sessions restarted by the stale-connection watchdog",
    labelNames: ["account"],
    registers: [register]
  })
};

const alerts = new AlertSink({
  url: config.alertWebhookUrl,
  bearerToken: config.alertWebhookBearer,
  timeoutMs: config.alertTimeoutMs,
  cooldownMs: config.alertCooldownMs,
  logger
});

const registry = new AccountRegistry({
  filePath: config.accountsFile,
  legacyFilePath: config.legacyAccountsFile,
  encryptionKey: config.encryptionKey
});
await registry.load();

const manager = new SessionManager({
  registry,
  sessionsDir: config.sessionsDir,
  logger,
  metrics,
  config,
  alerts
});
await manager.startEnabledAccounts();

const app = express();
app.disable("x-powered-by");
if (config.trustProxy) app.set("trust proxy", 1);
app.use(helmet());
app.use(express.json({ limit: "32kb", strict: true }));

function adminOnly(req, res, next) {
  const header = req.get("authorization");
  const supplied = header?.startsWith("Bearer ") ? header.slice(7) : "";
  if (!timingSafeTokenMatch(supplied, config.adminToken)) {
    return res.status(401).json({ error: "unauthorized" });
  }
  return next();
}

const adminRateLimit = createRateLimiter({
  windowMs: config.adminRateLimitWindowMs,
  max: config.adminRateLimitMax
});
const pairingRateLimit = createRateLimiter({
  windowMs: config.pairingRateLimitWindowMs,
  max: config.pairingRateLimitMax,
  key: (req) => `${req.ip || "unknown"}:${req.params.id || "unknown"}`
});

app.get("/live", async (_req, res) => {
  try {
    await fs.access(config.dataDir, fsConstants.W_OK);
    res.status(200).json({ live: true, uptimeSeconds: Math.floor(process.uptime()) });
  } catch {
    res.status(503).json({ live: false });
  }
});

app.get("/ready", (_req, res) => {
  res.status(200).json({ ready: true });
});

app.get("/health", (_req, res) => {
  const summary = summarizeAccountHealth(manager.snapshot());
  res.status(summary.healthy ? 200 : 503).json(summary);
});

const operationalAccess = config.publicStatus ? [] : [adminRateLimit, adminOnly];
app.get("/status", ...operationalAccess, (_req, res) => {
  res.status(200).json({
    service: "whatsapp-uptime-bot",
    version: "2.0.0",
    health: summarizeAccountHealth(manager.snapshot()),
    accounts: manager.snapshot()
  });
});

app.get("/metrics", ...operationalAccess, async (_req, res) => {
  res.set("content-type", register.contentType);
  res.send(await register.metrics());
});

app.use("/accounts", adminRateLimit, adminOnly);

app.get("/accounts", (_req, res) => {
  res.json(registry.list().map(publicAccount));
});

app.post("/accounts", async (req, res, next) => {
  try {
    const account = await registry.add(req.body || {});
    void manager.connect(account.id);
    res.status(201).json(publicAccount(account));
  } catch (error) { next(error); }
});

app.post("/accounts/:id/pairing-code", pairingRateLimit, async (req, res, next) => {
  try {
    const pairingCode = await manager.requestPairingCode(req.params.id);
    res.set("cache-control", "no-store");
    res.json({ accountId: req.params.id, pairingCode });
  } catch (error) { next(error); }
});

app.post("/accounts/:id/reconnect", async (req, res, next) => {
  try {
    await manager.reconnect(req.params.id);
    res.status(202).json({ accepted: true });
  } catch (error) { next(error); }
});

app.post("/accounts/:id/enable", async (req, res, next) => {
  try {
    const account = await registry.setEnabled(req.params.id, true);
    void manager.connect(account.id);
    res.json(publicAccount(account));
  } catch (error) { next(error); }
});

app.post("/accounts/:id/disable", async (req, res, next) => {
  try {
    const account = await registry.setEnabled(req.params.id, false);
    await manager.stop(account.id);
    res.json(publicAccount(account));
  } catch (error) { next(error); }
});

app.delete("/accounts/:id", async (req, res, next) => {
  try {
    const removed = await manager.remove(req.params.id);
    res.status(removed ? 204 : 404).end();
  } catch (error) { next(error); }
});

app.use((_req, res) => {
  res.status(404).json({ error: "not found" });
});

app.use((error, _req, res, _next) => {
  const statusCode = error instanceof HttpError ? error.statusCode : 500;
  const publicMessage = statusCode >= 500 ? "internal server error" : error.message;
  logger[statusCode >= 500 ? "error" : "warn"]({ err: error }, "request failed");
  res.status(statusCode).json({ error: publicMessage });
});

const server = app.listen(config.port, config.host, () => {
  logger.info({ host: config.host, port: config.port, accounts: registry.list().length }, "service started");
});

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "shutdown started");

  const timeout = setTimeout(() => {
    logger.fatal("shutdown timed out");
    process.exit(1);
  }, config.shutdownTimeoutMs);
  timeout.unref();

  const closeServer = new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  const results = await Promise.allSettled([manager.shutdown(), closeServer]);
  const failed = results.find((result) => result.status === "rejected");
  if (failed) logger.error({ err: failed.reason }, "shutdown completed with an error");
  clearTimeout(timeout);
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("unhandledRejection", (error) => {
  logger.fatal({ err: error }, "unhandled promise rejection");
  void shutdown("unhandledRejection");
});
process.on("uncaughtException", (error) => {
  logger.fatal({ err: error }, "uncaught exception");
  void shutdown("uncaughtException");
});
