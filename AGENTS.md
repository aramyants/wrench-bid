# Agent instructions

## Project handoff

- Start with `README.md` and `docs/AGENT_HANDOFF.md`.
- Read `docs/COUNTER_AGENT_DEMO.md` before changing `/demo/arena`, Counter Agent policies, or describing the demo as live.
- Architecture, integrations, operations, security, the internal API, and reproducible verification results are documented under `docs/`.
- Read `docs/VERIFICATION.md` before changing a production boundary or claiming a release is ready.
- Do not place provider secrets in source or any `VITE_*` variable.
- Live outbound calls require explicit user authorization and recording-consent confirmation; do not bypass those gates in tests.

## Repository conventions

- npm and `package-lock.json` are the canonical package manager and lock; do not introduce a second lockfile.
- Keep the default branch in a working state: `npm run typecheck`, `npm run test`, `npm run lint`, and `npm run build` must pass before pushing.
- Avoid rewriting published git history (force pushes, rebasing/amending/squashing pushed commits).
