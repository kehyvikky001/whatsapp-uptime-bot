# WhatsApp Uptime Bot

A multi-account linked-device connection service for WhatsApp accounts you own or are authorized to manage.

It preserves linked-device sessions, reconnects after ordinary network interruptions, exposes operational health, and intentionally does not process or store message bodies.

## Important limitation

No linked-device client can guarantee that an account will never disconnect. WhatsApp may expire or log out a session, require re-pairing, or restrict an account. This service reconnects recoverable sessions and stops when WhatsApp reports an explicit logout.

This project does not include IP rotation, enforcement bypass, anti-ban evasion, or any guarantee against account restrictions.

## Production improvements in version 2

- AES-256-GCM encryption for account records and Baileys authentication files
- Transparent migration from the previous plaintext account and session files
- Serialized connection creation to prevent duplicate sockets
- Pairing-code cooldown and API rate limiting
- Separate `/live`, `/ready`, and strict `/health` semantics
- Protected `/status` and `/metrics` by default
- Atomic encrypted writes and restrictive filesystem permissions
- Hardened Docker Compose configuration
- CI across Node.js 20 and 22
- Stale-connection watchdog and optional JSON webhook alerts
- Tests for encryption, migration, persistence, health, rate limiting, and utilities

## Deploy

```bash
cp .env.example .env
```

Generate secrets:

```bash
openssl rand -hex 32
openssl rand -base64 32
```

Use the hex value for `ADMIN_TOKEN` and the Base64 value for `SESSION_ENCRYPTION_KEY`. Never change the encryption key after pairing accounts unless you intentionally delete all stored sessions and pair them again.

Create `.env` automatically or copy the template:

```bash
npm run setup
# or: cp .env.example .env
```

Run preflight after dependencies are installed:

```bash
npm run preflight
```

Start:

```bash
docker compose up -d --build
```

The included Compose file binds to `127.0.0.1:8080`. Put an HTTPS reverse proxy in front of it for remote access rather than exposing the service directly.

## Verify

```bash
npm install
npm run verify
docker build -t whatsapp-uptime-bot:test .
```

## Add and pair an account

```bash
docker compose exec app node src/cli.js account:add --id personal-one --phone 2348012345678
docker compose exec app node src/cli.js account:pair --id personal-one
```

On the phone, open **WhatsApp → Linked devices → Link a device**, choose the phone-number pairing option, then enter the code printed by the CLI.

## Commands

```bash
docker compose exec app node src/cli.js account:list
docker compose exec app node src/cli.js account:enable --id personal-one
docker compose exec app node src/cli.js account:disable --id personal-one
docker compose exec app node src/cli.js account:reconnect --id personal-one
docker compose exec app node src/cli.js account:remove --id personal-one
```

## Endpoints

- `GET /live`: process and persistent-storage liveness; used by Docker
- `GET /ready`: startup readiness
- `GET /health`: aggregate WhatsApp account health; returns 503 when enabled accounts are degraded
- `GET /status`: detailed account state; admin token required by default
- `GET /metrics`: Prometheus metrics; admin token required by default
- `/accounts`: protected account-management API

Protected requests use:

```text
Authorization: Bearer YOUR_ADMIN_TOKEN
```

## Migration from version 1

On first startup, version 2:

1. Reads `data/accounts.json` when the encrypted account store does not yet exist.
2. Writes encrypted `data/accounts.enc.json`.
3. Renames the old account file to `accounts.json.migrated` where possible.
4. Reads each existing Baileys plaintext session file once and immediately rewrites it encrypted.

Back up the data volume before upgrading. Keep `SESSION_ENCRYPTION_KEY` in a password manager and outside Git.

## Operational guidance

- Run one application replica. Multiple replicas need a distributed account lock to avoid duplicate linked-device sessions.
- Back up the encrypted data volume and the encryption key separately.
- Monitor `/health` and Prometheus metrics, but use `/live` for container restart decisions.
- Set `ALERT_WEBHOOK_URL` to receive JSON notifications for logout, repeated reconnects, watchdog restarts, and recovery.
- A `logged_out` account must be paired again manually.
- Use a stable network; unnecessary network-location changes can make linked-device sessions less reliable.


## Automated container publication and deployment

- `CI` verifies Node.js 20 and 22 and builds the Docker image.
- `Publish Container` publishes `linux/amd64` and `linux/arm64` images to GitHub Container Registry after pushes to `main`.
- `Deploy to Server` is manual and requires the protected production secrets `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS`, `GHCR_USERNAME`, `GHCR_TOKEN`, and optionally `DEPLOY_PATH`. The target directory must already contain the production `.env` file.

## Backup

```bash
./scripts/backup-data.sh
```

The backup contains encrypted account and session data. Keep the archive and `SESSION_ENCRYPTION_KEY` in separate secure locations.
