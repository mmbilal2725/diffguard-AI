# DiffGuard-AI Architecture

DiffGuard-AI is organized as a pnpm TypeScript monorepo with deployable apps and small shared packages.

## Apps

- `apps/web`: Next.js dashboard for review quality metrics and run visibility.
- `apps/api`: Fastify API and GitHub App webhook receiver.
- `apps/worker`: BullMQ worker for asynchronous pull request review jobs.

## Packages

- `packages/github`: Octokit-based GitHub API wrapper boundary for PR metadata, changed
  files, raw diffs, repository file reads, `.diffguard-rules.md`, general PR comments,
  and inline pull request reviews. Methods validate inputs with Zod and return
  structured result objects instead of exposing raw Octokit errors.
- `packages/reviewer`: Review pipeline orchestration boundary.
- `packages/llm`: Prompt versions, model client boundary, and structured output schemas.
  The package exposes provider interfaces, an OpenAI implementation, versioned review
  prompts, retry-on-invalid-output handling, and model-call telemetry for token usage,
  cost, latency, model name, and prompt version. Callers receive only Zod-validated
  `ReviewFinding` objects.
- `packages/evals`: Zod-validated PR diff eval case format, starter TypeScript bug cases,
  eval runner, scoring metrics, and JSON/Markdown report formatting for CI.
- `packages/database`: Prisma schema and database client factory.
- `packages/shared`: Shared Zod schemas and TypeScript types.

## Review Pipeline

The full AI review workflow is intentionally not implemented in the scaffold. The planned runtime flow is:

1. GitHub App webhook reaches `apps/api`.
2. API verifies `x-hub-signature-256` against the raw request body.
3. API records the webhook delivery id for idempotency and ignores duplicate deliveries.
4. API records repository installation, pull request, and queued review run metadata in Postgres.
5. API enqueues a BullMQ `review-pr` job in Redis.
6. Worker creates a short-lived GitHub App installation token for the repository installation.
7. Worker fetches the PR diff and relevant context through `packages/github`.
8. Worker reads `.diffguard-rules.md` from the target repository.
9. Worker runs static checks and calls `packages/llm` for structured findings.
10. Worker validates, deduplicates, and posts only high-confidence findings.
11. Metrics and feedback events are stored for quality tracking.

## Eval Runner

The eval runner executes DiffGuard-AI against PR diff cases without calling GitHub by
using an in-memory pull request client. It reports precision, recall, false positives,
false negatives, validator rejection rate, cost, latency, findings per PR, prompt
version, and model version. The CLI command is `diffguard-ai eval run`; see
`docs/evals.md` for the case format and CI options.

## Security Notes

Secrets should be supplied through environment variables and must not be logged. Webhook secrets, GitHub App private keys, installation tokens, webhook payloads, and model API keys should be treated as sensitive data.
