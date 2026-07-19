# Verification ledger

Last verified: 2026-07-19 (final security and lifecycle pass)

This file records reproducible evidence, not intended behavior. Run the checks again after changing dependencies, migrations, request ownership, document handling, provider code, or deployment configuration.

## 2026-07-19 final pass — security and lifecycle hardening

Executed locally after the session-destination, intake-conversation, provider-failure, deletion, evidence, and negotiation-policy changes in this pass:

| Check | Result |
| --- | --- |
| `npm run typecheck` | Pass |
| `npm run test` | Pass: 145 tests across 16 files |
| `npm run eval` | Pass: 76 golden-call eval checks over 14 fixtures |
| `npm run lint` | Pass: 0 errors; 6 pre-existing Fast Refresh warnings in generated UI primitives |
| `npm run format:check` | Pass |
| `npm run build` | Pass |
| `npm audit --omit=dev` | Pass: 0 known vulnerabilities |
| Tracked-file provider key-pattern scan | Pass: no matching provider key patterns |
| `docker compose config --quiet` | Pass with local defaults |
| Fresh PostgreSQL 17 migration run | Pass: `0001`–`0005` applied, then a second idempotency pass completed without new migrations |

Behavioral notes for this pass: verified destinations are snapshotted per session and outbound call; intake conversation IDs are retained for privacy-safe provider deletion; early provider-initiation failures are briefly deferred and transactionally reconciled; deletion requests remain retryable after partial provider failures; genuine leverage and approved negotiation improvements are validated in a shared policy module; and transcript evidence normalization rejects ambiguous or non-comparable totals. The live voice intake now registers its provider conversation from the ElevenLabs connection callback and immediately ends the session if registration fails.

## 2026-07-19 second pass — release hardening

Executed locally after the changes in this pass (transport-neutral session copy, sessionStorage arena persistence, integer-cents money module, env-configurable model IDs, currency-mismatch detection, six new golden-call fixtures, jury documentation package, expanded CI):

| Check | Result |
| --- | --- |
| `npm run typecheck` | Pass |
| `npm run test` | Pass: 102 tests across 9 files |
| `npm run eval` | Pass: 76 golden-call eval checks over 14 fixtures |
| `npm run lint` | Pass: 0 errors; 6 pre-existing Fast Refresh warnings in generated UI primitives |
| `npm run format:check` | Pass (new script; source is Prettier-clean) |
| `npm run build` | Pass |
| `npm audit --omit=dev` | Pass: 0 known vulnerabilities |
| CI secret-pattern scan (grep) | Pass: no provider key patterns outside dependencies |

Behavioral notes for this pass: campaign/session UI no longer uses dialing/ringing language for web sessions; completed Agent Arena results survive a browser refresh via sessionStorage (cleared by Reset); quote subtotals, savings, and red-flag ratios now compute in integer cents (IEEE-drift regression tests in `money.test.ts`); non-USD quotes gain a `currency_mismatch` warning and persist their stated currency.

## Verified baseline

| Check                                                         | Result                                                                                     |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `npm run typecheck`                                           | Pass                                                                                       |
| `npm run test`                                                | Pass: 58 tests across 8 files                                                              |
| `npm run eval`                                                | Pass: 36 golden-call evals in 1 file                                                       |
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
- The lockfile was regenerated with the npm version used by the Node 24 Docker image. A clean Linux `npm ci` now succeeds for both build and runtime stages.
- Two Counter Agent tests verify three distinct behaviors, spoken final totals, and that price changes only with verified stored leverage plus an approved price ask.

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
- `/requests/sess_demo_camry/extraction` rendered extracted repair details without the previous React maximum-update-depth failure or console errors.
- The negotiation approval screen rendered its target, leverage quote, approved asks, and **Approve & start** action. It no longer begins with a fake pending negotiation or a permanent waiting state.
- `/demo` redirected once to `/demo/arena`; the child route no longer loops through the parent redirect.
- The Agent Arena completed all three controlled conversations with spoken totals of $574.00, $616.69, and $645.00. The genuine-leverage round cited stored quote `q_budget` at $574.00 and revised Precision from $616.69 to $585.00, with no console errors.
- With a local server-only key, the fixed Budget arena scenario returned an ElevenLabs-generated
  `audio/mpeg` response (1,068,348 bytes with an ID3 header). This verifies TTS dialogue generation,
  not a live Conversational AI call; at that earlier check the account exposed zero configured agents.
- After configuring the caller agent, `POST /api/demo/simulate` returned 7 pre-termination turns and
  a two-voice ElevenLabs MP3 data URL (2,378,551 characters). The provider simulation scored the
  underlying quote conversation at 100; no phone number was dialed.
- The real-time simulation endpoint was subsequently converted to NDJSON streaming. After starting
  the fixed disclosure in parallel with provider generation, a production run emitted the Tavily
  source at 0.0s, the first voiced buyer turn at 0.6s, the shop response at 11.1s, three follow-up
  turns through 12.6s, and completion at 12.6s. The linked source was Woodie's Auto Service's
  Charlotte brake-service page; prices stayed explicitly separate as controlled simulation terms.
- A bounded Tavily basic search returned five real Charlotte-area brake-repair business pages. These
  remain untrusted leads requiring official-source phone verification before selection or calling.
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
