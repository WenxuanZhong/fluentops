# FluentOps

[中文文档](README.zh-CN.md)

Full-stack English learning platform — product-ready monorepo.

## Architecture

```
┌─────────────┐    workspace:*    ┌──────────────────┐    workspace:*    ┌─────────────┐
│  apps/web   │ ◄──────────────── │ packages/shared  │ ────────────────► │ api-gateway │
│  Vue 3 SPA  │                   │  TypeScript types │                   │   NestJS    │
└──────┬──────┘                   └──────────────────┘                   └──────┬──────┘
       │                                                                        │
       │ Axios + JWT                                              Prisma + JWT  │
       │                                                                        │
       └──────────────────────── REST / SSE ────────────────────────────────────┘
                                     │
                          ┌──────────┼──────────┐
                          ▼          ▼          ▼
                       Postgres    Redis      MinIO
```

| Decision | Rationale |
|----------|-----------|
| Monorepo (pnpm + Turborepo) | Single atomic commits, incremental builds via `turbo ^build` |
| Shared types package | Compile-time contract between frontend and backend — type drift breaks CI |
| Dual-token JWT | Short-lived access (15m) + rotating refresh tokens (SHA-256 hashed) |
| LangGraph.js pipeline | 4-step AI workflow with SSE streaming and sequence-based reconnection |
| Credit billing | Provider interface (`mock`/`alipay`) — CI-safe mock, production Alipay sandbox |
| Docker Compose infra | Postgres + Redis + MinIO — one command to spin up all dependencies |

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Vue 3, TypeScript, Vite 5, Pinia, Vue Router, Axios, Element Plus, Tailwind CSS v4, GSAP, native WebSocket, fetch-based SSE fallback |
| Backend | NestJS, Prisma 5, JWT, WebSocket gateway, Redis cache, scheduled maintenance tasks, Jest |
| Shared | TypeScript `tsc` build (types + utils) |
| Infra | Docker Compose, PostgreSQL, Redis, MinIO |
| CI | GitHub Actions — lint, typecheck, build, e2e |
| AI | LangChain.js, LangGraph.js, OpenAI (with mock provider for CI) |
| Visualization | Three.js hero scene, Canvas poster export, WebAssembly audio helper |
| Notifications | Email summary service (`mock` or Resend HTTP API) |

## Repository Layout

```
apps/
  web/                  # Vue 3 SPA
  api-gateway/          # NestJS API (auth, media, ai, billing modules)
packages/
  shared/               # Shared TypeScript types (@fluentops/shared)
infra/
  docker-compose.yml    # Postgres + Redis + MinIO
docs/
  api-reference.md      # Detailed curl examples
  interview-notes.md    # Technical pitch & Q&A
.github/
  workflows/ci.yml
```

## User Flows

- Register -> login -> refresh -> logout
- Load current user state on protected routes
- Record audio via WebRTC media capture -> upload to MinIO -> replay recording
- Submit text -> stream AI assessment progress via WebSocket first, with SSE fallback -> revisit history
- Check credits -> create order -> mock pay -> consume credits on assessment
- Email a finished assessment summary and export a shareable poster
- Handle empty, loading, and failure states across the core pages

## Quick Start

Prerequisites:

- Node.js 20.x or any newer LTS (Node 22 / 24 are accepted; CI runs on the latest LTS)
- Corepack enabled
- pnpm 9.15.4 via the repo `packageManager` contract
- Docker Desktop (for Postgres, Redis, MinIO)
- Supported local environments: Windows PowerShell, WSL2 on a glibc-based distro, and CI on Ubuntu

```bash
corepack prepare pnpm@9.15.4 --activate
pnpm install
pnpm doctor:env
pnpm infra:start
```

The workspace now installs optional native packages for both Windows x64 and WSL/Linux x64 glibc. This keeps a shared checkout usable from both PowerShell and WSL without losing Rollup/Vite/Vitest platform binaries after switching shells.

Create the API env file:

```bash
cp apps/api-gateway/.env.example apps/api-gateway/.env
```

PowerShell:

```powershell
Copy-Item apps/api-gateway/.env.example apps/api-gateway/.env
```

Run migrations and start the workspace:

```bash
cd apps/api-gateway && pnpm prisma migrate dev && cd ../..
pnpm dev
```

Web: http://localhost:5173 — API: http://localhost:3000

Root workspace commands (`pnpm dev`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`) are now cross-platform and work in PowerShell as well as bash.

Tooling helpers:

- `pnpm doctor:env` checks the pinned Node/pnpm contract, current OS/runtime details, Docker availability, and current-platform native frontend packages.
- `pnpm init:prod-env` creates `.env.prod` from the production template with generated local secrets; public domains and provider credentials still need real values.
- `pnpm toolchain:check` is the strict preflight used to enforce the same Node/pnpm contract in automation.
- `pnpm verify:local` runs the full local gate in order: `lint -> typecheck -> test -> build -> api-gateway e2e`.
- `pnpm verify:prod` checks the production compose and `.env.prod` release preflight; use `pnpm verify:prod:compose` when production secrets are unavailable.
- `pnpm verify:prod:smoke` builds and starts the production compose stack with temporary secrets, self-signed TLS certs, isolated volumes, and high ports; it requires Docker and OpenSSL.
- `pnpm verify:api:e2e` and `pnpm verify:api:e2e:realdb` give API-only verification entrypoints.
- `pnpm infra:start|stop|reset|status|logs|wait` standardize local Postgres/Redis/MinIO lifecycle management.
- `.nvmrc` and `.node-version` are set to `lts/*` so version managers pick the latest LTS by default. The `engines.node` contract is `>=20`.

## Local Infra

Recommended local startup order:

1. Run `pnpm infra:start` to bring up Postgres, Redis, and MinIO.
2. Copy `apps/api-gateway/.env.example` to `apps/api-gateway/.env` if you have not done it yet.
3. Run `pnpm --filter api-gateway prisma migrate dev`.
4. Start the apps with `pnpm dev`.

Infra helper commands:

```bash
pnpm infra:start   # docker compose up -d, then wait for readiness
pnpm infra:status  # local readiness check + docker compose ps when available
pnpm infra:logs    # tail docker compose logs
pnpm infra:stop    # stop infra containers
pnpm infra:reset   # stop infra containers and remove volumes
pnpm infra:wait    # only run readiness probes against localhost
```

Readiness checks and startup notes:

- Postgres readiness: TCP `127.0.0.1:5432`
- Redis readiness: TCP `127.0.0.1:6379`
- MinIO readiness: `GET http://127.0.0.1:9000/minio/health/live`
- `pnpm infra:status` and `pnpm infra:wait` probe localhost only; they confirm reachability, not whether Docker owns the running service.
- MinIO bucket creation is handled by the API on startup, so `infra:start` only ensures the service is reachable.
- `api-gateway` can start without Redis or MinIO, but those integrations will degrade or warn; the recommended local path is to wait until all three services are ready before running migrations and app servers.

## Design Highlights

### Type-Driven Contract

`packages/shared` exports types (`AuthTokens`, `UserProfile`, `CreditBalance`, `PlanDto`, `HealthResponse`) imported by both apps. Turborepo's `^build` dependency ensures shared compiles before consumers typecheck. A type change in shared breaks the build immediately if either side drifts.

### Dual-Token Auth

Access tokens (15m) are stateless JWTs. Refresh tokens rotate on every use — the old token is revoked and the new one stored as a SHA-256 hash. The frontend Axios interceptor queues concurrent 401 retries behind a single refresh call, preventing race conditions.

### AI Coach Pipeline

LangGraph.js orchestrates a 4-step workflow: diagnose → rewrite → drills → score. Results now stream first over a JWT-authenticated WebSocket gateway and fall back to SSE with `id:` sequence numbers for reconnection (`?since=N`). Setting `AI_PROVIDER=mock` swaps in a deterministic mock LLM — the full pipeline runs in CI without API keys.

### Credit Billing

A provider interface abstracts payment: `mock` for CI/dev (instant fulfillment), `alipay` for sandbox testing (async notify callback). A credit guard checks balance before AI calls.

### Realtime, Cache, and Automation

Redis is used as an optional cache layer for plan lookups and surfaces in `/health` as `up`, `down`, or `disabled`. MinIO object storage also surfaces in `/health` as `storage`; production health returns `503` unless Postgres, Redis, and MinIO are all ready. Scheduled maintenance jobs clean expired refresh tokens and cancel stale pending orders. Completed assessments can also be emailed through the notifications API.

## Recent Hardening

- Cross-platform Turborepo scripts for Windows PowerShell and bash
- Local e2e runs now default to an in-memory Prisma test adapter, while CI keeps real PostgreSQL coverage
- Atomic credit reservation before AI execution, plus idempotent refund on workflow failure
- Media uploads now verify the object exists before creating a recording row
- Assessment detail responses now include streamed drill / rewrite / issue data
- Redis-backed plan caching with graceful disablement when `REDIS_URL` is not configured
- WebSocket gateway for assessment progress, plus frontend singleton realtime composable with SSE fallback
- Three.js + GSAP product visuals, client-side poster export, and a lightweight WebAssembly audio helper
- Mock/Resend email summary delivery for completed assessments
- Scheduled cleanup jobs for refresh tokens and stale pending orders
- Global throttling now uses an initialization-safe guard, avoiding intermittent auth 500s during startup
- Stronger password guidance and route-level auth bootstrap on the frontend
- Dependency risk reduced via direct upgrades and `pnpm.overrides`

## Security

- CORS locked to `CORS_ORIGIN` (default `localhost:5173`), `credentials: true`
- Helmet security headers on all responses
- Global rate limiting (20 req/min), stricter on login/register (5 req/min)
- Refresh token rotation is atomic (no TOCTOU race on concurrent refresh)
- Credit deduction and order fulfillment use interactive Prisma transactions (no double-spend)
- SSE streams verify assessment ownership before emitting events
- Upload filenames sanitized against path traversal
- Alipay notify verifies both signature and `app_id`
- Error events return generic messages (no stack trace leaks)

See [docs/audit-report.md](docs/audit-report.md) for the full security audit.

## API Overview

### Auth

| Method | Path | Description |
|--------|------|-------------|
| POST | `/auth/register` | Register |
| POST | `/auth/login` | Login → `{accessToken, refreshToken}` |
| POST | `/auth/refresh` | Rotate tokens |
| POST | `/auth/logout` | Revoke refresh token |
| GET | `/me` | Current user profile |

### Media

| Method | Path | Description |
|--------|------|-------------|
| POST | `/media/presign` | Presigned upload URL |
| POST | `/media/complete` | Confirm upload |
| GET | `/media` | List recordings |
| GET | `/media/:id` | Detail + signed play URL |

### AI Coach

| Method | Path | Description |
|--------|------|-------------|
| POST | `/ai/assess` | Start assessment (costs 1 credit) |
| GET | `/ai/assess/:id` | Get result |
| GET | `/ai/assess/:id/stream` | SSE stream |
| GET | `/ai/assessments` | List recent |

### Billing

| Method | Path | Description |
|--------|------|-------------|
| GET | `/billing/plans` | List credit packs |
| GET | `/billing/balance` | Current balance |
| POST | `/billing/order` | Create order |
| POST | `/billing/mock/pay` | Mock payment (dev) |

See [docs/api-reference.md](docs/api-reference.md) for detailed curl examples.
See [docs/api-verification.md](docs/api-verification.md) for the end-to-end verification order, current automated coverage, and mock-vs-real provider boundaries.
See [docs/web-acceptance-checklist.md](docs/web-acceptance-checklist.md) for the manual browser acceptance pass.
See [docs/production-runbook.md](docs/production-runbook.md) and [.env.prod.example](.env.prod.example) for the production compose release path, required environment file, migration step, health checks, and rollback notes.

## Commands

```bash
pnpm lint          # ESLint (all packages)
pnpm typecheck     # TypeScript check
pnpm test          # Root unit test suite (shared + web + api-gateway)
pnpm build         # Production build
pnpm verify:local  # Full local gate: lint -> typecheck -> test -> build -> api e2e
pnpm init:prod-env # Create .env.prod with generated local secrets
pnpm verify:prod   # Production compose + .env.prod preflight
pnpm verify:prod:compose # Production compose/CI preflight without .env.prod secrets
pnpm verify:prod:smoke   # Docker-level production compose smoke with temp env/certs
pnpm verify:api:e2e        # API e2e in local in-memory mode
pnpm verify:api:e2e:realdb # API e2e against a real PostgreSQL path
pnpm infra:start   # Start Postgres + Redis + MinIO and wait for readiness
pnpm infra:status  # Inspect infra readiness
pnpm dev           # Dev servers (web + api)
pnpm audit         # Dependency audit (expect only low/moderate findings after overrides)

# API Gateway
cd apps/api-gateway
pnpm prisma migrate dev    # Run migrations
pnpm prisma studio         # Prisma Studio
pnpm test:e2e              # E2E tests (local in-memory mode by default)
E2E_USE_REAL_DB=true pnpm test:e2e   # Opt into the real PostgreSQL-backed flow
```

Root test verification:

- Run `pnpm test` from the repo root.
- Expected successful tail output: `Tasks: 3 successful, 3 total`.
- The run currently exercises `@fluentops/shared`, `web`, and `api-gateway`.
- During `api-gateway` unit tests you may see one `Health check DB probe failed` log line from `app.controller.spec.ts`; that log is expected because the test intentionally verifies the database-down branch while still passing overall.

Root build verification:

- Run `pnpm build` from the repo root.
- Expected successful tail output: `Tasks: 3 successful, 3 total`.
- The run currently builds `@fluentops/shared`, `web`, and `api-gateway`.
- The web production build now splits Vue, Element Plus, Three.js, motion, HTTP, and app code into separate chunks; the current build completes without Vite chunk-size warnings.

One-click local verification:

- Run `pnpm verify:local` from the repo root.
- Current order: `pnpm lint` -> `pnpm typecheck` -> `pnpm test` -> `pnpm build` -> `pnpm --filter api-gateway test:e2e`.
- The final success line is `[verify-local] All local verification steps passed.`
- `api-gateway` e2e uses the local in-memory Prisma adapter by default, so Docker is not required for this script unless you explicitly switch to the real database path.

## Environment Variables

See `apps/api-gateway/.env.example` for all variables. Key ones:

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` / `REFRESH_SECRET` | Token signing secrets |
| `MINIO_*` | MinIO connection (endpoint, port, keys, bucket) |
| `REDIS_URL` | Optional Redis connection string for cache + health |
| `AI_PROVIDER` | `mock` (default) or omit for OpenAI |
| `OPENAI_API_KEY` | Required when not using mock |
| `BILLING_PROVIDER` | `mock` (default) or `alipay` |
| `EMAIL_PROVIDER` | `mock` (default) or `resend` |
| `EMAIL_FROM` / `RESEND_API_KEY` | Optional email summary delivery config |

Ports: Postgres 5432, Redis 6379, MinIO 9000/9001, API 3000, Web 5173

## Troubleshooting

- `docker` command not found: install Docker Desktop or provide your own Postgres / Redis / MinIO endpoints in `apps/api-gateway/.env`.
- `pnpm infra:start` fails immediately with a Docker message: install Docker Desktop and verify `docker compose version` works, or skip the helper scripts and point `apps/api-gateway/.env` at externally managed Postgres / Redis / MinIO services.
- `pnpm infra:status` reports Postgres / Redis / MinIO as down: run `pnpm infra:logs` if Docker is available, or verify that the services are actually listening on `5432`, `6379`, and `9000`.
- `pnpm dev` or `pnpm doctor:env` reports a Node version mismatch: the workspace contract is Node `>=20` and pnpm 9.15.4. Install Node 20 or any newer LTS (Node 22 LTS works too), then rerun `pnpm doctor:env` to confirm the environment.
- `pnpm test:e2e` now uses an in-memory Prisma adapter locally, so it should run without Docker. To exercise the real database path, start Postgres first and run `E2E_USE_REAL_DB=true pnpm --filter api-gateway test:e2e`.
- `Cannot find module @rollup/rollup-linux-x64-gnu` in WSL: rerun `pnpm install` at the repo root. The workspace is configured to hydrate both Windows x64 and Linux x64 glibc optional native dependencies, but older `node_modules` trees need one reinstall to pick up the missing Linux package.
- `pnpm verify:local` stops at `test` or `build`: read the first failing package block above the final Turbo summary; the command is intentionally sequential so the earliest real failure is the one to fix first.
- `pnpm verify:local` fails at `api-gateway` e2e after the earlier phases passed: inspect the e2e output separately with `pnpm --filter api-gateway test:e2e`; the local default path is in-memory, so failures there usually mean an application regression rather than missing Docker services.
- `pnpm verify:api:e2e:realdb` fails before tests run: make sure Postgres is actually available at the `DATABASE_URL` you are exporting; the real-db mode does not create infrastructure for you.
