export class AlertSink {
  constructor({ url, bearerToken, timeoutMs, cooldownMs, logger }) {
    this.url = url;
    this.bearerToken = bearerToken;
    this.timeoutMs = timeoutMs;
    this.cooldownMs = cooldownMs;
    this.logger = logger;
    this.lastSent = new Map();
  }

  async send(type, details = {}) {
    if (!this.url) return false;

    const dedupeKey = `${type}:${details.accountId || "service"}`;
    const now = Date.now();
    const previous = this.lastSent.get(dedupeKey) || 0;
    if (now - previous < this.cooldownMs) return false;
    this.lastSent.set(dedupeKey, now);

    const headers = { "content-type": "application/json" };
    if (this.bearerToken) headers.authorization = `Bearer ${this.bearerToken}`;

    try {
      const response = await fetch(this.url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          service: "whatsapp-uptime-bot",
          type,
          timestamp: new Date().toISOString(),
          details
        }),
        signal: AbortSignal.timeout(this.timeoutMs)
      });
      if (!response.ok) throw new Error(`alert receiver returned ${response.status}`);
      return true;
    } catch (error) {
      this.lastSent.delete(dedupeKey);
      this.logger.warn({ err: error, alertType: type }, "alert delivery failed");
      return false;
    }
  }
}
