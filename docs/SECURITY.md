# Security and compliance boundary

## Implemented controls

- Secret values are server-only and `.env*` is ignored except `.env.example`.
- Anonymous workspaces use a random 256-bit opaque token; only its SHA-256 hash is stored. The cookie is HTTP-only, SameSite=Lax, and Secure in production.
- User-data queries are project-scoped; foreign keys prevent cross-entity references.
- Server-function CSRF protection and explicit API origin checks cover mutations.
- In production, mutation origin checks compare `Origin`/`Referer` with the configured `PUBLIC_APP_URL` origin, not a proxy-controlled internal request host.
- Upload type, signature, size, storage path, and permissions are validated.
- Confirmed specs cannot be edited through application endpoints and are snapshotted into campaigns.
- Real calling requires explicit authorization/disclosure and recording-consent confirmations.
- Real calling is disabled by default and also enforces explicit phone re-entry/attestation, transactionally serialized per-project daily limits, distinct destinations, an operator suppression list, complete webhook configuration, and a kill switch. Every campaign and negotiation provider request is preceded by an atomic claim that rechecks the verified E.164 destination, both consents, and the current suppression set.
- Webhooks verify an HMAC/timestamp over the raw body, retain only events mapped to an owned call/session, reclaim failed/stale processing leases, and preserve terminal call states during early-event races. Terminal state, transcript, normalized quote/evidence, and negotiation outcome commit atomically.
- Provider audio is proxied only after project ownership checks.
- Live personal data is not persisted in browser storage.
- Deletion resolves provider conversations and source blobs only through project ownership, then removes the project-scoped parent session. Database foreign-key cascades remove dependent records (including raw webhook payloads), and now-unreferenced shops are removed before success is reported. Late unmapped provider events are rejected without persistence.

## Required before public launch

1. Replace anonymous project sessions with an identity provider, account recovery, session revocation, and authorization tests.
2. Obtain legal review for TCPA/telemarketing, AI disclosure, call recording, calling hours, do-not-call/suppression handling, and jurisdiction-specific consent.
3. Add global/account spend ceilings, identity-resistant abuse detection, destination verification/allow rules, and a managed do-not-call service. The current project limit/suppression/kill-switch controls are defense in depth, not substitutes for identity.
4. Add malware scanning/OCR isolation for additional upload formats.
5. Use encrypted object storage, managed database encryption, secret rotation, and audited production access.
6. Implement retention automation and verified expiration across logs and backups; interactive deletion already covers the primary database, blob, and provider-conversation stores.
7. Add a durable worker/queue for webhook processing and provider reconciliation. The database inbox is durable, but processing currently occurs inline.
8. Add SAST/DAST, dependency monitoring, penetration testing, and incident response procedures.
9. Review prompts/tools against prompt injection from documents, web results, and counterparties.

## Calling safety

WrenchBid must represent the customer, state that it is AI when asked, never invent repair scope or a competing quote, and end every call in a structured outcome. It does not diagnose repairs, give safety advice, book work, or make payments.

No automatic retry follows an ambiguous outbound-call timeout. An operator must reconcile the provider conversation/call ID before deciding whether another call is lawful and appropriate.

## Credential incident note

Provider credentials were shared in the initiating chat. Treat all three as compromised: revoke/rotate them, inspect provider audit/spend logs, and configure replacements only in the deployment secret store. This repository contains placeholders, not those values.

## Network exposure

The Compose port binds to `127.0.0.1` unless `APP_HOST` is deliberately changed. External binding requires a firewall and TLS reverse proxy; configure `PUBLIC_APP_URL` to the exact public origin before starting production. A mismatched value rejects legitimate browser mutations, while a carelessly trusted public value weakens the intended CSRF boundary.
