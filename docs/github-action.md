# DiffGuard-AI GitHub Action

DiffGuard-AI can run as a reusable GitHub Action from a versioned release tag.
The action fetches pull request metadata and diffs, reads `.diffguard-rules.md`
from the PR head when present, runs the review pipeline, and posts validated
GitHub review comments unless `dry-run` is enabled.

Use immutable release tags such as `v0.1.0`. Do not depend on `main` for
production repositories.

## Required Permissions

The workflow using DiffGuard-AI needs:

```yaml
permissions:
  contents: read
  pull-requests: write
```

`contents: read` lets DiffGuard-AI read changed files and repository rules.
`pull-requests: write` lets it post review comments.

## Required Secrets

- `OPENAI_API_KEY`: required for LLM review passes. If it is missing, the CLI
  skips LLM review safely and reports a warning instead of posting speculative
  comments.

The action uses `${{ github.token }}` by default for GitHub API access. You can
override it with the `github-token` input when using a different token.

Optional:

- `DIFFGUARD_DATABASE_URL`: enables persisted review runs and duplicate comment
  suppression across repeated runs.

## Workflow Example

Create `.github/workflows/diffguard-ai.yml` in the repository you want reviewed:

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
          review-passes: logic-bugs,security-bugs,regression-test-gaps
          output: markdown
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
          DATABASE_URL: ${{ secrets.DIFFGUARD_DATABASE_URL }}
```

Use `dry-run: "true"` while validating setup. Remove it only when you want the
action to post comments.

The same minimal example is available at
`docs/examples/diffguard-ai-review.yml`.

## Inputs

- `owner`: repository owner. Defaults to `github.repository`.
- `repo`: repository name. Defaults to `github.repository`.
- `pull-number`: PR number. Defaults to the pull request event number.
- `github-token`: optional GitHub token override. Defaults to `${{ github.token }}`.
- `dry-run`: run without posting comments. Defaults to `"false"`.
- `min-confidence`: minimum confidence threshold. Defaults to `"0.7"`.
- `max-findings`: maximum findings to post.
- `model`: model name for the LLM review provider.
- `review-passes`: comma-separated review pass ids.
- `output`: `markdown` or `json`. Defaults to `markdown`.

## Local Development

When testing changes to this action from a checkout of the DiffGuard-AI repo,
point `uses:` at the local action path:

```yaml
name: DiffGuard-AI Local Action Test

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
      - name: Run local DiffGuard-AI action
        uses: ./
        with:
          dry-run: "true"
          min-confidence: "0.85"
          max-findings: "5"
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
```

For CLI-only local testing from this monorepo:

```bash
pnpm install
pnpm --filter @diffguard/cli start -- review \
  --owner OWNER \
  --repo REPO \
  --pull-number PR_NUMBER \
  --github-token "$GITHUB_TOKEN" \
  --dry-run \
  --min-confidence 0.85 \
  --max-findings 5 \
  --review-passes logic-bugs,security-bugs,regression-test-gaps \
  --output markdown
```

## Troubleshooting

### The action cannot post comments

Check workflow permissions. The job must include `pull-requests: write`.
Also check that the workflow runs on a `pull_request` event or that you pass
`pull-number`.

### The action says GitHub authentication is required

By default the action uses `${{ github.token }}`. If your organization disables
that token or you need a different identity, pass `github-token`.

### The action runs but posts no LLM findings

Confirm `OPENAI_API_KEY` is configured as a repository or organization secret.
Without it, DiffGuard-AI intentionally skips LLM review and avoids speculative
comments.

### Duplicate comments appear across repeated runs

Set `DATABASE_URL` to a persistent Postgres database so DiffGuard-AI can store
posted finding dedupe keys and skip already-posted findings on later runs.

### The action fails during dependency install

The tagged release includes the pnpm workspace. The action runs `corepack enable`
and `pnpm install --frozen-lockfile` inside the action checkout. Re-run with the
same release tag and inspect the install log for lockfile drift or registry
availability issues.
