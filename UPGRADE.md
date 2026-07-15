# Upgrade from version 1

1. Back up the existing Docker data volume and save the backup outside the server.
2. Generate and securely store `SESSION_ENCRYPTION_KEY`.
3. Replace the repository files with version 2.
4. Add the new variables from `.env.example` to `.env` without changing the existing `ADMIN_TOKEN` unless rotation is intended.
5. Run `npm run preflight` or start the new container.
6. Version 2 migrates `accounts.json` and standard Baileys session files to AES-256-GCM encryption during first use.
7. Verify `/live`, `/ready`, `/health`, and the protected `/status` endpoint.
8. Confirm every enabled account reconnects before deleting the external backup.

The application removes the old plaintext `accounts.json` only after the encrypted account store is written successfully. Session files are rewritten atomically in place as they are read.
