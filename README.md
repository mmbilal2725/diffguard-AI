# DiffGuard-AI

DiffGuard-AI is an AI-powered GitHub pull request review agent. It is designed to fetch PR diffs, build relevant context, apply repo-specific rules from `.diffguard-rules.md`, validate model findings, deduplicate noisy output, post useful GitHub comments, and track review quality.

This repository is the initial TypeScript/pnpm monorepo foundation. It does not implement the full AI review pipeline yet.

## Stack

- pnpm workspaces
- TypeScript
- Next.js, Tailwind, and shadcn/ui-compatible dashboard components
- Fastify API
- BullMQ and Redis worker foundation
- PostgreSQL with Prisma
- Zod validation
- Vitest, ESLint, and Prettier

## Workspace Layout

- `apps/web`: dashboard
- `apps/api`: webhook receiver and API foundation
- `apps/cli`: `diffguard-ai review` and `diffguard-ai eval run` command entrypoints
- `apps/worker`: background review worker foundation
- `packages/github`: GitHub API wrapper boundary
- `packages/reviewer`: review pipeline orchestration boundary
- `packages/llm`: LLM prompt and structured output boundary
- `packages/evals`: eval case schemas, starter cases, runner, and report formatter
- `packages/database`: Prisma schema and database client
- `packages/shared`: shared TypeScript types and Zod schemas
- `docs`: architecture and product notes

## Setup

```bash
pnpm install
cp .env.example .env
docker compose up -d
pnpm prisma:generate
pnpm prisma:migrate
```

On Windows PowerShell, if script execution blocks the `pnpm` shim, use `pnpm.cmd`:

```powershell
pnpm.cmd install
pnpm.cmd prisma:generate
```

## Development

```bash
pnpm dev
pnpm lint
pnpm typecheck
pnpm test
```

## GitHub App, Action, and CLI

GitHub App mode is the server-based integration path. The API receives signed GitHub webhooks at:

```text
POST /webhooks/github
```

It verifies `x-hub-signature-256`, ignores unsupported events, deduplicates `x-github-delivery` ids, tracks repository installations, and queues BullMQ review jobs for supported PR activity and `/diffguard review` comments. See [docs/github-app.md](docs/github-app.md).

Run a pull request review from the CLI:

```bash
pnpm --filter @diffguard/cli start -- review --owner OWNER --repo REPO --pull-number PR_NUMBER --github-token "$GITHUB_TOKEN"
```

See [docs/github-action.md](docs/github-action.md) for the reusable GitHub Action workflow and installation guide.

Run the built-in eval suite:

```bash
pnpm --filter @diffguard/cli start -- eval run --model gpt-5.5 --prompt-version review-v1 --output markdown
```

See [docs/evals.md](docs/evals.md) for the eval case format, metrics, and CI usage.

The API exposes:

```text
GET /health
POST /webhooks/github
```

Expected response:

```json
{ "status": "ok" }
```

## Environment

Copy `.env.example` to `.env` and fill in real values when integrating GitHub and model providers. Do not commit secrets.

```env
DATABASE_URL="postgresql://diffguard:diffguard@localhost:5432/diffguard?schema=public"
REDIS_URL="redis://localhost:6379"
GITHUB_APP_ID=""
GITHUB_APP_PRIVATE_KEY=""
GITHUB_WEBHOOK_SECRET=""
OPENAI_API_KEY=""
OPENAI_RESOLUTION_MODEL=""
```

Resolution tracking classifies previously posted findings as resolved, unresolved, likely false positive, or unknown after later PR updates. The dashboard's estimated resolution rate is `resolved findings / posted findings`; treat it as an approximation from available code evidence and validator-model judgment, not perfect ground truth.
