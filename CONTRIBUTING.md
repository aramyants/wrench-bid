# Contributing

## Setup

```bash
npm ci                     # npm + package-lock.json are canonical; no second lockfile
npm run dev                # dev server
docker compose --env-file .env.local up --build   # full stack with PostgreSQL
```

## Before every push

```bash
npm run format:check && npm run lint && npm run typecheck && npm run test && npm run build
```

All of these run in CI; keep the branch green. `npm run test` includes the eval suite.

## Rules that protect the product's guarantees

- Never put a secret in source or any `VITE_*` variable.
- Never weaken the honesty invariants: AI disclosure, no fabricated leverage, no unauthorized commitments, structured outcomes. They are enforced by evals — if your change breaks one, the change is wrong, not the eval.
- Money arithmetic goes through `src/lib/wrenchbid/money.ts` (integer cents). Never add or subtract quoted amounts with raw floats.
- Confirmed RepairSpecs are immutable; corrections create new versions.
- Do not bypass consent/authorization gates in tests; do not enable `OUTBOUND_CALLS_ENABLED` without operator review.
- Adding an eval fixture: see `docs/EVALS.md`. Fill `expected` from an honest failing run, never by adjusting production code to fit.
- Keep git history linear; no force pushes to published branches (see `AGENTS.md`).
