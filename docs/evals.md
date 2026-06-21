# DiffGuard-AI Evals

`packages/evals` defines PR-diff eval cases, starter TypeScript bug cases, and a CI-friendly eval runner.

## Eval Case Format

Eval cases are validated with Zod and can be stored as either a JSON array or an object with a `cases` array.

```json
{
  "cases": [
    {
      "id": "ts-missing-authorization-check",
      "title": "Missing authorization check",
      "language": "typescript",
      "category": "authorization",
      "diff": "diff --git a/src/admin.ts b/src/admin.ts\n+export async function listUsers() { ... }",
      "repoRules": "All admin routes must call requireAdmin().",
      "expectedFindings": [
        {
          "title": "Admin endpoint is missing authorization",
          "titleKeywords": ["admin", "authorization"],
          "category": "authorization",
          "severity": "high",
          "filePath": "src/admin.ts",
          "line": 12
        }
      ],
      "shouldNotMention": ["rename", "formatting"],
      "severity": "high",
      "notes": "The diff returns private data after removing the admin guard."
    }
  ]
}
```

## Starter Cases

The package includes 10 TypeScript starter cases:

- missing authorization check
- missing null check
- SQL injection risk
- broken pagination
- unsafe database migration
- incorrect money calculation
- missing await
- race condition
- insecure logging
- missing test for changed behavior

## Metrics

The eval report includes:

- precision and recall
- false positives and false negatives
- validator rejection rate
- cost and latency
- findings per PR
- prompt version and model version

`shouldNotMention` phrases are treated as false positives because DiffGuard-AI should avoid noisy comments such as style-only suggestions.

## CLI

Run the built-in starter evals:

```bash
diffguard-ai eval run --model gpt-5.5 --prompt-version review-v1 --output markdown
```

Run a custom case file and fail CI on misses or false positives:

```bash
diffguard-ai eval run --cases eval-cases.json --model gpt-5.5 --prompt-version review-v1 --output json --fail-on-regression
```

The command always prints the report. With `--fail-on-regression`, it exits with code `1` when any false positive or false negative is present.

When `DATABASE_URL` is configured, `diffguard-ai eval run` also stores an eval run summary in Prisma. The dashboard API exposes those rows from `GET /dashboard/evals`, and the web dashboard shows the latest persisted eval summaries. If `DATABASE_URL` is not set, eval persistence is skipped and the command still prints the report normally.
