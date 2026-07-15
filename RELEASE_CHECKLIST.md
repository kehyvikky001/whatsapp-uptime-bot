# Release checklist

## Completed in the build environment

- [x] Production v2 source completed
- [x] Encrypted account and session persistence
- [x] Version 1 plaintext migration
- [x] Connection serialization and pairing race prevention
- [x] Automatic reconnect and stale-session watchdog
- [x] Health, liveness, readiness, metrics, and alerts
- [x] Administrative authentication and rate limiting
- [x] Non-root hardened Docker image and Compose definitions
- [x] CI, CodeQL, Dependabot, image publishing, and manual deployment workflows
- [x] Secret generation, preflight, backup, and push-upgrade scripts
- [x] 28 tests passing in the offline verification environment
- [x] YAML, shell, startup wiring, package-content, and secret checks passing

## External gates that cannot be completed without external account access

- [ ] Push version 2 to `kehyvikky001/whatsapp-uptime-bot`
- [ ] Observe the first GitHub Actions CI and Docker build
- [ ] Provision or select an always-on Linux server
- [ ] Place `.env` on that server and securely store `SESSION_ENCRYPTION_KEY`
- [ ] Deploy the container and verify `/live`, `/ready`, and `/health`
- [ ] Pair each authorized WhatsApp account from its phone
- [ ] Confirm recovery after a controlled container restart and temporary network interruption
- [ ] Return the GitHub repository to private visibility when connector access is no longer needed

A real phone pairing and an always-on server are necessary to verify the final live state. No software can guarantee that WhatsApp will never expire or log out a linked device.
