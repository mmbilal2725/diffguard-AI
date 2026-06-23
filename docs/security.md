# Security

DiffGuard-AI defaults to local development settings, but production services
validate security-sensitive environment variables at startup and fail fast when
required secrets are missing.

## Required Production Configuration

Set `NODE_ENV=production` for deployed API and worker processes.

API production requirements:

- `DATABASE_URL`
- `OPENAI_API_KEY`
- `DIFFGUARD_ALLOWED_ORIGINS`
- `GITHUB_WEBHOOK_SECRET` when GitHub App webhook mode is enabled
- `DIFFGUARD_DASHBOARD_API_KEY` unless `DIFFGUARD_DEMO_MODE=true`

Worker production requirements:

- `GITHUB_APP_ID`
- `GITHUB_APP_PRIVATE_KEY`
- `OPENAI_API_KEY`

Do not use `DIFFGUARD_DEMO_MODE=true` for production deployments. It permits
dashboard reads without the dashboard API key and is intended only for local
demo workflows.

## API Hardening

The API adds security headers to responses:

- `Cache-Control: no-store`
- `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'; base-uri 'none'`
- `Cross-Origin-Resource-Policy: same-site`
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`
- `Referrer-Policy: no-referrer`
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`

Request bodies are capped by `DIFFGUARD_BODY_LIMIT_BYTES`, default `1048576`.
Oversized webhook requests are rejected before delivery persistence or queueing.

## CORS

Production CORS must be explicit. Set `DIFFGUARD_ALLOWED_ORIGINS` to a
comma-separated list of trusted dashboard origins, for example:

```bash
DIFFGUARD_ALLOWED_ORIGINS=https://diffguard.example.com
```

Wildcard origins are rejected in production. Server-to-server requests without
an `Origin` header are allowed.

## Authentication

Dashboard API routes require either:

- `Authorization: Bearer <DIFFGUARD_DASHBOARD_API_KEY>`
- `X-DiffGuard-API-Key: <DIFFGUARD_DASHBOARD_API_KEY>`

GitHub webhooks require `X-Hub-Signature-256` signed with
`GITHUB_WEBHOOK_SECRET`.

## Rate Limits

Public API requests are rate limited per client IP. Configure:

```bash
DIFFGUARD_RATE_LIMIT_MAX_REQUESTS=120
DIFFGUARD_RATE_LIMIT_WINDOW_MS=60000
```

## Secret Logging

Structured logs redact secret-like values before serialization. Do not log raw
authorization headers, OpenAI API keys, GitHub tokens, installation tokens,
private keys, webhook secrets, or full prompt contents.
