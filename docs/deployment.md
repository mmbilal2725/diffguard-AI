# DiffGuard-AI Deployment

This guide runs DiffGuard-AI as a self-hosted Docker deployment with Postgres,
Redis, the API, the review worker, and the web dashboard.

## Prerequisites

- Docker with Compose v2.
- A GitHub App id, private key, and webhook secret.
- An OpenAI API key for production review and validation.
- A strong dashboard API key shared by the API and web app.

## Configure Environment

Create an environment file outside source control, for example
`.env.production`.

```bash
POSTGRES_PASSWORD=replace-with-a-strong-password
GITHUB_WEBHOOK_SECRET=replace-with-your-github-webhook-secret
GITHUB_APP_ID=123456
GITHUB_APP_PRIVATE_KEY=replace-newlines-with-\n-or-use-your-secret-manager
OPENAI_API_KEY=replace-with-your-openai-api-key
DIFFGUARD_DASHBOARD_API_KEY=replace-with-a-strong-dashboard-key
DIFFGUARD_ALLOWED_ORIGINS=https://diffguard.example.com
```

Optional settings:

```bash
POSTGRES_DB=diffguard
POSTGRES_USER=diffguard
DIFFGUARD_API_PORT=3001
DIFFGUARD_WEB_PORT=3000
REVIEW_QUEUE_NAME=diffguard-review-runs
OPENAI_RESOLUTION_MODEL=gpt-5.5
DIFFGUARD_REVIEW_PASSES=logic-bugs,security-bugs,regression-test-gaps
DIFFGUARD_STATIC_CHECKS=true
```

`docker-compose.prod.yml` derives `DATABASE_URL` for the API and worker from
the Postgres settings above. Override it only if you point the services at an
external Postgres database.

Do not commit `.env.production`. The Dockerfiles do not bake secrets into
images; secrets are read from environment variables at container runtime.

## Build Images

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production build
```

The app images use Node.js 20, enable pnpm through Corepack, and install
workspace dependencies with pnpm filters for the target app and its local
workspace dependencies.

## Run Database Migrations

Start Postgres and Redis first:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production up -d postgres redis
```

Run Prisma migrations from the API image:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production run --rm api pnpm --filter @diffguard/database exec prisma migrate deploy
```

Use `prisma migrate deploy` in production. Do not run `prisma migrate dev`
against production databases.

## Start Production Services

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

The default published ports are:

- API: `http://localhost:3001`
- Web dashboard: `http://localhost:3000`

Check service health:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production ps
docker compose -f docker-compose.prod.yml --env-file .env.production logs api worker web
```

## Update Deployment

For a new release:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production build
docker compose -f docker-compose.prod.yml --env-file .env.production run --rm api pnpm --filter @diffguard/database exec prisma migrate deploy
docker compose -f docker-compose.prod.yml --env-file .env.production up -d
```

## Observability

Services write structured JSON logs to stderr/stdout. Log entries include
request ids, webhook delivery ids, BullMQ job ids, repository, PR number,
review run id, status, duration, model name, token usage, estimated cost, and
validator rejection rate where those fields are available. Secret-like values,
raw authorization headers, private keys, API keys, installation tokens, and
prompt contents are redacted before logging.

Health and metrics endpoints:

- API health: `GET /health`
- API database connectivity: `GET /health/database`
- API Redis connectivity: `GET /health/redis`
- API readiness: `GET /health/ready`
- API metrics: `GET /metrics`
- Worker health: `GET /health` on `WORKER_HEALTH_PORT` inside the worker
  container, default `3002`
- Worker readiness: `GET /ready` on `WORKER_HEALTH_PORT`
- Worker metrics: `GET /metrics` on `WORKER_HEALTH_PORT`

The Docker healthchecks use the API `/health`, worker `/ready`, and web root
endpoint. Keep these endpoints behind your private network or ingress controls;
they expose operational counters but no secrets.
