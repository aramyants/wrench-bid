# Security policy

## Reporting a vulnerability

Open a private GitHub security advisory on this repository (Security → Advisories → Report a vulnerability). Do not open public issues for vulnerabilities. Expect an acknowledgement within 72 hours.

## Supported versions

Only the latest `main` is supported; this is a hackathon-stage codebase.

## Security posture (summary)

- All provider secrets are server-side only; the browser receives only short-lived ElevenLabs conversation tokens. No `VITE_` secret exists, and CI scans for secret patterns.
- Tenant isolation via opaque HttpOnly cookies with server-side hashed tokens; every query is project-scoped; cross-tenant access is regression-tested.
- Webhooks are HMAC-SHA256-verified (timestamped, timing-safe) and idempotent (`UNIQUE(provider, provider_event_id)`).
- Uploads are MIME/magic-byte/size validated, stored under server-generated keys on a private volume, and removed on failure or deletion.
- Same-origin checks on all mutations; hardened container (non-root, read-only, no capabilities); loopback-only ports by default.
- Outbound telephony is disabled by default and multi-gated (operator switch, consent, verified E.164, suppression list).

Details: `docs/SECURITY.md`, `docs/threat-model.md`, `docs/privacy-and-data-flow.md`. Known boundaries (anonymous tenancy, in-request webhook processing): `docs/limitations.md`.
