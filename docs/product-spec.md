# DiffGuard-AI Product Specification

DiffGuard-AI is an AI-powered GitHub pull request review agent focused on
high-confidence engineering bugs, false-positive reduction, and measurable
review quality.

## Goals

- Detect real pull request issues such as logic bugs, security vulnerabilities, broken API contracts, missing authorization, unsafe database changes, missing error handling, regression risks, performance problems, and missing tests.
- Validate findings before posting comments.
- Deduplicate repeated comments.
- Track quality metrics: findings posted, validator rejection rate, false positives, resolution rate, cost, latency, model name, and token usage.
- Run PR-diff eval suites with expected findings so prompt and model changes can be checked in CI.
- Support both local/CI review through a GitHub Action and server-side review
  through GitHub App webhooks.
- Prefer silence over speculative comments when a finding cannot be validated.

## Implemented Product Surface

- CLI command for PR review: `diffguard-ai review`.
- CLI command for offline evals: `diffguard-ai eval run`.
- Reusable GitHub Action wrapper for pull request review.
- GitHub App webhook ingestion for pull request and issue comment events.
- Webhook signature verification and duplicate delivery handling.
- BullMQ worker jobs using short-lived GitHub App installation tokens.
- Review pipeline stages for context building, static checks, LLM candidates,
  validator decisions, dedupe, confidence filtering, and timing metrics.
- GitHub inline review comments with summary fallback for unmapped findings.
- Dashboard screens for runs, repos, evals, findings, validator decisions, model
  calls, cost, latency, and approximate resolution rate.
- OpenAI-compatible structured JSON provider and resolution validator.
- Zod-validated eval case format with CI-friendly Markdown/JSON reports.

## Current Constraints

- The default static checker and default review generator are intentionally
  silent placeholders until concrete runners are configured.
- The validator boundary is strict; if no validator is configured, candidates are
  rejected by default.
- Resolution rate is an approximation from later PR evidence and validator-model
  judgment, not perfect ground truth.
- Dashboard data is currently product-shaped sample data unless connected to
  persisted review runs.

## Repo Rules

Repositories can define `.diffguard-rules.md` to customize review behavior. Example rules:

- All admin routes must call `requireAdmin()`.
- Never log API keys, access tokens, or refresh tokens.
- All money values must be stored in minor units.
- Database migrations must avoid destructive changes unless explicitly approved.
- Ignore formatting-only suggestions.
- Only comment when confidence is high.
