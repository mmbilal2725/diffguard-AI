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
- `apps/worker`: background review worker foundation
- `packages/github`: GitHub API wrapper boundary
- `packages/reviewer`: review pipeline orchestration boundary
- `packages/llm`: LLM prompt and structured output boundary
- `packages/evals`: eval runner helpers
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

The API exposes:

```text
GET /health
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
GITHUB_PRIVATE_KEY=""
GITHUB_WEBHOOK_SECRET=""
OPENAI_API_KEY=""
```
