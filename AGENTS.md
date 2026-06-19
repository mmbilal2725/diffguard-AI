Project name: DiffGuard-AI

DiffGuard-AI is an AI-powered GitHub pull request review agent. It reviews PR diffs, detects high-confidence bugs, validates findings, deduplicates noisy output, posts useful GitHub review comments, and tracks review quality metrics.

# DiffGuard-AI Agent Instructions

You are helping build DiffGuard-AI, an AI-powered GitHub pull request review agent.

## Product goal

Build an evaluation-driven AI code review system that reviews GitHub pull requests, detects high-confidence bugs, validates findings, deduplicates noisy output, posts useful GitHub review comments, and tracks review quality.

DiffGuard-AI should focus on real engineering issues such as:

- logic bugs
- security vulnerabilities
- broken API contracts
- missing authorization checks
- unsafe database changes
- missing error handling
- regression risks
- performance problems
- missing tests for changed behavior

DiffGuard-AI should avoid noisy comments such as:

- style-only suggestions
- vague refactoring advice
- formatting comments
- subjective naming preferences
- low-confidence speculation

## Engineering principles

- TypeScript-first.
- Prefer small, testable modules.
- Use Zod for runtime validation.
- Keep model prompts versioned.
- Every LLM output must be structured and validated.
- Never post low-confidence comments.
- Avoid style-only review comments.
- Track cost, latency, model name, token usage, and confidence.
- Add tests for every core pipeline component.
- Keep security in mind: never log secrets, tokens, private keys, or raw sensitive data.
- Build the system as a serious developer tool, not a demo chatbot.

## Project structure

- apps/web: dashboard
- apps/api: webhook receiver and API
- apps/worker: background review worker
- packages/github: GitHub API wrapper
- packages/reviewer: review pipeline orchestration
- packages/llm: LLM client and prompts
- packages/evals: eval runner
- packages/database: Prisma schema and database client
- packages/shared: shared TypeScript types and Zod schemas
- docs: architecture, product spec, and implementation notes

## Main configuration file

Repos using DiffGuard-AI can define custom review rules in:

.diffguard-rules.md

Example rules:

- All admin routes must call requireAdmin().
- Never log API keys, access tokens, or refresh tokens.
- All money values must be stored in minor units such as cents or paisa.
- Database migrations must avoid destructive changes unless explicitly approved.
- Ignore formatting-only suggestions.
- Only comment when confidence is high.

## Commands

Use pnpm.

- pnpm install
- pnpm dev
- pnpm test
- pnpm lint
- pnpm typecheck
- pnpm prisma:migrate

## Definition of done

A task is done only when:

- implementation is complete
- tests are added
- lint passes
- typecheck passes
- relevant docs are updated
- security-sensitive values are not logged
- the behavior matches the product goal of low-noise, high-confidence PR review