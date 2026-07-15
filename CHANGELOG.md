# Changelog

## 2.0.0

- Encrypt account records and Baileys authentication state with AES-256-GCM.
- Migrate version 1 plaintext account and session files atomically.
- Serialize connection and pairing operations to prevent duplicate sockets.
- Add pairing cooldowns, administrative rate limits, and protected operational endpoints.
- Split process liveness, readiness, and account health into separate endpoints.
- Add stale-connection watchdog, reconnect/recovery alerts, and Prometheus metrics.
- Harden Docker with a non-root user, read-only filesystem support, dropped capabilities, no-new-privileges, Tini, and persistent encrypted storage.
- Add CI, CodeQL, Dependabot, multi-architecture container publishing, and manual production deployment workflows.
- Add secret generation, preflight, and encrypted data backup tools.
- Expand automated coverage to configuration, encryption, migration, persistence, rate limiting, alerts, session races, logout handling, watchdog behavior, health, and utility functions.
