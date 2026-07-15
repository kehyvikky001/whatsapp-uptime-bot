import fs from "node:fs/promises";
import path from "node:path";
import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  useMultiFileAuthState
} from "baileys";
import { reconnectDelay, sleep } from "./utils.js";

function statusCode(error) {
  return error?.output?.statusCode ?? error?.statusCode ?? error?.data?.statusCode ?? null;
}

export class SessionManager {
  constructor({ registry, sessionsDir, logger, metrics, config }) {
    this.registry = registry;
    this.sessionsDir = sessionsDir;
    this.logger = logger;
    this.metrics = metrics;
    this.config = config;
    this.sessions = new Map();
    this.stopping = false;
  }

  async startEnabledAccounts() {
    await fs.mkdir(this.sessionsDir, { recursive: true });
    for (const account of this.registry.list()) {
      if (account.enabled) void this.connect(account.id);
    }
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
        lastError: state?.lastError || null,
        pairingRequired: state?.status === "logged_out" || state?.status === "pairing_required"
      };
    });
  }

  async connect(accountId, { force = false } = {}) {
    const account = this.registry.get(accountId);
    if (!account) throw new Error(`account ${accountId} was not found`);
    if (!account.enabled && !force) return;

    let current = this.sessions.get(accountId);
    if (current?.connecting || current?.status === "connected") return;

    if (!current) {
      current = {
        socket: null,
        connecting: false,
        status: "starting",
        reconnectAttempt: 0,
        reconnectTimer: null,
        lastConnectedAt: null,
        lastDisconnectedAt: null,
        lastError: null,
        generation: 0
      };
      this.sessions.set(accountId, current);
    }

    current.connecting = true;
    current.status = "connecting";
    current.generation += 1;
    const generation = current.generation;
    const accountLogger = this.logger.child({ accountId });

    try {
      const sessionPath = path.join(this.sessionsDir, accountId);
      await fs.mkdir(sessionPath, { recursive: true, mode: 0o700 });

      const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
      const { version } = await fetchLatestBaileysVersion();

      if (this.stopping || generation !== current.generation) return;

      const socket = makeWASocket({
        version,
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, accountLogger)
        },
        logger: accountLogger,
        browser: Browsers.ubuntu("Chrome"),
        printQRInTerminal: false,
        markOnlineOnConnect: false,
        syncFullHistory: false,
        shouldSyncHistoryMessage: () => false,
        generateHighQualityLinkPreview: false,
        getMessage: async () => undefined
      });

      current.socket = socket;
      current.status = state.creds.registered ? "connecting" : "pairing_required";
      current.connecting = false;

      socket.ev.on("creds.update", async () => {
        try {
          await saveCreds();
        } catch (error) {
          accountLogger.error({ err: error }, "failed to persist credentials");
        }
      });

      socket.ev.on("connection.update", (update) => {
        void this.handleConnectionUpdate(accountId, generation, update);
      });

      accountLogger.info({ registered: state.creds.registered }, "WhatsApp session started");
    } catch (error) {
      current.connecting = false;
      current.status = "error";
      current.lastError = error instanceof Error ? error.message : String(error);
      accountLogger.error({ err: error }, "failed to start WhatsApp session");
      this.scheduleReconnect(accountId);
    }
  }

  async handleConnectionUpdate(accountId, generation, update) {
    const current = this.sessions.get(accountId);
    if (!current || generation !== current.generation) return;

    const { connection, lastDisconnect } = update;
    if (connection === "open") {
      current.status = "connected";
      current.reconnectAttempt = 0;
      current.lastConnectedAt = new Date().toISOString();
      current.lastError = null;
      this.metrics.connections.set({ account: accountId }, 1);
      this.logger.info({ accountId }, "WhatsApp account connected");
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

    if (code === DisconnectReason.loggedOut) {
      current.status = "logged_out";
      this.logger.warn({ accountId }, "account was logged out and must be paired again");
      return;
    }

    current.status = "disconnected";
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
    current.status = "reconnect_wait";
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
    if (!account) throw new Error(`account ${accountId} was not found`);

    await this.connect(accountId, { force: true });
    await sleep(this.config.pairingWaitMs);

    const current = this.sessions.get(accountId);
    if (!current?.socket) throw new Error("session is not ready; retry in a few seconds");

    const code = await current.socket.requestPairingCode(account.phoneNumber);
    current.status = "pairing_code_issued";
    this.logger.info({ accountId }, "pairing code issued");
    return code;
  }

  async reconnect(accountId) {
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
    current.status = "stopped";
    current.connecting = false;

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
    await Promise.all(this.registry.list().map((account) => this.stop(account.id)));
  }
}
