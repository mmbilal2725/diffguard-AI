# Install DiffGuard-AI in Another Repository

DiffGuard-AI can run as a GitHub Action on pull requests. The action fetches the PR, runs the review pipeline, reads `.diffguard-rules.md` from the PR head when present, batches validated findings into one inline pull request review when their diff lines can be mapped, and falls back to a summary comment for findings that cannot be placed inline. Review runs are stored only when `DATABASE_URL` is available.

## Minimal Workflow

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
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
```

For local action development inside a checked-out copy of this repository, use the same shape with a local action path:

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
        uses: ./path-to-action
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
```

The same example is available at `docs/examples/diffguard-ai-review.yml`.

## Optional Configuration

```yaml
      - name: Run DiffGuard-AI
        uses: diffguard-ai/diffguard-ai@v0.1.0
        with:
          dry-run: "false"
          min-confidence: "0.85"
          max-findings: "5"
          model: gpt-4.1
          output: markdown
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
          DATABASE_URL: ${{ secrets.DIFFGUARD_DATABASE_URL }}
```

## Repository Rules

Add `.diffguard-rules.md` to the reviewed repository to customize review policy:

```markdown
- All admin routes must call requireAdmin().
- Never log API keys, access tokens, or refresh tokens.
- Ignore formatting-only suggestions.
- Only comment when confidence is high.
```

## CLI Usage

From this monorepo, run the CLI directly:

```bash
pnpm --filter @diffguard/cli start -- review \
  --owner OWNER \
  --repo REPO \
  --pull-number PR_NUMBER \
  --github-token "$GITHUB_TOKEN" \
  --min-confidence 0.8 \
  --max-findings 5 \
  --output markdown
```

Use `--dry-run` to fetch and review the PR without posting GitHub comments. `--max-findings` caps the total findings selected for posting. If `DATABASE_URL` is set, DiffGuard-AI skips findings whose dedupe keys already have GitHub comment IDs on the same PR and stores newly posted comment IDs for future duplicate prevention. If `DATABASE_URL` is not set, DiffGuard-AI skips database persistence.
