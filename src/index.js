import fs from "node:fs/promises";
import crypto from "node:crypto";
import express from "express";
import helmet from "helmet";
import pino from "pino";
import client from "prom-client";
import { config } from "./config.js";
import { AccountRegistry } from "./account-registry.js";
import { SessionManager } from "./session-manager.js";
import { publicAccount, timingSafeTokenMatch } from "./utils.js";

await fs.mkdir(config.dataDir, { recursive: true });
await fs.mkdir(config.sessionsDir, { recursive: true });

const logger = pino({
  level: config.logLevel,
  redact: {
    paths: [
      "req.headers.authorization",
      "authorization",
      "phoneNumber",
      "*.phoneNumber",
      "pairingCode",
      "*.pairingCode"
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
  })
};

const registry = new AccountRegistry(config.accountsFile);
await registry.load();

const manager = new SessionManager({
  registry,
  sessionsDir: config.sessionsDir,
  logger,
  metrics,
  config
});
await manager.startEnabledAccounts();

const app = express();
app.disable("x-powered-by");
app.use(helmet());
app.use(express.json({ limit: "64kb" }));

function adminOnly(req, res, next) {
  const header = req.get("authorization");
  const supplied = header?.startsWith("Bearer ") ? header.slice(7) : "";
  if (!timingSafeTokenMatch(supplied, config.adminToken)) {
    return res.status(401).json({ error: "unauthorized" });
  }
  return next();
}

app.get("/health", async (_req, res) => {
  try {
    await fs.access(config.dataDir);
    res.status(200).json({ ok: true, uptimeSeconds: Math.floor(process.uptime()) });
  } catch {
    res.status(503).json({ ok: false });
  }
});

app.get("/ready", (_req, res) => {
  res.status(200).json({ ready: true });
});

app.get("/status", (_req, res) => {
  res.status(200).json({
    service: "whatsapp-uptime-bot",
    accounts: manager.snapshot()
  });
});

app.get("/metrics", async (_req, res) => {
  res.set("content-type", register.contentType);
  res.send(await register.metrics());
});

app.get("/accounts", adminOnly, (_req, res) => {
  res.json(registry.list().map(publicAccount));
});

app.post("/accounts", adminOnly, async (req, res, next) => {
  try {
    const account = await registry.add(req.body || {});
    void manager.connect(account.id);
    res.status(201).json(publicAccount(account));
  } catch (error) {
    next(error);
  }
});

app.post("/accounts/:id/pairing-code", adminOnly, async (req, res, next) => {
  try {
    const pairingCode = await manager.requestPairingCode(req.params.id);
    res.json({ accountId: req.params.id, pairingCode });
  } catch (error) {
    next(error);
  }
});

app.post("/accounts/:id/reconnect", adminOnly, async (req, res, next) => {
  try {
    await manager.reconnect(req.params.id);
    res.status(202).json({ accepted: true });
  } catch (error) {
    next(error);
  }
});

app.post("/accounts/:id/enable", adminOnly, async (req, res, next) => {
  try {
    const account = await registry.setEnabled(req.params.id, true);
    void manager.connect(account.id);
    res.json(publicAccount(account));
  } catch (error) {
    next(error);
  }
});

app.post("/accounts/:id/disable", adminOnly, async (req, res, next) => {
  try {
    const account = await registry.setEnabled(req.params.id, false);
    await manager.stop(account.id);
    res.json(publicAccount(account));
  } catch (error) {
    next(error);
  }
});

app.delete("/accounts/:id", adminOnly, async (req, res, next) => {
  try {
    const removed = await manager.remove(req.params.id);
    res.status(removed ? 204 : 404).end();
  } catch (error) {
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  const message = error instanceof Error ? error.message : "unexpected error";
  logger.warn({ err: error }, "request failed");
  res.status(400).json({ error: message });
});

const server = app.listen(config.port, "0.0.0.0", () => {
  logger.info({ port: config.port, accounts: registry.list().length }, "service started");
});

async function shutdown(signal) {
  logger.info({ signal }, "shutdown started");
  server.close();
  await manager.shutdown();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
