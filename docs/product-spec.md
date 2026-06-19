# DiffGuard-AI Product Specification

DiffGuard-AI is an AI-powered GitHub pull request review agent focused on high-confidence engineering bugs.

## Goals

- Detect real pull request issues such as logic bugs, security vulnerabilities, broken API contracts, missing authorization, unsafe database changes, missing error handling, regression risks, performance problems, and missing tests.
- Validate findings before posting comments.
- Deduplicate repeated comments.
- Track quality metrics: findings posted, validator rejection rate, false positives, resolution rate, cost, latency, model name, and token usage.

## Non-Goals For Initial Scaffold

- No production GitHub App integration.
- No real LLM calls.
- No webhook signature validation.
- No static analysis runner.
- No review comment posting.

## Repo Rules

Repositories can define `.diffguard-rules.md` to customize review behavior. Example rules:

- All admin routes must call `requireAdmin()`.
- Never log API keys, access tokens, or refresh tokens.
- All money values must be stored in minor units.
- Database migrations must avoid destructive changes unless explicitly approved.
- Ignore formatting-only suggestions.
- Only comment when confidence is high.
