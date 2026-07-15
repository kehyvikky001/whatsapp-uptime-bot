import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { SessionManager } from "../src/session-manager.js";

function noopLogger() {
  const logger = {
    child: () => logger,
    info() {}, warn() {}, error() {}, fatal() {}
  };
  return logger;
}

function metrics() {
  const gauge = { set() {} };
  const counter = { inc() {} };
  return { connections: gauge, reconnects: counter, disconnects: counter, watchdogRecoveries: counter };
}

function registry(account = { id: "primary_1", phoneNumber: "2348012345678", enabled: true }) {
  return {
    list: () => [account],
    get: (id) => id === account.id ? account : null,
    remove: async () => true
  };
}

async function fixture(overrides = {}) {
  const sessionsDir = await fs.mkdtemp(path.join(os.tmpdir(), "session-manager-"));
  let socketCount = 0;
  let pairingCount = 0;
  const listeners = new Map();

  const socket = {
    ev: { on(name, fn) { listeners.set(name, fn); } },
    requestPairingCode: async () => { pairingCount += 1; return "12345678"; },
    end() {}
  };

  const adapters = {
    makeWASocket: () => { socketCount += 1; return socket; },
    Browsers: { ubuntu: () => ["Ubuntu", "Chrome", "1"] },
    DisconnectReason: { loggedOut: 401 },
    fetchLatestBaileysVersion: async () => ({ version: [2, 3000, 1] }),
    makeCacheableSignalKeyStore: (keys) => keys,
    authStateFactory: async () => ({
      state: { creds: { registered: false }, keys: {} },
      saveCreds: async () => {}
    }),
    ...overrides.adapters
  };

  const manager = new SessionManager({
    registry: overrides.registry || registry(),
    sessionsDir,
    logger: noopLogger(),
    metrics: metrics(),
    config: {
      encryptionKey: Buffer.alloc(32),
      reconnectBaseMs: 1000,
      reconnectMaxMs: 10000,
      reconnectJitter: 0,
      pairingReadyTimeoutMs: 1000,
      pairingCooldownMs: 0,
      versionCacheMs: 60000,
      versionFetchTimeoutMs: 1000,
      ...overrides.config
    },
    adapters
  });

  return {
    manager,
    socket,
    listeners,
    counts: () => ({ socketCount, pairingCount })
  };
}

test("serializes concurrent socket creation", async () => {
  const { manager, counts } = await fixture();
  await Promise.all([manager.connect("primary_1"), manager.connect("primary_1")]);
  assert.equal(counts().socketCount, 1);
});

test("serializes concurrent pairing requests", async () => {
  const { manager, counts } = await fixture();
  const [first, second] = await Promise.all([
    manager.requestPairingCode("primary_1"),
    manager.requestPairingCode("primary_1")
  ]);
  assert.equal(first, "12345678");
  assert.equal(second, "12345678");
  assert.equal(counts().socketCount, 1);
  assert.equal(counts().pairingCount, 1);
});

test("marks explicit logout as action required and does not auto reconnect", async () => {
  const { manager } = await fixture();
  await manager.connect("primary_1");
  const generation = manager.sessions.get("primary_1").generation;
  await manager.handleConnectionUpdate("primary_1", generation, {
    connection: "close",
    lastDisconnect: { error: { statusCode: 401 } }
  });
  const state = manager.snapshot()[0];
  assert.equal(state.status, "logged_out");
  assert.equal(state.pairingRequired, true);
  assert.equal(manager.sessions.get("primary_1").reconnectTimer, null);
});


test("watchdog restarts a stale connecting session", async () => {
  const { manager } = await fixture({ config: { staleConnectingMs: 1000 } });
  await manager.connect("primary_1");
  const state = manager.sessions.get("primary_1");
  state.status = "connecting";
  state.lastStateChangeAt = new Date(Date.now() - 5000).toISOString();
  let reconnects = 0;
  manager.reconnect = async () => { reconnects += 1; };
  await manager.runWatchdog(Date.now());
  assert.equal(reconnects, 1);
});
