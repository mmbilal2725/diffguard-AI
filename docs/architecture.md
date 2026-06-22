# DiffGuard-AI Architecture

DiffGuard-AI is organized as a pnpm TypeScript monorepo with deployable apps and small shared packages.

## Apps

- `apps/web`: Next.js dashboard for review quality metrics and run visibility.
- `apps/api`: Fastify API and GitHub App webhook receiver.
- `apps/worker`: BullMQ worker for asynchronous pull request review jobs.

## Packages

- `packages/github`: Octokit-based GitHub API wrapper boundary for PR metadata, changed
  files, raw diffs, repository file reads, `.diffguard-rules.md`, general PR comments,
  inline pull request reviews, and review-comment ID lookup. Methods validate inputs
  with Zod and return structured result objects instead of exposing raw Octokit errors.
- `packages/reviewer`: Review pipeline orchestration boundary, including resolution
  tracking for previously posted findings.
- `packages/llm`: Prompt versions, model client boundary, and structured output schemas.
  The package exposes provider interfaces, an OpenAI implementation, versioned review
  prompts, resolution validator prompts, retry-on-invalid-output handling, and
  model-call telemetry for token usage, cost, latency, model name, and prompt version.
  Callers receive only Zod-validated structured objects.
- `packages/evals`: Zod-validated PR diff eval case format, starter TypeScript bug cases,
  eval runner, scoring metrics, and JSON/Markdown report formatting for CI.
- `packages/database`: Prisma schema and database client factory.
- `packages/shared`: Shared Zod schemas, TypeScript types, and reusable unified
  diff parsing for file, hunk, and changed-line metadata.

## Review Pipeline

The review workflow is designed around explicit stages so each quality gate can
be tested independently. The default static and reviewer runners are conservative
no-ops until concrete implementations are configured; the pipeline still enforces
validation, deduplication, and confidence filtering for any candidate findings it
receives.

Runtime flow:

1. GitHub App webhook reaches `apps/api`.
2. API verifies `x-hub-signature-256` against the raw request body.
3. API records the webhook delivery id for idempotency and ignores duplicate deliveries.
4. API records repository installation, pull request, and queued review run metadata in Postgres.
5. API enqueues a BullMQ `review-pr` job in Redis.
6. Worker creates a short-lived GitHub App installation token for the repository installation.
7. Worker fetches the PR diff and relevant context through `packages/github`.
8. Worker reads `.diffguard-rules.md` from the target repository.
9. Diff parsing records file, hunk, old-line, and new-line metadata for context
   building and GitHub comment mapping.
10. Worker runs static checks and structured LLM review passes when configured.
11. Worker validates, deduplicates, and posts only high-confidence findings.
12. Inline-capable findings are batched into one GitHub review; unmapped findings use
    a summary issue comment fallback.
13. Metrics, GitHub comment IDs, and feedback events are stored for quality tracking.

## Database Persistence

`packages/database/prisma/schema.prisma` is the source of truth for production
persistence. It stores repositories, pull requests, review runs, findings,
validator decisions, model calls, webhook deliveries, eval summaries, and
feedback events. Review runs support queued, running, completed, failed, skipped,
and legacy canceled states.

Review run records include cost, latency, token usage through related model-call
rows, model name, prompt version, validator rejection rate, and persisted
validator decisions. Worker failure paths store a bounded, redacted error message
for debugging without retaining raw tokens, API keys, private keys, or passwords.
Dashboard-oriented indexes cover common status, time, pull request, model, and
validator-decision queries.

## Resolution Tracking

DiffGuard-AI stores posted findings with their GitHub comment IDs. On later PR updates
or merge-oriented review jobs, the worker can load those posted findings, use the latest
PR files/diff as evidence, and ask the structured resolution validator model to classify
each finding as `resolved`, `unresolved`, `false_positive`, or `unknown`.

Resolution rate is reported as `resolved findings / posted findings`. This is an
approximation, not perfect ground truth. It depends on the available latest diff/code
context and model judgment. When the latest evidence is insufficient, the classifier
must return `unknown` instead of guessing.

## Eval Runner

The eval runner executes DiffGuard-AI against PR diff cases without calling GitHub by
using an in-memory pull request client. It reports precision, recall, false positives,
false negatives, validator rejection rate, cost, latency, findings per PR, prompt
version, and model version. The CLI command is `diffguard-ai eval run`; see
`docs/evals.md` for the case format and CI options.

## Public Demo Narrative

For portfolio and interview use, the important engineering story is not just
"an LLM comments on a PR." DiffGuard-AI demonstrates the production controls
around that idea: signed webhook ingestion, idempotent queueing, installation
token isolation, repo-specific policy, structured model output, validator
rejection, confidence thresholds, dedupe, inline comment mapping, persistence,
eval reporting, and dashboard visibility.

## Security Notes

Secrets should be supplied through environment variables and must not be logged.
Webhook secrets, GitHub App private keys, installation tokens, webhook payloads,
and model API keys should be treated as sensitive data.
