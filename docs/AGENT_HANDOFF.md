# Agent handoff

## Start here

Read, in order:

1. `AGENTS.md` for repository conventions.
2. `README.md` for status and commands.
3. `docs/ARCHITECTURE.md` for invariants and data flow.
4. `docs/COUNTER_AGENT_DEMO.md` before changing or presenting the synthetic arena.
5. `docs/INTEGRATIONS.md` before touching provider code.
6. `docs/SECURITY.md` before enabling public traffic or calls.
7. `docs/VERIFICATION.md` for the last reproducible release checks.

## Implementation map

| Area                         | Primary files                                            |
| ---------------------------- | -------------------------------------------------------- |
| Domain/Zod                   | `src/lib/wrenchbid/types.ts`                             |
| Vertical behavior            | `src/lib/wrenchbid/verticals/auto-repair.ts`             |
| Ranking/outliers/evidence    | `ranking.ts`, `quote-evidence.ts`                        |
| Call normalization/evals     | `call-normalization.ts`, `evals/` (see `docs/EVALS.md`)  |
| Database/migrations          | `migrations/`, `scripts/migrate.mjs`, `db.server.ts`     |
| Runtime configuration        | `env.server.ts`, `.env.example`, `compose.yaml`          |
| Project ownership            | `project-session.server.ts`                              |
| PDF ingestion/spec lifecycle | `document-extraction.server.ts`, `requests.server.ts`    |
| Tavily                       | `tavily.server.ts`                                       |
| ElevenLabs API/HMAC          | `elevenlabs.server.ts`, `elevenlabs-webhook.server.ts`   |
| Campaign/negotiation         | `campaigns.server.ts`, `negotiations.server.ts`          |
| Synthetic Counter Agents     | `counter-agents.ts`, `src/routes/demo.arena.tsx`         |
| Internal HTTP routes         | `src/routes/api.*.ts`                                    |
| Client API/cache sync        | `api.ts`, `store.ts`, `hooks/use-live-sync.ts`           |
| Deployment                   | `Dockerfile`, `compose.yaml`, `.github/workflows/ci.yml` |

## What changed from Phase 1

The original Phase 1 plan (`docs/PHASE1_PLAN.md`) intentionally specified a mock-only demo. The current code retains that replay but adds a real Node/PostgreSQL path. Fake uploads, disabled live discovery, scripted live-call advancement, globally hard-coded negotiation state, mutable confirmed specs, incomplete deletion, cross-session report evidence, and live `localStorage` persistence were addressed.

## Acceptance status

| Brief requirement                             | Status                                                                                      |
| --------------------------------------------- | ------------------------------------------------------------------------------------------- |
| One auto-repair vertical                      | Implemented/config-driven                                                                   |
| PDF and voice converge on RepairSpec          | Implemented; local ElevenLabs intake agent/tool configured for WebRTC                        |
| User-confirmed immutable spec reused per call | Implemented with campaign snapshot/hash                                                     |
| Three distinct counterparties/styles          | Deterministic arena now reveals and voices each turn in real time                            |
| Itemized comparable quotes                    | Webhook normalizer implemented; agent data-collection keys must be configured               |
| Genuine-leverage negotiation                  | Implemented; measurable improvement depends on a real shop response                         |
| AI honesty and friction handling              | Prompt policy/dynamic variables implemented; must be evaluated with live calls              |
| Structured terminal outcomes                  | Implemented as monotonic transactional webhook transitions                                  |
| Evidence-aware ranking/report                 | Exact shop-turn token matching implemented; live quality still needs evaluation             |
| Real vertical benchmark source                | Not complete; current outlier benchmark is the campaign median                              |

## Immediate next tasks

1. Rotate all exposed keys.
2. Create/configure three ElevenLabs agents, phone integration, structured data fields, and HMAC webhook using `docs/INTEGRATIONS.md`.
3. Run a role-play evaluation suite before calling real businesses. Verify interruption, “are you a robot?”, refusal, callback, hard sell, and invented-leverage defenses. The offline golden-call evals (`npm run eval`, `docs/EVALS.md`) are the deterministic baseline for this; live role-play remains mandatory.
4. Add public-product authentication and replace/disable anonymous project creation.
5. Add a real auto-repair benchmark/licensed data source; do not scrape a source without permission.
6. Move webhook processing to a durable worker and implement scheduled retention; interactive provider-conversation deletion is already wired.
7. Convert the recorded browser checks into a repeatable CI end-to-end suite and add provider contract fixtures.

## Verification ledger

The dated results and reproduction commands live in `docs/VERIFICATION.md`. Update that file after every release-level check instead of relying on chat history. Provider webhook fixtures and real role-play calls remain outstanding and must not be marked complete without evidence.

## Repository caveat

Version control is restored (branch `codex/restore-wrench-bid-project`; default branch `main`). Keep published history linear; see `AGENTS.md` for the Lovable-sync constraint against rewriting pushed history.
