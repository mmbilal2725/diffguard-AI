# DiffGuard-AI Architecture

DiffGuard-AI is organized as a pnpm TypeScript monorepo with deployable apps and small shared packages.

## Apps

- `apps/web`: Next.js dashboard for review quality metrics and run visibility.
- `apps/api`: Fastify API and future GitHub webhook receiver.
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
- `packages/evals`: Evaluation helpers and future eval runner.
- `packages/database`: Prisma schema and database client factory.
- `packages/shared`: Shared Zod schemas and TypeScript types.

## Review Pipeline

The full AI review workflow is intentionally not implemented in the scaffold. The planned runtime flow is:

1. GitHub webhook reaches `apps/api`.
2. API records repository, pull request, and review run metadata in Postgres.
3. API enqueues a BullMQ review job in Redis.
4. Worker fetches the PR diff and relevant context through `packages/github`.
5. Worker reads `.diffguard-rules.md` from the target repository.
6. Worker runs static checks and calls `packages/llm` for structured findings.
7. Worker validates, deduplicates, and posts only high-confidence findings.
8. Metrics and feedback events are stored for quality tracking.

## Security Notes

Secrets should be supplied through environment variables and must not be logged. Webhook payloads, GitHub tokens, private keys, and model API keys should be treated as sensitive data.
