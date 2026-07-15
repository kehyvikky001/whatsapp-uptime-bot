# Verification record

Verification date: 2026-07-15

Completed in the offline build environment:

- JavaScript syntax check for every runtime and utility module
- 28 automated tests passing
- Account-store encryption and plaintext migration test
- Authentication-file encryption and plaintext migration test using the Baileys-compatible audit adapter
- Concurrent socket and pairing serialization tests
- Explicit logout and watchdog recovery tests
- Configuration validation tests
- Alert delivery, cooldown, and retry tests
- Health-state and rate-limit tests
- Generated `.env` permissions check
- Preflight execution check
- Application startup-wiring smoke test
- Docker Compose and GitHub workflow YAML parsing
- Shell syntax validation for backup tooling
- Package-content inspection confirming `.env`, `data`, and `node_modules` are excluded
- Secret-marker scan

Not executable in the offline build environment:

- Downloading production npm dependencies
- Building the actual Docker image
- Running GitHub Actions
- Pairing a real WhatsApp account
- Deploying to an external always-on server

The included CI workflow performs dependency installation, all tests, and a real Docker build after the upgrade is committed to GitHub. Real account pairing and server deployment require the account owner’s phone and server credentials.
