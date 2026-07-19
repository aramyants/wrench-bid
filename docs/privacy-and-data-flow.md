# Privacy and data flow

## Data the product stores

| Data | Where | Why | Deletion |
| --- | --- | --- | --- |
| Uploaded estimate PDFs | Private disk volume (`UPLOAD_DIR`), SHA-256 named | Extraction evidence | Cascades with session deletion; failure paths remove partial writes |
| Extracted text + proposed fields | PostgreSQL (`source_documents`, `repair_specs`) | Spec building with per-field evidence | Session deletion |
| Confirmed spec versions + hashes | `repair_specs`, campaign snapshots | Immutable negotiation input | Session deletion |
| Shops (seeded/Tavily/manual) | `shops`, tenant-scoped | Counterparty list | Project cascade |
| Calls, transcripts, quotes, evidence spans | `calls`, `quotes`, `evidence_spans` | Negotiation record | Session deletion; provider-side conversation deletion is wired via API |
| Webhook payloads | `webhook_events`, owner-linked | Idempotency/audit | Cascades with call/session (orphan events are rejected by design) |
| Anonymous project identity | HTTP-only cookie, token hashed server-side | Tenant isolation without accounts | Cookie expiry / project cascade |

## What never happens

- No provider secret reaches the browser: the client receives only short-lived ElevenLabs conversation tokens minted server-side.
- No `VITE_`-prefixed secret exists (build would embed it).
- No third party receives customer data: Tavily receives only the operator-written search query; ElevenLabs receives the confirmed spec context needed for the conversation.
- No unnecessary personal data is collected: the spec schema holds vehicle/job/location fields, not names, full VINs (last 8 only), or payment data.
- Demo browser persistence (localStorage) contains only the synthetic seeded session; live data is server-side only.

## User control

Deletion is user-initiated per request/session and cascades through documents, specs, shops links, campaigns, calls, quotes, evidence, webhook events, and the uploaded file itself — verified to zero residual rows and files in `docs/VERIFICATION.md`. `RETENTION_DAYS` bounds intended retention; scheduled purging is listed in `docs/limitations.md`.
