# Project status

Version 2.0.0 is code-complete and locally verified.

The current GitHub connector can read `kehyvikky001/whatsapp-uptime-bot`, but GitHub rejects content writes with `403 Resource not accessible by integration`. The ChatGPT app permission is already set to allow all actions, so this is an OAuth or GitHub App repository-content scope restriction rather than an approval prompt.

The release bundle includes `scripts/push-upgrade.sh`, which performs a normal clone, non-force commit, and push when run in any environment that already has GitHub write authentication.

Live completion additionally requires an always-on server and phone-side pairing for every authorized WhatsApp account. No server credentials or existing VPS subscription were found in the connected project context or relevant hosting-provider emails.
