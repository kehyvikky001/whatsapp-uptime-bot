# WhatsApp Uptime Bot

A multi-account linked-device connection service for WhatsApp accounts you own or are authorized to manage.

It persists linked-device sessions, reconnects after ordinary network interruptions, reports account health, and avoids reading or storing message content.

## Important limitation

No linked-device client can guarantee that an account will never disconnect. WhatsApp may expire or log out a session, require re-pairing, or restrict an account. This service reconnects recoverable sessions and deliberately stops when WhatsApp reports that the linked device has been logged out.

It does not include IP rotation, enforcement bypass, or anti-ban evasion.

## Quick deployment

```bash
cp .env.example .env
```

Set a long random `ADMIN_TOKEN`, then run:

```bash
docker compose up -d --build
```

Check health:

```bash
curl http://localhost:8080/health
curl http://localhost:8080/status
```

## Add an account

```bash
docker compose exec app node src/cli.js account:add --id personal-one --phone 2348012345678
docker compose exec app node src/cli.js account:pair --id personal-one
```

In WhatsApp, open **Linked devices**, choose **Link a device**, then choose the phone-number pairing option and enter the displayed code.

## Commands

```bash
docker compose exec app node src/cli.js account:list
docker compose exec app node src/cli.js account:enable --id personal-one
docker compose exec app node src/cli.js account:disable --id personal-one
docker compose exec app node src/cli.js account:reconnect --id personal-one
docker compose exec app node src/cli.js account:remove --id personal-one
```

## Endpoints

- `GET /health`
- `GET /ready`
- `GET /status`
- `GET /metrics`
- Protected account-management endpoints under `/accounts`

Mutation endpoints require:

```text
Authorization: Bearer YOUR_ADMIN_TOKEN
```

## Security

- Authentication material is stored in a persistent Docker volume.
- The data directory is excluded from Git.
- Authorization headers, pairing codes, and phone numbers are redacted from logs.
- Message bodies are neither consumed nor persisted.
- Put the service behind HTTPS before exposing it beyond localhost.
- Restrict `/status` and `/metrics` at your reverse proxy when appropriate.

## Reliability

- Exponential reconnect with jitter
- Docker `restart: unless-stopped`
- Persistent sessions
- Health check
- Graceful shutdown
- Manual re-pair requirement after an explicit logout
