# DiffGuard-AI

AI-powered GitHub PR review agent focused on high-confidence bug detection, validation, deduplication, and review-quality metrics.

DiffGuard-AI is built as a serious developer tool, not a demo chatbot. The core idea is simple: an AI reviewer should post fewer, better comments, prove that each finding is actionable, and measure whether the feedback was useful over time.

## Why I Built This

Modern AI coding agents increase code volume, which makes code review harder. DiffGuard-AI explores how to build a trustworthy AI reviewer that reviews pull request diffs, applies repository-specific rules, validates model output, avoids noisy comments, and tracks quality metrics such as precision, recall, false positives, cost, latency, and approximate resolution rate.

The project demonstrates the product and engineering work behind an eval-driven AI code review system: GitHub integration, structured LLM outputs, validator passes, confidence thresholds, deduplication, review posting, persistence, dashboard UX, and CI-friendly evaluation reports.

## Demo

Add a GIF or short video here showing a PR review run, the GitHub comment output,
and the dashboard metrics view.

```text
docs/assets/diffguard-demo.gif
```

Recommended demo flow:

1. Open a pull request with a concrete bug.
2. Add `.diffguard-rules.md` with the repository rules you want enforced.
3. Run a dry review from this checkout:

```powershell
pnpm.cmd --filter @diffguard/cli start -- review --owner OWNER --repo REPO --pull-number PR_NUMBER --dry-run --min-confidence 0.8 --max-findings 5 --output markdown
```

4. Remove `--dry-run` to post validated GitHub review comments.
5. Show the dashboard view for findings, validator decisions, cost, latency, and eval metrics.
6. Run the starter eval suite to show precision, recall, and regression semantics.

See [docs/demo.md](docs/demo.md) for the complete local demo script.

## Features

- GitHub PR review through CLI, reusable GitHub Action, and GitHub App webhook mode.
- Repo-specific `.diffguard-rules.md` support for team or project review policies.
- Static analysis stage plus structured LLM review interfaces.
- Multi-pass review architecture for specialized prompt templates.
- Validator model boundary that rejects unvalidated, low-confidence, or high false-positive-risk findings.
- Zod validation for every model-facing structured output.
- Deduplication by file, line, category, and normalized title.
- Confidence thresholds and max-finding caps to keep comments low-noise.
- GitHub inline review comments with summary fallback for unmapped findings.
- Dashboard for review runs, repositories, evals, findings, validator decisions, model calls, cost, and latency.
- Cost, latency, token usage, model name, prompt version, and validator rejection tracking.
- Resolution-rate approximation for posted findings after later PR updates.
- Offline eval suite for precision, recall, false positives, false negatives, validator rejection rate, cost, and latency.
- Persisted eval summaries in Prisma, exposed through the dashboard API.
- Dashboard API authentication with server-side bearer credentials.
- Browser origin allowlisting and per-client API rate limiting.

Current status: the platform foundations are implemented across the monorepo. The CLI and GitHub App worker wire the structured LLM reviewer when `OPENAI_API_KEY` is configured, run the selected LLM review passes, validate findings, dedupe candidates, post GitHub comments when not in dry-run mode, and persist review/eval summaries when `DATABASE_URL` is configured. DiffGuard-AI still prefers no comment over an unvalidated or speculative comment.

Production-readiness status: this is ready for serious local testing and controlled beta deployments. The repo now includes signed GitHub webhook verification, duplicate delivery handling, short-lived GitHub App installation tokens, dashboard API authentication, CORS/origin controls, request rate limiting, Prisma persistence, and repo-wide verification coverage. It is not yet a fully hardened multi-tenant SaaS service: deployment automation, hosted auth/tenant management, observability, alerting, backup/restore procedures, and marketplace-grade installation flows are still roadmap items.

## Architecture

```mermaid
flowchart LR
  GH["GitHub PR event"] --> API["apps/api<br/>Fastify webhook receiver"]
  API --> DB["Postgres<br/>Prisma metadata"]
  API --> Q["Redis / BullMQ<br/>review-pr jobs"]
  Q --> W["apps/worker<br/>review processor"]
  W --> GHPkg["packages/github<br/>PR metadata, files, diffs, comments"]
  W --> Reviewer["packages/reviewer<br/>pipeline, validation, dedupe, filtering"]
  Reviewer --> LLMPkg["packages/llm<br/>prompts, JSON schemas, telemetry"]
  Reviewer --> Metrics["quality metrics<br/>findings, rejects, cost, latency"]
  Reviewer --> Comments["GitHub review comments"]
  Metrics --> DB
  DB --> API
  API --> Web["apps/web<br/>dashboard"]
  Evals["packages/evals<br/>offline cases and CI reports"] --> Reviewer
  Evals --> DB
```

The repository is a TypeScript/pnpm monorepo:

- `apps/web`: Next.js dashboard.
- `apps/api`: Fastify API and GitHub App webhook receiver.
- `apps/cli`: `diffguard-ai review` and `diffguard-ai eval run` entrypoints.
- `apps/worker`: BullMQ background review worker.
- `packages/github`: Octokit wrapper for PR data, diffs, rules, comments, and installation tokens.
- `packages/reviewer`: review pipeline orchestration, validation, dedupe, filtering, and resolution tracking.
- `packages/llm`: OpenAI-compatible structured JSON provider, versioned prompts, schemas, and telemetry.
- `packages/evals`: eval case schemas, starter cases, scoring, and Markdown/JSON reports.
- `packages/database`: Prisma schema and database client.
- `packages/shared`: shared Zod schemas, TypeScript types, and reusable unified diff parsing.
- `docs`: architecture, setup, evals, and product notes.

See [docs/architecture.md](docs/architecture.md) for more detail.

## Review Pipeline

1. GitHub sends a PR event or `/diffguard review` command.
2. DiffGuard-AI fetches PR metadata, changed files, and raw diff context.
3. The context builder loads `.diffguard-rules.md` from the PR head when present.
4. Static checks run first and can emit structured candidate findings.
5. LLM review passes inspect the diff with specialized prompt templates. The CLI and worker run `logic-bugs`, `security-bugs`, and `regression-test-gaps` when `OPENAI_API_KEY` is present, unless `DIFFGUARD_REVIEW_PASSES` selects a comma-separated subset.
6. Candidate findings are parsed and validated with Zod.
7. A validator pass checks whether each finding is real, actionable, and safe to post.
8. Duplicate findings are removed.
9. Confidence thresholds and false-positive-risk checks filter remaining candidates.
10. GitHub comments are posted inline when the line can be mapped, with a summary fallback otherwise.
11. Metrics and eval data are stored for dashboarding and regression checks.

The default validator rejects findings when no validator is configured. This is deliberate: the project optimizes for high-confidence review comments over volume.

If `OPENAI_API_KEY` is not configured, DiffGuard-AI skips LLM review safely and emits a clear warning instead of posting speculative comments.

## Dashboard And API

The dashboard is API-backed by `apps/api` and uses server-side requests from `apps/web`.

Implemented dashboard endpoints:

- `GET /dashboard/overview`
- `GET /dashboard/review-runs`
- `GET /dashboard/review-runs/:id`
- `GET /dashboard/repositories`
- `GET /dashboard/findings`
- `GET /dashboard/evals`

Dashboard API access requires `DIFFGUARD_DASHBOARD_API_KEY`. Configure the same value for `apps/api` and `apps/web`; the web app sends it server-side as `Authorization: Bearer ...`. Do not expose this value with a `NEXT_PUBLIC_*` variable.

`apps/api` also enforces browser origin allowlisting and rate limits:

- `DIFFGUARD_ALLOWED_ORIGINS`: comma-separated browser origins allowed to call the API.
- `DIFFGUARD_RATE_LIMIT_MAX_REQUESTS`: default `120`.
- `DIFFGUARD_RATE_LIMIT_WINDOW_MS`: default `60000`.

Server-to-server requests without an `Origin` header are allowed. Local mock dashboard fallback exists only when `DIFFGUARD_DEMO_MODE=true`.

## Evals

The offline eval suite runs PR-diff cases without calling GitHub. It supports built-in starter TypeScript cases and custom JSON case files.

Reported metrics include:

- precision
- recall
- false positives
- false negatives
- validator rejection rate
- cost
- latency
- findings per PR
- prompt version
- model version

Run the starter eval suite:

```bash
pnpm --filter @diffguard/cli start -- eval run --model gpt-5.5 --prompt-version review-v1 --output markdown
```

Fail CI when a run has any false positive or false negative:

```bash
pnpm --filter @diffguard/cli start -- eval run --cases eval-cases.json --model gpt-5.5 --prompt-version review-v1 --output json --fail-on-regression
```

On Windows PowerShell, use `pnpm.cmd` if script execution blocks the `pnpm` shim:

```powershell
pnpm.cmd --filter @diffguard/cli start -- eval run --model gpt-5.5 --prompt-version review-v1 --output markdown
```

See [docs/evals.md](docs/evals.md).

When `DATABASE_URL` is configured, `diffguard-ai eval run` stores a summary row in Prisma. The dashboard reads those persisted summaries from `/dashboard/evals`.

## Local Setup

Prerequisites:

- Node.js 20+
- pnpm
- Docker, for local Postgres and Redis

Install dependencies and start local services:

```bash
pnpm install
cp .env.example .env
docker compose up -d
pnpm prisma:generate
pnpm prisma:migrate
```

Run the project:

```bash
pnpm dev
```

Run verification:

```bash
pnpm lint
pnpm typecheck
pnpm test
```

PowerShell equivalents:

```powershell
pnpm.cmd install
Copy-Item .env.example .env
docker compose up -d
pnpm.cmd prisma:generate
pnpm.cmd prisma:migrate
pnpm.cmd dev
```

## GitHub Action Setup

Add `.github/workflows/diffguard-ai.yml` to the repository you want reviewed:

```yaml
name: DiffGuard-AI Review

on:
  pull_request:
    types: [opened, synchronize, reopened]

jobs:
  diffguard-ai:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
      - name: Run DiffGuard-AI
        uses: diffguard-ai/diffguard-ai@v0.1.0
        with:
          min-confidence: "0.85"
          max-findings: "5"
          output: markdown
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
          DIFFGUARD_REVIEW_PASSES: logic-bugs,security-bugs,regression-test-gaps
```

For local action development from this checkout, point `uses:` at the local action path instead. See [docs/github-action.md](docs/github-action.md).

## GitHub App Setup

GitHub App mode is implemented for server-based review processing.

1. Create a GitHub App with pull request and issue comment webhook events.
2. Set the webhook URL to `https://YOUR_API_HOST/webhooks/github`.
3. Grant least-privilege permissions:
   - Contents: read
   - Metadata: read
   - Pull requests: read and write
   - Issues: read and write
4. Configure environment variables:

```env
DATABASE_URL="postgresql://diffguard:diffguard@localhost:5432/diffguard?schema=public"
REDIS_URL="redis://localhost:6379"
REVIEW_QUEUE_NAME="diffguard-review-runs"
GITHUB_APP_ID="12345"
GITHUB_APP_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
GITHUB_WEBHOOK_SECRET="use-a-long-random-secret"
DIFFGUARD_DASHBOARD_API_KEY="use-a-different-long-random-secret"
DIFFGUARD_ALLOWED_ORIGINS="https://YOUR_DASHBOARD_HOST"
DIFFGUARD_RATE_LIMIT_MAX_REQUESTS="120"
DIFFGUARD_RATE_LIMIT_WINDOW_MS="60000"
OPENAI_API_KEY=""
OPENAI_RESOLUTION_MODEL=""
DIFFGUARD_REVIEW_PASSES="logic-bugs,security-bugs,regression-test-gaps"
```

The API verifies `x-hub-signature-256`, deduplicates `x-github-delivery`, queues BullMQ review jobs, and uses short-lived installation tokens in the worker. See [docs/github-app.md](docs/github-app.md).

## Repository Rules

Repos using DiffGuard-AI can define custom review rules in `.diffguard-rules.md`:

```markdown
- All admin routes must call requireAdmin().
- Never log API keys, access tokens, or refresh tokens.
- All money values must be stored in minor units such as cents or paisa.
- Database migrations must avoid destructive changes unless explicitly approved.
- Ignore formatting-only suggestions.
- Only comment when confidence is high.
```

## Roadmap

- Deployment automation, observability, alerting, and backup/restore runbooks.
- Hosted dashboard auth, tenant/repo isolation, and marketplace-ready installation flow.
- Inline comment mapping improvements for complex diffs.
- Autofix suggestions with explicit human approval.
- Sandboxed test execution for changed code.
- Deeper context discovery across call graphs and related files.
- Repo-level analytics for recurring bug classes.
- Team settings for thresholds, models, rules, and notification policy.
- IDE integration for pre-PR review feedback.

## What This Demonstrates

- Agentic developer workflows for real code review tasks.
- GitHub integration through Actions, webhooks, installation tokens, and PR comments.
- LLM product quality work: structured outputs, validators, confidence gates, and low-noise UX.
- Eval-driven development with precision, recall, false-positive, and false-negative reporting.
- Full-stack product engineering across API, worker, database, dashboard, CLI, and docs.
- False-positive reduction as a first-class product requirement.
- Cost, latency, token usage, model name, and prompt-version tracking.
- Security-aware design that avoids logging secrets, private keys, installation tokens, and raw sensitive data.
