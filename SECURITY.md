# Security

## Sensitive material

Never commit `.env`, pairing codes, data-volume archives, account records, or session files. The application encrypts persisted account and Baileys authentication data with `SESSION_ENCRYPTION_KEY`, but disclosure of both the encrypted data and that key compromises the sessions.

Rotate `ADMIN_TOKEN` when administrative access may have been exposed. Do not rotate `SESSION_ENCRYPTION_KEY` unless all sessions will be deleted and paired again.

## Network exposure

Bind the service to localhost and place an authenticated HTTPS reverse proxy or private network in front of it. `/status`, `/metrics`, and every `/accounts` route require the admin token by default.

## Reporting

Use a private communication channel to report a suspected vulnerability. Do not include live session files, credentials, tokens, pairing codes, or phone numbers in a public issue.
