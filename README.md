# RankLocal API

Backend for **RankLocal** — a free local-SEO audit engine. Given a business name + location, the API uses Google Places, PageSpeed Insights, and Claude to produce a scored, prioritized action plan for improving a business's Google presence.

Built with **NestJS + Prisma + PostgreSQL**.

> Source spec: `rank_local.md` (the original Next.js + MongoDB design, ported here to a standalone NestJS service with Postgres for v1).

---

## Quick start

```bash
# 1. Clone
git clone https://github.com/code55107/RankLocal.git
cd RankLocal

# 2. Boot Postgres
docker compose up -d

# 3. Install + configure
pnpm install
cp .env.example .env   # fill in API keys (see "Environment" below)

# 4. Migrate
pnpm prisma migrate dev --name init

# 5. Run
pnpm start:dev
```

- API:     `http://localhost:3001/api/v1`
- Health:  `http://localhost:3001/api/v1/health`
- Swagger: `http://localhost:3001/api/docs`

---

## Stack

| Layer | Choice |
|---|---|
| HTTP | NestJS 10 |
| ORM | Prisma 5 |
| Database | PostgreSQL 16 (JSONB for rich nested fields) |
| Validation | `class-validator` + `class-transformer` via global `ValidationPipe` |
| Config | `@nestjs/config` + Joi schema (`src/config/env.schema.ts`) |
| Logging | `nestjs-pino` (structured JSON in prod, `pino-pretty` in dev) |
| Throttling | `@nestjs/throttler` (global cheap-reject) + per-IP DB-backed audit rate limit |
| Scheduling | `@nestjs/schedule` (stale-audit cleanup cron) |
| External APIs | Google Places API (New), PageSpeed Insights, Anthropic Claude |
| Email | Resend (optional — no-op without API key) |
| Docs | `@nestjs/swagger` at `/api/docs` |

---

## Architecture

A single `Audit` row is the unit of work. It carries both **public report fields** (mapped into `AuditResult` on read) and **internal pipeline state** (input, raw API payloads, IP, current step). Nested structures are stored as JSONB so the rich `AuditResult` shape round-trips cleanly without N satellite tables for v1.

```
POST /audit
  └─► AuditService.submit()
        ├─ check rate limit (count audits by ipAddress in last 1h)
        ├─ INSERT audit (status: "pending")
        └─ void pipeline.run(id)        ◄── fire-and-forget, response returns now

       Pipeline (AuditPipelineService):
        ├─► [find]        Google Places Text Search
        │     ├─ 0 results  → status: failed, errorType: "not-found"
        │     ├─ 2+ results → matchedBusinesses set, GET returns "multiple_matches"
        │     └─ 1 result   → continue
        ├─► [profile]     Places Details + PageSpeed Insights → BusinessProfile
        ├─► [competitors] Nearby Search + per-competitor scoring + comparison signals
        ├─► [scoring]     Deterministic 15-item checklist across 4 categories
        ├─► [plan]        Claude → 6 recommendations  (static fallback on failure)
        └─ UPDATE audit (status: "completed", completedAt, result fields)
            └─► EmailService.sendAuditComplete()    (best-effort)

GET /audit/:id
  └─► returns AuditStatusResponse — discriminated union:
        { status: "pending" }
        { status: "processing", currentStep }
        { status: "completed", result: AuditResult }
        { status: "failed", errorType }
        { status: "multiple_matches", matches }
```

Each pipeline step writes `currentStep` to Postgres before running, so the polling endpoint reflects real-time progress.

A cron in `AuditCleanupService` runs every minute and flips audits stuck past `AUDIT_TIMEOUT_MS` (default 2 min) to `failed`/`timeout`, so the frontend stops polling when a serverless cold-kill leaves a row mid-flight.

---

## Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET`  | `/api/v1/health` | — | Liveness check |
| `POST` | `/api/v1/auth/register` | — | Create an email/password account, returns `{ token, user }` |
| `POST` | `/api/v1/auth/login` | — | Authenticate with email/password, returns `{ token, user }` |
| `POST` | `/api/v1/auth/logout` | Bearer | Invalidate the current session (idempotent), returns `{ success: true }` |
| `GET`  | `/api/v1/auth/session` | Bearer | Return the authenticated user, returns `{ user }` |
| `POST` | `/api/v1/auth/google` | — | Exchange a Google OAuth code for a session, returns `{ token, user }` |
| `POST` | `/api/v1/audit` | — | Submit a new audit. Returns `{ auditId }`; pipeline runs in background |
| `GET`  | `/api/v1/audit/:id` | — | Poll audit status — discriminated union (`pending` / `processing` / `completed` / `failed` / `multiple_matches`) |

> Auth endpoints return the raw shapes above (per `backend-auth-spec.md`), **not** the audit `{ success, data }` envelope. Sessions are opaque server-side tokens (`sess_<uuid>`) stored in the `sessions` table with a 30-day expiry; the backend never sets cookies — the frontend BFF owns cookie management and sends `Authorization: Bearer {token}`. Passwords are bcrypt-hashed (cost 12). Error codes: `VALIDATION_ERROR` (400), `EMAIL_EXISTS` (409), `INVALID_CREDENTIALS` / `UNAUTHORIZED` (401), `INVALID_CODE` (400), `GOOGLE_ERROR` (500).

### `POST /api/v1/audit`

```json
{
  "businessName": "Joe's Pizza Palace",
  "websiteUrl": "https://joespizzapalace.com",
  "location": "Austin, TX",
  "email": "joe@joespizzapalace.com"
}
```

Success (`201`):

```json
{ "success": true, "data": { "auditId": "clx9p3..." } }
```

Rate-limited (`429`):

```json
{ "error": "RATE_LIMIT", "message": "You've hit your audit limit for the hour." }
```

### `GET /api/v1/audit/:id`

Returns one of:

```json
{ "success": true, "data": { "status": "pending" } }
{ "success": true, "data": { "status": "processing", "currentStep": "competitors" } }
{ "success": true, "data": { "status": "completed", "result": { /* AuditResult */ } } }
{ "success": true, "data": { "status": "failed", "errorType": "not-found" } }
{ "success": true, "data": { "status": "multiple_matches", "matches": [ /* MatchedBusiness[] */ ] } }
```

See `src/types/audit.ts` for the full `AuditResult` shape (categoryScores, recommendations, competitors, etc.).

---

## Scoring (deterministic)

The scoring engine evaluates 15 checklist items across 4 categories. No AI is involved in the score itself — only in the recommendation phase.

| Category | Items | Weight |
|---|---|---|
| Profile | 5 (name, address, phone, hours, description) | 0.40 |
| Photos | 3 (count, recency, logo/cover) | 0.20 |
| Reviews | 4 (count, rating, response rate, recency) | 0.25 |
| Technical | 3 (website linked, load time, mobile-friendly) | 0.15 |

Special case — **no website**: all 3 technical items become `na`, and the 0.15 technical weight is redistributed proportionally to the other three categories (each divided by 0.85).

Rating thresholds: ≥80 excellent · ≥60 good · ≥40 average · ≥20 poor · <20 critical.

Full algorithm in `src/audit/pipeline/steps/scoring.service.ts`.

---

## AI recommendations

The `plan` step calls Claude (model: `claude-haiku-4-5-20251001`, temperature 0.3) with a system prompt that enforces:

- 6 recommendations, returned as a JSON array
- Max 3 `high`-priority, at least 1 `low`
- Each cites specific numbers from the audit (e.g. "You have 4 photos" not "few photos")
- No paid-ad or third-party-tool recommendations

The response is parsed and validated structurally. If parsing or validation fails — or Claude is unreachable — the service falls back to template recommendations generated from the highest-impact failing checklist items.

---

## Environment

Copy `.env.example` → `.env` and fill in:

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | Postgres DSN. Local default: `postgresql://ranklocal:ranklocal@localhost:5432/ranklocal?schema=public` |
| `GOOGLE_PLACES_API_KEY` | yes | Places API (New) — enable in GCP Console |
| `GOOGLE_PAGESPEED_API_KEY` | yes | PageSpeed Insights API |
| `ANTHROPIC_API_KEY` | yes | Claude API key (`sk-ant-...`) |
| `RESEND_API_KEY` | no | If unset, email send is skipped (pipeline still completes) |
| `MAIL_FROM` | no | Default `"RankLocal <audits@ranklocal.com>"` |
| `AUDIT_TIMEOUT_MS` | no | Default `120000` (2 min) — stale-audit reaper threshold |
| `RATE_LIMIT_MAX_PER_HOUR` | no | Default `10` audits per IP per rolling hour |
| `CORS_ORIGINS` | yes | Comma-separated frontend origins |
| `FRONTEND_URL` | no | Used in audit-complete email CTA |

Joi validates all of the above at startup in `src/config/env.schema.ts`. A missing required var fails fast.

---

## Project structure

```
src/
├─ main.ts                          # bootstrap (helmet, compression, CORS, Swagger, pipes, filter)
├─ app.module.ts                    # ConfigModule + LoggerModule + ScheduleModule + Throttler + feature modules
├─ app.controller.ts                # /health
├─ config/
│  └─ env.schema.ts                 # Joi env validation
├─ common/
│  ├─ filters/global-exception.filter.ts
│  ├─ exceptions/custom.exceptions.ts
│  └─ types/api-response.ts
├─ prisma/
│  ├─ prisma.module.ts              # @Global
│  └─ prisma.service.ts             # OnModuleInit / OnModuleDestroy
├─ external/
│  ├─ external.module.ts            # @Global
│  ├─ google-places.service.ts
│  ├─ google-places.types.ts
│  ├─ google-pagespeed.service.ts
│  └─ anthropic.service.ts
├─ audit/
│  ├─ audit.module.ts
│  ├─ audit.controller.ts           # POST /audit, GET /audit/:id
│  ├─ audit.service.ts              # submit + getStatus + markStaleAsTimedOut
│  ├─ audit-cleanup.service.ts      # cron (every minute) — timeout reaper
│  ├─ rate-limit.service.ts         # DB-backed per-IP rolling 1h limit
│  ├─ dto/create-audit.dto.ts
│  └─ pipeline/
│     ├─ audit-pipeline.service.ts  # orchestrator
│     ├─ types.ts                   # BusinessProfile, ScoringResult, FindResult
│     ├─ profile-mapper.ts          # PlaceDetails + PageSpeed → BusinessProfile
│     └─ steps/
│        ├─ find.service.ts
│        ├─ profile.service.ts
│        ├─ competitors.service.ts
│        ├─ scoring.service.ts
│        └─ plan.service.ts
├─ email/
│  ├─ email.module.ts
│  └─ email.service.ts              # Resend wrapper, no-op without API key
└─ types/
   └─ audit.ts                      # public contracts (AuditResult, AuditStatusResponse, ...)
prisma/
└─ schema.prisma                    # single Audit model
```

---

## Scripts

```bash
pnpm start:dev          # nest start --watch
pnpm start:debug        # nest start --debug --watch
pnpm build              # nest build
pnpm start              # node dist/main (after build)

pnpm lint               # eslint --fix
pnpm format             # prettier --write
pnpm test               # jest (unit)
pnpm test:e2e           # jest (e2e)

pnpm prisma:generate    # regenerate Prisma client
pnpm prisma:migrate     # prisma migrate dev (creates new migration)
pnpm prisma:deploy      # prisma migrate deploy (CI / prod)
pnpm prisma:studio      # open Prisma Studio against DATABASE_URL
```

---

## Failure modes

Every failure scenario maps to one of four `errorType` values:

| Scenario | `errorType` | Notes |
|---|---|---|
| Google Places returns 0 results | `not-found` | Surfaces in `GET /audit/:id` |
| Pipeline exceeds `AUDIT_TIMEOUT_MS` | `timeout` | Set by cleanup cron |
| IP exceeds hourly audit limit | `rate-limit` | Returned as `429` on `POST /audit` |
| Any unhandled error (Google quota, Claude error, DB) | `failure` | Generic catch-all |

Graceful degradations:

- PageSpeed fails → technical checklist items become `na`, weight redistributed
- Claude fails or returns invalid JSON → static template recommendations
- Competitor search fails → `competitors: []`, pipeline continues
- Email send fails → logged, audit still completes

---

## Deployment

The included `Dockerfile` produces a two-stage Alpine image (~120 MB) running as a non-root user on port `3001`. Pair it with `docker-compose.prod.yml` and an external Postgres instance (managed RDS / Render / Supabase / etc.).

CI checklist:

```bash
pnpm install --frozen-lockfile
pnpm prisma generate
pnpm build
pnpm prisma migrate deploy
node dist/main
```

---

## License

UNLICENSED — internal project.
