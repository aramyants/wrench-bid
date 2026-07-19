# Verification ledger

Last verified: 2026-07-19

This file records reproducible evidence, not intended behavior. Run the checks again after changing dependencies, migrations, request ownership, document handling, provider code, or deployment configuration.

## Verified baseline

| Check                                                         | Result                                                                                     |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `npm run typecheck`                                           | Pass                                                                                       |
| `npm run test`                                                | Pass: 19 tests across 6 files                                                              |
| `npm run lint`                                                | Pass: 0 errors; 6 existing Fast Refresh warnings in generated-style UI primitives          |
| `npm run build`                                               | Pass                                                                                       |
| `docker compose build app`                                    | Pass; build stage also runs typecheck, tests, and production build                         |
| `docker compose config --quiet`                               | Pass with local defaults; `.env.local` is intentionally absent from the verified workspace |
| `npm audit` and `npm audit --omit=dev`                        | Pass: 0 known vulnerabilities                                                              |
| Secret-pattern scan outside generated output and dependencies | Pass: no supplied provider key patterns found                                              |

## Runtime and database

- PostgreSQL 17 started from `compose.yaml`, reached healthy state, and applied the ordered `0001`–`0003` migrations. The migration runner uses a PostgreSQL advisory lock; both clean install and in-place upgrade paths are checked before release.
- The production app container runs as a non-root user with a read-only root filesystem, dropped Linux capabilities, `no-new-privileges`, a writable upload volume, and a bounded `/tmp` filesystem.
- `GET /api/health` returned HTTP 200 with database readiness. With no local provider credentials, Tavily, voice intake, outbound calls, and negotiation calls correctly reported unavailable.
- A hostile cross-origin multipart request to `POST /api/requests` returned HTTP 403.
- The production response included COOP, Permissions Policy, Referrer Policy, HSTS, `nosniff`, frame denial, and cross-domain-policy denial headers.
- Docker exposed only `127.0.0.1:3000`; the app container was healthy, non-root (`wrenchbid`), read-only, capability-free, and configured with `no-new-privileges`.

## Configuration and ingress boundary

- Seven focused unit tests passed for strict environment boolean conversion, safe handling of blank optional `.env.example` placeholders, value trimming, local origin behavior, and production validation against `PUBLIC_APP_URL` behind an internal proxy URL.
- Four quote-evidence tests passed for grouped values, exact cent matching, sentence-ending punctuation, the `600` versus `1,600` boundary, and shop-only evidence. Five ranking tests passed, including neutral wording for a revision that is not proven to be an improvement.
- `docker compose config --quiet` passed, and the rendered app port has `host_ip: 127.0.0.1` by default. Intentional external ingress requires an explicit `APP_HOST` override.
- npm is declared as the package manager, `package-lock.json` remains the deployment/CI lock, and the stale Bun lockfile is absent.

## Reversible PDF lifecycle

The supplied reference PDF was exercised against the production Docker image, not only the development server:

1. Upload with explicit consent created a tenant-scoped live request.
2. PDF.js extracted text and proposed three operations.
3. An authorized read returned the request and draft RepairSpec.
4. Manual updates set the required vehicle, location, schedule, and operation fields.
5. Completing all three location children marked parent `fieldMeta.location` as `verified`.
6. Confirmation produced status `confirmed`, moved the session to `spec_confirmed`, and created a 64-character SHA-256 spec hash.
7. A post-confirmation update returned HTTP 409, demonstrating immutability.
8. Permanent deletion returned success; a subsequent read returned HTTP 404.
9. PostgreSQL contained no remaining session/document rows and the protected upload volume contained no remaining file.

A separate two-tenant deletion regression used two opaque project cookies. Tenant B received HTTP 404 when deleting Tenant A's request; Tenant A could still read it with HTTP 200, then delete it successfully, after which the owner read returned HTTP 404. Final counts for sessions, documents, shops, campaigns, calls, quotes, and webhook events were all zero, and the upload volume was empty.

This run caught and fixed two production-only PDF issues: the PDF.js worker was not included in the server bundle, and PDF.js could detach the buffer before private-file persistence. Failure paths now remove partially written or unreferenced uploads.

## Browser verification

The production site at `http://localhost:3000` was checked with browser automation:

- Home rendered meaningful content with no development error overlay and no console errors.
- The recorded demo campaign rendered successfully.
- The negotiation approval screen rendered its target, leverage quote, approved asks, and pending call state without console errors.
- The live request page rendered the upload, consent, and sample controls with no development error overlay or console errors.

## Not verified with live providers

No provider secret was written to this repository and no real business was called. The following require fresh rotated credentials and operator-owned configuration:

- ElevenLabs intake, caller, and negotiator agents; telephony number; structured data; signed webhook delivery; audio retrieval; and conversation deletion.
- Tavily live shop discovery and cost/quality evaluation.
- Role-play fixtures for interruption, disclosure, refusal, callback, voicemail, hard sell, ambiguous provider timeouts, duplicate webhooks, revised quotes, and invented-leverage resistance.
- The unidentified Woz credential. It remains inert until its provider, base URL, and API contract are documented.

## Release boundary

The verified build is appropriate for a private pilot after provider setup, legal/recording-consent review, backups, monitoring, and role-play evaluation. Before public launch, add real authentication/authorization, disable anonymous project creation, add a durable webhook/dispatch worker and retention scheduler, establish an OCR path for scanned PDFs, and license a repair-price benchmark source.

Keep `OUTBOUND_CALLS_ENABLED=false` until all ElevenLabs IDs, the telephony number, webhook secret, suppression policy, consent copy, and monitoring are validated together.
