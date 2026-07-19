# Operations

## Local Docker deployment

```bash
cp .env.example .env.local
docker compose --env-file .env.local up --build
docker compose --env-file .env.local ps
```

The app runs as an unprivileged user with all Linux capabilities dropped, a read-only root filesystem, a small `/tmp` tmpfs, and a dedicated upload volume. PostgreSQL and uploads use named persistent volumes.

Compose publishes the app only on `127.0.0.1` by default. For intentional LAN or internet ingress, set `APP_HOST=0.0.0.0` and place the host behind an explicitly configured firewall and TLS reverse proxy. Do not expose the container port directly. `PUBLIC_APP_URL` must be the exact browser-facing origin (scheme, host, and non-default port, if any); production mutation checks use that origin rather than the container's internal request URL.

Useful commands:

```bash
docker compose --env-file .env.local logs -f app
docker compose --env-file .env.local exec app node scripts/migrate.mjs
docker compose --env-file .env.local down
```

Do not add `-v` to `docker compose down` unless you explicitly intend to erase the database and upload volumes.

## Health and readiness

`GET /api/health` returns `200` only when PostgreSQL is reachable. It returns capability booleans but never secret values. Container health checks use this endpoint.

## Migrations

`scripts/migrate.mjs` takes a PostgreSQL advisory lock, applies sorted SQL files once, and records them in `schema_migrations`. The app container runs migrations before starting. Never edit an already-applied production migration; add a new numbered SQL file.

## Backup and restore

Back up both PostgreSQL and the upload volume as one retention unit:

```bash
docker compose --env-file .env.local exec -T database pg_dump -U wrenchbid -d wrenchbid -Fc > wrenchbid.dump
docker run --rm -v wrenchbid_upload_data:/source:ro -v "$PWD:/backup" alpine:3.22 tar -czf /backup/wrenchbid-uploads.tgz -C /source .
```

Store both files encrypted as one recovery set. Test restoration only against an isolated empty stack: restore `wrenchbid.dump` with `pg_restore`, then extract `wrenchbid-uploads.tgz` into that stack's upload volume. A database-only restore leaves missing source blobs; an upload-only restore leaves unreferenced blobs. The volume name is stable because Compose declares the project name `wrenchbid`.

## Retention

The application supports user-triggered cascading deletion. `RETENTION_DAYS` is reserved in configuration, but an automated retention job is not yet implemented. Before a public launch, schedule a transaction that deletes expired sessions and then safely removes returned storage keys. Record aggregate deletion metrics without retaining personal payloads.

## Production deployment

- Use the Node/Nitro output (`.output/server/index.mjs`), not `vite preview`.
- Terminate TLS at a trusted reverse proxy and set `PUBLIC_APP_URL` to the exact public HTTPS origin. WrenchBid does not trust an inbound `Host` header for production mutation-origin decisions.
- Use managed PostgreSQL with TLS, automated backups, point-in-time recovery, and least-privilege credentials.
- Replace local upload storage with encrypted object storage or ensure the persistent volume is encrypted and backed up.
- Set a strong database password; do not use Compose defaults outside local development.
- Put provider keys in the platform secret manager.
- Keep `OUTBOUND_CALLS_ENABLED=false` until authentication, provider/webhook configuration, and a role-play test pass. Then set a conservative daily campaign limit and suppression list.
- Add centralized structured logs/metrics and alerts for failed dispatches/webhooks, provider spend, and database health.
- Add per-project rate/spend limits and a suppression list before opening registration.

## Version control

This workspace currently has no `.git` directory. Initialize a repository (or restore the original history, if one exists elsewhere) before release-level work. Keep published history linear and avoid rebasing/amending/squashing pushed commits as required by `AGENTS.md`.

## Dependency verification

The latest documented release check reported zero vulnerabilities from both `npm audit` and `npm audit --omit=dev`. Re-run both after dependency changes; a clean historical result is not a substitute for current CI/deployment scanning.

Use npm for dependency operations and commit `package-lock.json`. The stale Bun lockfile was removed; do not add another package-manager lock unless the project deliberately migrates and CI, Docker, and this runbook are updated together.
