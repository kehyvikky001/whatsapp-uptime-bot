import fs from "node:fs/promises";
import path from "node:path";
import { useEncryptedAuthState } from "./encrypted-auth-state.js";
import { HttpError, reconnectDelay, waitFor } from "./utils.js";

function statusCode(error) {
  return error?.output?.statusCode ?? error?.statusCode ?? error?.data?.statusCode ?? null;
}

function initialState() {
  return {
    socket: null,
    connectPromise: null,
    status: "starting",
    reconnectAttempt: 0,
    reconnectTimer: null,
    pairingPromise: null,
    lastPairingCodeAt: 0,
    lastConnectedAt: null,
    lastDisconnectedAt: null,
    lastStateChangeAt: new Date().toISOString(),
    lastError: null,
    degradedAlertSent: false,
    generation: 0
  };
}

let defaultAdaptersPromise;

async function loadDefaultAdapters() {
  if (!defaultAdaptersPromise) {
    defaultAdaptersPromise = import("baileys").then((baileys) => ({
      makeWASocket: baileys.default || baileys.makeWASocket,
      Browsers: baileys.Browsers,
      DisconnectReason: baileys.DisconnectReason,
      fetchLatestBaileysVersion: baileys.fetchLatestBaileysVersion,
      makeCacheableSignalKeyStore: baileys.makeCacheableSignalKeyStore,
      authStateFactory: (folder, key) => useEncryptedAuthState(folder, key, {
        BufferJSON: baileys.BufferJSON,
        initAuthCreds: baileys.initAuthCreds,
        proto: baileys.proto
      })
    }));
  }
  return defaultAdaptersPromise;
}

export class SessionManager {
  constructor({ registry, sessionsDir, logger, metrics, config, alerts = { send: async () => false }, adapters = null }) {
    this.registry = registry;
    this.sessionsDir = sessionsDir;
    this.logger = logger;
    this.metrics = metrics;
    this.config = config;
    this.adapters = adapters;
    this.alerts = alerts;
    this.sessions = new Map();
    this.stopping = false;
    this.watchdogTimer = null;
    this.watchdogRunning = false;
    this.cachedVersion = null;
    this.versionFetchedAt = 0;
    this.versionPromise = null;
  }

  async getAdapters() {
    if (!this.adapters) this.adapters = await loadDefaultAdapters();
    return this.adapters;
  }

  async startEnabledAccounts() {
    await fs.mkdir(this.sessionsDir, { recursive: true, mode: 0o700 });
    for (const account of this.registry.list()) {
      if (account.enabled) void this.connect(account.id);
    }
    this.watchdogTimer = setInterval(() => {
      void this.runWatchdog();
    }, this.config.watchdogIntervalMs);
    this.watchdogTimer.unref();
  }

  setStatus(current, status) {
    current.status = status;
    current.lastStateChangeAt = new Date().toISOString();
  }

  snapshot() {
    return this.registry.list().map((account) => {
      const state = this.sessions.get(account.id);
      return {
        id: account.id,
        enabled: account.enabled,
        status: state?.status || "stopped",
        reconnectAttempt: state?.reconnectAttempt || 0,
        lastConnectedAt: state?.lastConnectedAt || null,
        lastDisconnectedAt: state?.lastDisconnectedAt || null,
        lastStateChangeAt: state?.lastStateChangeAt || null,
        lastError: state?.lastError || null,
        pairingRequired: ["logged_out", "pairing_required", "pairing_code_issued"].includes(state?.status)
      };
    });
  }

  async getVersion(accountLogger) {
    const adapters = await this.getAdapters();
    if (this.cachedVersion && Date.now() - this.versionFetchedAt < this.config.versionCacheMs) {
      return this.cachedVersion;
    }
    if (!this.versionPromise) {
      let timer;
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("version fetch timed out")),
          this.config.versionFetchTimeoutMs
        );
        timer.unref();
      });
      this.versionPromise = Promise.race([adapters.fetchLatestBaileysVersion(), timeout])
        .then(({ version }) => {
          this.cachedVersion = version;
          this.versionFetchedAt = Date.now();
          return version;
        })
        .catch((error) => {
          accountLogger.warn({ err: error }, "could not fetch latest WhatsApp version; using Baileys default");
          return null;
        })
        .finally(() => {
          clearTimeout(timer);
          this.versionPromise = null;
        });
    }
    return this.versionPromise;
  }

  async connect(accountId, { force = false } = {}) {
    const account = this.registry.get(accountId);
    if (!account) throw new HttpError(404, `account ${accountId} was not found`);
    if (!account.enabled && !force) return;

    let current = this.sessions.get(accountId);
    if (!current) {
      current = initialState();
      this.sessions.set(accountId, current);
    }

    if (current.status === "connected" && current.socket) return;
    if (current.connectPromise) return current.connectPromise;
    if (current.socket && ["pairing_required", "pairing_code_issued"].includes(current.status)) return;

    current.connectPromise = this.startSocket(account, current)
      .finally(() => { current.connectPromise = null; });
    return current.connectPromise;
  }

  async startSocket(account, current) {
    if (this.stopping) return;
    this.setStatus(current, "connecting");
    current.generation += 1;
    const generation = current.generation;
    const accountLogger = this.logger.child({ accountId: account.id });

    try {
      const adapters = await this.getAdapters();
      const sessionPath = path.join(this.sessionsDir, account.id);
      const { state, saveCreds } = await adapters.authStateFactory(
        sessionPath,
        this.config.encryptionKey
      );
      const version = await this.getVersion(accountLogger);

      if (this.stopping || generation !== current.generation) return;

      const socketConfig = {
        auth: {
          creds: state.creds,
          keys: adapters.makeCacheableSignalKeyStore(state.keys, accountLogger)
        },
        logger: accountLogger,
        browser: adapters.Browsers.ubuntu("Chrome"),
        printQRInTerminal: false,
        markOnlineOnConnect: false,
        syncFullHistory: false,
        shouldSyncHistoryMessage: () => false,
        generateHighQualityLinkPreview: false,
        getMessage: async () => undefined
      };
      if (version) socketConfig.version = version;

      const socket = adapters.makeWASocket(socketConfig);
      current.socket = socket;
      this.setStatus(current, state.creds.registered ? "connecting" : "pairing_required");

      socket.ev.on("creds.update", async () => {
        try {
          await saveCreds();
        } catch (error) {
          current.lastError = error instanceof Error ? error.message : String(error);
          accountLogger.error({ err: error }, "failed to persist encrypted credentials");
        }
      });

      socket.ev.on("connection.update", (update) => {
        void this.handleConnectionUpdate(account.id, generation, update);
      });

      accountLogger.info({ registered: state.creds.registered }, "WhatsApp session started");
    } catch (error) {
      this.setStatus(current, "error");
      current.lastError = error instanceof Error ? error.message : String(error);
      accountLogger.error({ err: error }, "failed to start WhatsApp session");
      this.scheduleReconnect(account.id);
    }
  }

  async handleConnectionUpdate(accountId, generation, update) {
    const current = this.sessions.get(accountId);
    if (!current || generation !== current.generation) return;

    const { connection, lastDisconnect } = update;
    if (connection === "open") {
      this.setStatus(current, "connected");
      const recovered = current.reconnectAttempt > 0 || current.degradedAlertSent;
      current.reconnectAttempt = 0;
      current.lastConnectedAt = new Date().toISOString();
      current.lastError = null;
      current.degradedAlertSent = false;
      this.metrics.connections.set({ account: accountId }, 1);
      this.logger.info({ accountId }, "WhatsApp account connected");
      if (recovered) void this.alerts.send("account_recovered", { accountId });
      return;
    }

    if (connection !== "close") return;

    current.lastDisconnectedAt = new Date().toISOString();
    current.socket = null;
    this.metrics.connections.set({ account: accountId }, 0);
    this.metrics.disconnects.inc({ account: accountId });

    const error = lastDisconnect?.error;
    const code = statusCode(error);
    current.lastError = error instanceof Error ? error.message : String(error || "connection closed");

    if (code === this.adapters?.DisconnectReason?.loggedOut) {
      this.setStatus(current, "logged_out");
      this.logger.warn({ accountId }, "account was logged out and must be paired again");
      void this.alerts.send("account_logged_out", { accountId, error: current.lastError });
      return;
    }

    this.setStatus(current, "disconnected");
    this.logger.warn({ accountId, code }, "account disconnected; reconnect scheduled");
    this.scheduleReconnect(accountId);
  }

  scheduleReconnect(accountId) {
    const current = this.sessions.get(accountId);
    const account = this.registry.get(accountId);
    if (!current || !account?.enabled || this.stopping || current.reconnectTimer) return;

    const delay = reconnectDelay(
      current.reconnectAttempt,
      this.config.reconnectBaseMs,
      this.config.reconnectMaxMs,
      this.config.reconnectJitter
    );

    current.reconnectAttempt += 1;
    this.setStatus(current, "reconnect_wait");
    if (
      !current.degradedAlertSent &&
      current.reconnectAttempt >= this.config.alertAfterReconnectAttempts
    ) {
      current.degradedAlertSent = true;
      void this.alerts.send("account_reconnecting", {
        accountId,
        attempt: current.reconnectAttempt,
        error: current.lastError
      });
    }
    this.metrics.reconnects.inc({ account: accountId });

    current.reconnectTimer = setTimeout(() => {
      current.reconnectTimer = null;
      void this.connect(accountId);
    }, delay);
    current.reconnectTimer.unref();

    this.logger.info({ accountId, delay, attempt: current.reconnectAttempt }, "reconnect queued");
  }

  async requestPairingCode(accountId) {
    const account = this.registry.get(accountId);
    if (!account) throw new HttpError(404, `account ${accountId} was not found`);
    if (!account.enabled) throw new HttpError(409, `account ${accountId} is disabled; enable it before pairing`);

    let current = this.sessions.get(accountId);
    if (!current) {
      current = initialState();
      this.sessions.set(accountId, current);
    }

    if (current.status === "connected") {
      throw new HttpError(409, `account ${accountId} is already connected`);
    }
    if (current.pairingPromise) return current.pairingPromise;

    if (current.status === "logged_out") {
      await this.stop(accountId, { preserveRecord: true });
      await fs.rm(path.join(this.sessionsDir, accountId), { recursive: true, force: true });
      current = initialState();
      this.sessions.set(accountId, current);
    }

    const elapsed = Date.now() - current.lastPairingCodeAt;
    if (current.lastPairingCodeAt && elapsed < this.config.pairingCooldownMs) {
      throw new HttpError(
        429,
        `pairing code cooldown active; retry in ${Math.ceil((this.config.pairingCooldownMs - elapsed) / 1000)} seconds`
      );
    }

    current.pairingPromise = (async () => {
      await this.connect(accountId, { force: true });
      const socket = await waitFor(
        () => this.sessions.get(accountId)?.socket,
        this.config.pairingReadyTimeoutMs
      );
      if (!socket) throw new HttpError(503, "session is not ready; retry shortly");

      const code = await socket.requestPairingCode(account.phoneNumber);
      current.lastPairingCodeAt = Date.now();
      this.setStatus(current, "pairing_code_issued");
      this.logger.info({ accountId }, "pairing code issued");
      return code;
    })().finally(() => { current.pairingPromise = null; });

    return current.pairingPromise;
  }

  async runWatchdog(now = Date.now()) {
    if (this.stopping || this.watchdogRunning) return;
    this.watchdogRunning = true;
    try {
      for (const account of this.registry.list()) {
        if (!account.enabled) continue;
        const current = this.sessions.get(account.id);
        if (!current) {
          void this.connect(account.id);
          continue;
        }

        const changedAt = Date.parse(current.lastStateChangeAt || "") || now;
        const staleConnecting =
          current.status === "connecting" &&
          now - changedAt >= this.config.staleConnectingMs;

        if (staleConnecting) {
          this.logger.warn({ accountId: account.id }, "watchdog restarting stale connection");
          this.metrics.watchdogRecoveries?.inc({ account: account.id });
          void this.alerts.send("watchdog_restart", { accountId: account.id });
          await this.reconnect(account.id);
          continue;
        }

        if (
          ["error", "disconnected", "stopped"].includes(current.status) &&
          !current.reconnectTimer &&
          !current.connectPromise
        ) {
          void this.connect(account.id);
        }
      }
    } finally {
      this.watchdogRunning = false;
    }
  }

  async reconnect(accountId) {
    const account = this.registry.get(accountId);
    if (!account) throw new HttpError(404, `account ${accountId} was not found`);
    if (!account.enabled) throw new HttpError(409, `account ${accountId} is disabled`);
    await this.stop(accountId, { preserveRecord: true });
    await this.connect(accountId, { force: true });
  }

  async stop(accountId, { preserveRecord = true } = {}) {
    const current = this.sessions.get(accountId);
    if (!current) return;

    current.generation += 1;
    if (current.reconnectTimer) clearTimeout(current.reconnectTimer);
    current.reconnectTimer = null;

    try {
      current.socket?.end(new Error("session stopped by operator"));
    } catch {
      // Socket may already be closed.
    }

    current.socket = null;
    current.connectPromise = null;
    this.setStatus(current, "stopped");
    if (!preserveRecord) this.sessions.delete(accountId);
    this.metrics.connections.set({ account: accountId }, 0);
  }

  async remove(accountId) {
    await this.stop(accountId, { preserveRecord: false });
    await fs.rm(path.join(this.sessionsDir, accountId), { recursive: true, force: true });
    return this.registry.remove(accountId);
  }

  async shutdown() {
    this.stopping = true;
    if (this.watchdogTimer) clearInterval(this.watchdogTimer);
    this.watchdogTimer = null;
    await Promise.allSettled(this.registry.list().map((account) => this.stop(account.id)));
  }
}
