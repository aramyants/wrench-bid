# Agent instructions

WrenchBid: a negotiation engine for auto repair quotes. A confirmed,
immutable RepairSpec is negotiated against multiple simulated counterparties
(ElevenLabs voice agents); resulting quotes are normalized to itemized,
cent-exact line items with transcript evidence, then ranked. Entry for the
Hack-Nation × ElevenLabs "The Negotiator" challenge.

## Reading order

- `README.md`, then `docs/AGENT_HANDOFF.md`.
- `docs/COUNTER_AGENT_DEMO.md` before touching `/demo/arena` or Counter Agent
  policy, or before describing the demo as live.
- `docs/VERIFICATION.md` before changing a production boundary or claiming
  release readiness.
- Architecture, operations, security, and API docs are under `docs/`.

## Stack and layout

- TypeScript throughout. TanStack Start (React 19), Vite, Tailwind CSS 4,
  Radix UI, Zod, Zustand. Vitest for tests and evals.
- PostgreSQL 17 via the `postgres` driver. Migrations in `scripts/migrate.mjs`
  are idempotent and run under an advisory lock in Compose.
- Domain logic: `src/lib/wrenchbid/`. Server-only code (env, providers,
  sessions): `src/lib/wrenchbid/server/`. Deterministic evals:
  `src/lib/wrenchbid/evals/`.
- Providers are server-side only: ElevenLabs (conversation tokens, TTS,
  agents, HMAC-verified webhooks) and Tavily (shop discovery).

## Commands

npm is the package manager; `package-lock.json` is the only lockfile.

```bash
npm ci
npm run dev
npm run typecheck   # tsc --noEmit
npm run test        # vitest run
npm run eval        # deterministic eval suite (src/lib/wrenchbid/evals)
npm run lint
npm run build
npm run db:migrate  # requires DATABASE_URL exported and reachable
```

`typecheck`, `test`, `lint`, and `build` must pass before pushing.

## Invariants

- Secrets are server-side environment variables only. Nothing secret in
  source or in any `VITE_*` variable.
- Outbound telephony is capability-gated off in this environment. A live call
  requires database, ElevenLabs agents, a telephony number, consent checks, a
  verified E.164 destination, and `OUTBOUND_CALLS_ENABLED=true`. Do not
  bypass these gates in tests or demos.
- Currency is integer cents. No floating-point arithmetic in money paths.
- A confirmed RepairSpec is immutable; corrections produce a new version.
- Simulated counterparties stay labeled as simulated, and negotiation
  leverage comes only from stored, verified quotes. Both are enforced by
  `npm run eval`; keep it green.
- Do not rewrite published git history (force push, rebase/amend/squash of
  pushed commits).
