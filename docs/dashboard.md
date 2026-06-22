# Dashboard

The `apps/web` dashboard is a Next.js App Router UI for DiffGuard-AI review operations.

Current routes:

- `/dashboard`: resolution tracking cards, review trend charts, cost and latency charts, and recent review runs.
- `/dashboard/reviews`: review run list with status, repository, PR number, findings count, cost, and latency.
- `/dashboard/reviews/[id]`: run details, findings, validator decisions, model calls, and GitHub comment status.
- `/dashboard/repos`: connected repository settings, confidence thresholds, and max findings per PR.
- `/dashboard/evals`: eval precision, recall, false positives, false negatives, and cost per run.
- `/settings`: model, threshold, GitHub, and API key configuration placeholders.

The dashboard loads real data from `apps/api` by default through `apps/web/src/lib/dashboard-data.ts`. Set `DIFFGUARD_API_BASE_URL` for the web app when the API is not running at `http://localhost:3001`.

Dashboard API access is protected with `DIFFGUARD_DASHBOARD_API_KEY`. Configure the same value for `apps/api` and `apps/web`; the web app sends it server-side as `Authorization: Bearer ...` and never exposes it through `NEXT_PUBLIC_*`. The API also accepts `x-diffguard-api-key` for non-browser service clients. Missing or invalid credentials return a generic `401` without echoing the supplied key.

`apps/api` also enforces browser origin checks and per-client rate limits. Set `DIFFGUARD_ALLOWED_ORIGINS` to a comma-separated list of dashboard origins that may call the API from a browser. Requests with an `Origin` header outside that list are rejected with `403`. Server-to-server dashboard requests without an `Origin` header are allowed only after the dashboard API key is validated. Rate limits default to `120` requests per `60000` ms and can be adjusted with `DIFFGUARD_RATE_LIMIT_MAX_REQUESTS` and `DIFFGUARD_RATE_LIMIT_WINDOW_MS`; client identity is read from `x-forwarded-for`, then `x-real-ip`, then the socket IP.

Dashboard responses are runtime-validated before they are sent. If a store returns an unexpected shape, the API returns a generic validation error instead of serializing raw database fields, secrets, API keys, GitHub private keys, or installation tokens.

Dashboard API endpoints:

- `GET /dashboard/overview`: aggregate metrics plus review trend data.
- `GET /dashboard/review-runs`: latest review runs.
- `GET /dashboard/review-runs/:id`: review run detail with findings, validator decisions, and model-call telemetry.
- `GET /dashboard/repositories`: connected repositories and dashboard settings.
- `GET /dashboard/findings`: latest findings.
- `GET /dashboard/evals`: persisted eval summaries from `diffguard-ai eval run` when `DATABASE_URL` is configured.

Mock data is retained only for local demo mode. Set the server-side environment variable `DIFFGUARD_DEMO_MODE=true` when running `apps/web` if you want the dashboard to fall back to local sample data when the API is offline. Public client environment variables do not enable demo fallback.

The UI includes route-level loading and error states plus empty states for first-run production environments with no review runs, repositories, eval summaries, validator decisions, model calls, or trend samples yet. Review run details show status, repository, PR number, findings, validator decisions, model calls, total cost, latency, and GitHub comment status. Repository settings show read-only placeholders for minimum confidence, maximum findings, and enabled review passes until write APIs are added.

Local API-backed dashboard example:

```powershell
$env:DIFFGUARD_DASHBOARD_API_KEY = "replace-with-a-long-random-value"
$env:DIFFGUARD_ALLOWED_ORIGINS = "http://localhost:3000"
pnpm.cmd --filter @diffguard/api dev
```

In a second terminal:

```powershell
$env:DIFFGUARD_API_BASE_URL = "http://localhost:3001"
$env:DIFFGUARD_DASHBOARD_API_KEY = "replace-with-a-long-random-value"
pnpm.cmd --filter @diffguard/web dev
```

The overview shows posted findings, resolved findings, unresolved findings, likely false positives, unknown classifications, and estimated resolution rate. Estimated resolution rate is calculated as `resolved findings / posted findings`. It is an approximation from latest PR evidence and a structured validator model, not perfect ground truth. Findings can be marked `unknown` when the latest diff/code no longer contains enough context to make a defensible classification.

The UI uses shadcn-style local primitives, Tailwind CSS, lucide icons, and Recharts. API key fields are placeholders only and must not display or log raw secrets.
