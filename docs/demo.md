# DiffGuard-AI Demo Walkthrough

This walkthrough shows DiffGuard-AI from a local checkout without requiring a
deployed GitHub App. It is designed for portfolio reviews, interviews, and quick
engineering-manager demos.

## Prerequisites

- Node.js 20+
- pnpm
- A GitHub pull request that contains at least one concrete bug
- A token with `contents:read` and `pull-requests:write` for the target repository

Set the token in your shell:

```powershell
$env:GITHUB_TOKEN = "ghp_example"
```

## Add Repository Rules

In the repository being reviewed, add `.diffguard-rules.md`:

```markdown
- All admin routes must call requireAdmin().
- Never log API keys, access tokens, or refresh tokens.
- Database migrations must avoid destructive changes unless explicitly approved.
- Ignore formatting-only suggestions.
- Only comment when confidence is high.
```

## Run A Dry Review

From this checkout:

```powershell
pnpm.cmd --filter @diffguard/cli start -- review --owner OWNER --repo REPO --pull-number PR_NUMBER --dry-run --min-confidence 0.8 --max-findings 5 --output markdown
```

Expected result:

- PR metadata and changed files are fetched from GitHub.
- `.diffguard-rules.md` is loaded from the PR head when present.
- The pipeline returns only validated high-confidence findings.
- No GitHub comment is posted because `--dry-run` is set.

## Post Review Comments

Remove `--dry-run` when the dry review output looks correct:

```powershell
pnpm.cmd --filter @diffguard/cli start -- review --owner OWNER --repo REPO --pull-number PR_NUMBER --min-confidence 0.8 --max-findings 5 --output markdown
```

Expected result:

- Findings mapped to changed diff lines are posted in one GitHub pull request review.
- Findings that cannot be mapped to an inline diff line are posted in a summary PR comment.
- Low-confidence, duplicate, style-only, and validator-rejected candidates stay silent.

## Show The Dashboard

Start the API and dashboard. Use demo mode only when you want local sample data
if the API is unavailable:

```powershell
pnpm.cmd --filter @diffguard/api dev
$env:DIFFGUARD_API_BASE_URL = "http://localhost:3001"
$env:DIFFGUARD_DEMO_MODE = "true"
pnpm.cmd --filter @diffguard/web dev
```

Open `http://localhost:3000` and show:

- review runs and statuses
- posted findings
- validator decisions
- model call cost and latency
- eval metrics

## Run The Starter Evals

```powershell
pnpm.cmd --filter @diffguard/cli start -- eval run --model gpt-5.5 --prompt-version review-v1 --output markdown
```

For CI-style regression behavior:

```powershell
pnpm.cmd --filter @diffguard/cli start -- eval run --model gpt-5.5 --prompt-version review-v1 --output json --fail-on-regression
```
