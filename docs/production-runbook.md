# Production Runbook

This runbook describes the minimum production-style deployment path for FluentOps.

## Preconditions

- A Linux host with Docker Engine and Docker Compose v2.
- DNS for the public app host points to the host or its load balancer.
- TLS certificates are available at `infra/nginx/certs/fullchain.pem` and `infra/nginx/certs/privkey.pem`, unless TLS is terminated upstream.
- `pnpm verify:local` has passed on the release candidate.
- `pnpm verify:prod:smoke` has passed on a Docker-capable Linux host or in CI.
- Real provider credentials are available for OpenAI, Alipay, and Resend.

## Environment File

Create `.env.prod` from `.env.prod.example`, generate local secrets, and replace every remaining `REPLACE_ME` or `example.com` value.

```bash
pnpm init:prod-env
```

The script fills database, Redis, JWT, refresh-token, MinIO, and image-tag values with random defaults. It does not fill public domains or third-party provider credentials. If `.env.prod` already exists, the script refuses to overwrite it unless you pass `--force`.

Required production values:

| Variable | Requirement |
|----------|-------------|
| `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` | Non-default database credentials |
| `REDIS_PASSWORD` | Required by the production Redis service |
| `JWT_SECRET`, `REFRESH_SECRET` | Different random values, 24+ characters each |
| `CORS_ORIGIN` | Public web origin, for example `https://app.example.com` |
| `COOKIE_DOMAIN` | Blank for same-host deployments, or an apex domain such as `.example.com` |
| `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY` | Non-default object storage credentials |
| `MINIO_PUBLIC_URL` | Public HTTPS object URL base; with the bundled edge proxy use `https://app.example.com/objects` |
| `AI_PROVIDER`, `OPENAI_API_KEY` | `AI_PROVIDER=openai` plus a valid key |
| `BILLING_PROVIDER`, `ALIPAY_*` | `BILLING_PROVIDER=alipay` plus app, public/private key, gateway, and a notify URL ending in `/api/v1/billing/alipay/notify` |
| `EMAIL_PROVIDER`, `EMAIL_FROM`, `RESEND_API_KEY` | `EMAIL_PROVIDER=resend` plus sender and API key |
| `VITE_API_BASE_URL` | `/api/v1` for same-host nginx, or the full API URL for split hosts |
| `FLUENTOPS_IMAGE_TAG` | Release identifier used by the API and web image tags |
| `EDGE_HTTP_PORT`, `EDGE_HTTPS_PORT` | Host ports for edge nginx; default to `80` and `443` |
| `FLUENTOPS_VOLUME_PREFIX` | Docker volume prefix; default `fluentops` produces `fluentops_pg_data` and `fluentops_minio_data` |
| `NGINX_CERTS_DIR` | Certificate directory relative to `infra/docker-compose.prod.yml`; default `./nginx/certs` |
| `CURL_IMAGE` | Helper image used by the `minio-ready` readiness service; default `curlimages/curl:8.11.1` |

The API refuses to start in `NODE_ENV=production` with mock providers, missing real-provider credentials, default MinIO credentials, weak token secrets, missing Redis, or missing CORS origin.
In production, `/health` returns `503` unless Postgres, Redis, and MinIO object storage are all ready.

## Release Steps

Run from the repository root on the deployment host:

```bash
pnpm verify:local
pnpm verify:prod:compose
pnpm verify:prod
pnpm verify:prod:smoke
docker compose -f infra/docker-compose.prod.yml --env-file .env.prod build
docker compose -f infra/docker-compose.prod.yml --env-file .env.prod up -d
docker compose -f infra/docker-compose.prod.yml --env-file .env.prod ps
```

`pnpm verify:prod:smoke` is a production-compose smoke test, not a real deployment. It generates a temporary `.env.prod` equivalent, self-signed TLS certificates, isolated Docker volumes, and high edge ports, then waits for the public edge `/health` endpoint and the web shell before tearing everything down. It requires Docker and OpenSSL; use `node ./scripts/prod-smoke.mjs --dry-run` only to validate the generated inputs on machines that cannot run Docker.

The production compose file includes a one-shot `migrate` service. `api-gateway` waits for `migrate` to finish successfully before starting, so a fresh Postgres volume gets Prisma migrations before the API serves traffic.

For an explicit migration-only pass:

```bash
docker compose -f infra/docker-compose.prod.yml --env-file .env.prod run --rm migrate
```

## Health Checks

Verify the public edge after deployment:

```bash
curl -fsS https://your-domain.example/health
curl -fsS https://your-domain.example/objects/minio/health/live
curl -fsS https://your-domain.example/
```

Verify containers:

```bash
docker compose -f infra/docker-compose.prod.yml --env-file .env.prod ps
docker compose -f infra/docker-compose.prod.yml --env-file .env.prod logs --tail=100 api-gateway
```

Expected API health:

- `status: "ok"`
- `db: "up"`
- `redis: "up"`
- `storage: "up"`

## Backups

Before every release, take both a Postgres backup and a MinIO data backup. Run from the repository root on the deployment host:

```bash
mkdir -p backups
set -a
. ./.env.prod
set +a
VOLUME_PREFIX="${FLUENTOPS_VOLUME_PREFIX:-fluentops}"

docker compose -f infra/docker-compose.prod.yml --env-file .env.prod exec -T postgres \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc \
  > "backups/fluentops-postgres-$(date +%Y%m%d%H%M%S).dump"

docker run --rm \
  -v "${VOLUME_PREFIX}_minio_data:/data:ro" \
  -v "$PWD/backups:/backup" \
  alpine sh -c 'cd /data && tar czf /backup/fluentops-minio-$(date +%Y%m%d%H%M%S).tgz .'
```

Copy backup files off the host after creation. Local Docker volumes are not a durable backup boundary.

## Restore Drill

Test restore on a non-production host before relying on backups:

```bash
set -a
. ./.env.prod
set +a
VOLUME_PREFIX="${FLUENTOPS_VOLUME_PREFIX:-fluentops}"

docker compose -f infra/docker-compose.prod.yml --env-file .env.prod down
docker volume rm "${VOLUME_PREFIX}_pg_data" "${VOLUME_PREFIX}_minio_data"
docker compose -f infra/docker-compose.prod.yml --env-file .env.prod up -d postgres minio

docker compose -f infra/docker-compose.prod.yml --env-file .env.prod exec -T postgres \
  pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists \
  < backups/fluentops-postgres-YYYYMMDDHHMMSS.dump

docker run --rm \
  -v "${VOLUME_PREFIX}_minio_data:/data" \
  -v "$PWD/backups:/backup:ro" \
  alpine sh -c 'cd /data && tar xzf /backup/fluentops-minio-YYYYMMDDHHMMSS.tgz'

docker compose -f infra/docker-compose.prod.yml --env-file .env.prod up -d
```

After restore, re-run the health checks and exercise login, assessment submission, media upload, billing sandbox verification, and AI coach request flow.

## Rollback

Application rollback is image-based:

1. Set `FLUENTOPS_IMAGE_TAG` in `.env.prod` to the previous release tag.
2. If the previous images already exist on the host, run `docker compose -f infra/docker-compose.prod.yml --env-file .env.prod up -d --no-build`.
3. If the previous images are not present, check out the previous source release, rebuild that tag, then run `docker compose -f infra/docker-compose.prod.yml --env-file .env.prod up -d`.
4. Re-check `/health`, API logs, and the web shell.

Database migrations are forward-only in this repo. Before running a release with a destructive migration, take a database backup and write a manual rollback note for that migration.

## Known Follow-Ups

- This runbook is not a managed-cloud HA architecture. Postgres and MinIO are local Docker volumes, so backups and host redundancy must be added before serious production traffic.
- Current local verification on Windows passed, but Docker was not available on that machine; `pnpm verify:prod:smoke` must pass in CI or on a Docker-capable host before release sign-off.
- Web production build is split into stable vendor chunks and currently completes without Vite chunk-size warnings. Continue watching bundle size as new frontend dependencies are added.
