# Dashboard

The `apps/web` dashboard is a Next.js App Router UI for DiffGuard-AI review operations.

Current routes:

- `/dashboard`: resolution tracking cards, review trend charts, cost and latency charts, and recent review runs.
- `/dashboard/reviews`: review run list with status, repository, PR number, findings count, cost, and latency.
- `/dashboard/reviews/[id]`: run details, findings, validator decisions, model calls, and GitHub comment status.
- `/dashboard/repos`: connected repository settings, confidence thresholds, and max findings per PR.
- `/dashboard/evals`: eval precision, recall, false positives, false negatives, and cost per run.
- `/settings`: model, threshold, GitHub, and API key configuration placeholders.

The dashboard loads data from `apps/api` through `apps/web/src/lib/dashboard-data.ts`. Set `DIFFGUARD_API_BASE_URL` for the web app when the API is not running at `http://localhost:3001`.

Dashboard API endpoints:

- `GET /dashboard/overview`: aggregate metrics plus review trend data.
- `GET /dashboard/review-runs`: latest review runs.
- `GET /dashboard/review-runs/:id`: review run detail with findings, validator decisions, and model-call telemetry.
- `GET /dashboard/repositories`: connected repositories and dashboard settings.
- `GET /dashboard/findings`: latest findings.
- `GET /dashboard/evals`: eval summaries.

Mock data is retained only for local demo mode. Set `DIFFGUARD_DEMO_MODE=true` when running `apps/web` if you want the dashboard to fall back to local sample data when the API is offline.

The overview shows posted findings, resolved findings, unresolved findings, likely false positives, unknown classifications, and estimated resolution rate. Estimated resolution rate is calculated as `resolved findings / posted findings`. It is an approximation from latest PR evidence and a structured validator model, not perfect ground truth. Findings can be marked `unknown` when the latest diff/code no longer contains enough context to make a defensible classification.

The UI uses shadcn-style local primitives, Tailwind CSS, lucide icons, and Recharts. API key fields are placeholders only and must not display or log raw secrets.
