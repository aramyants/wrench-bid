# Deployment

Canonical operational detail lives in `docs/OPERATIONS.md`; this is the exact-steps summary.

## Local / single-host production (Docker)

```bash
cp .env.example .env.local        # fill in secrets; never commit
docker compose --env-file .env.local up --build
```

- Postgres 17 starts first (healthcheck-gated); the app container runs `scripts/migrate.mjs` (advisory-locked, idempotent, clean-state safe) before `node .output/server/index.mjs`.
- The app publishes on `127.0.0.1:3000` by default. Expose it only behind TLS with `APP_HOST=0.0.0.0` and `PUBLIC_APP_URL` set to the exact public origin (production origin checks depend on it).
- Health/readiness: `GET /api/health` → 200 `status:"ready"` with DB latency, or 503 `status:"degraded"`; capability flags show which providers are configured without leaking values.
- Container hardening is on by default: non-root, read-only rootfs, dropped capabilities, `no-new-privileges`, bounded tmpfs, named volume for uploads.

## Bare Node (no Docker)

```bash
npm ci
npm run build
export DATABASE_URL=postgresql://...
node scripts/migrate.mjs
npm run start          # serves .output/server/index.mjs
```

## Provider configuration order

1. Set `ELEVENLABS_API_KEY` (arena voicing works with this alone).
2. Create intake/caller/negotiator agents per `docs/INTEGRATIONS.md`; set their IDs.
3. Set `TAVILY_API_KEY` for discovery + simulation grounding.
4. Leave `OUTBOUND_CALLS_ENABLED=false`. Enabling live outbound additionally requires phone-number ID, webhook secret, consent review, and the live role-play evaluation — none of which apply in this no-telephony environment.

## Rollback / clean state

Migrations are forward-only and idempotent; a clean database reaches head with one run. To reset locally: `docker compose down -v` (destroys data) and start again.
