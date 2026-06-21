# GitHub App Mode

DiffGuard-AI can receive GitHub App webhooks, persist only review metadata, and enqueue pull request review jobs for the worker.

## GitHub App Settings

Configure the app with these webhook events:

- Pull request
- Issue comment

Set the webhook URL to:

```text
https://YOUR_API_HOST/webhooks/github
```

The API automatically queues reviews for:

- `pull_request.opened`
- `pull_request.synchronize`
- `pull_request.reopened`
- `pull_request.closed` when the pull request was merged, stored internally as `pull_request.merged`
- `issue_comment.created` when the comment body is exactly `/diffguard review` and the issue is a pull request

## Required Permissions

Use the least permissions needed for PR review:

- Contents: read
- Metadata: read
- Pull requests: read and write
- Issues: read and write

## Environment

```env
DATABASE_URL="postgresql://diffguard:diffguard@localhost:5432/diffguard?schema=public"
REDIS_URL="redis://localhost:6379"
REVIEW_QUEUE_NAME="diffguard-review-runs"
GITHUB_APP_ID="12345"
GITHUB_APP_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
GITHUB_WEBHOOK_SECRET="use-a-long-random-secret"
DIFFGUARD_DASHBOARD_API_KEY="use-a-different-long-random-secret"
```

Do not log the private key, webhook secret, dashboard API key, or installation tokens. DiffGuard stores the GitHub installation id, repository identity, pull request metadata, review run metadata, and webhook delivery ids for idempotency.

## Runtime Flow

1. GitHub sends a webhook to `apps/api`.
2. The API verifies `x-hub-signature-256` against the raw request body.
3. The API records the `x-github-delivery` id. Duplicate deliveries return `202` with `status: duplicate` and do not enqueue another job.
4. Supported PR events and the manual comment command upsert repository installation and pull request metadata.
5. The API creates a queued review run and adds a BullMQ `review-pr` job.
6. The worker creates a short-lived installation token for the job installation id.
7. The worker runs the review pipeline with an installation-token GitHub client.
8. The worker uses `packages/review-run` to post validated inline or fallback comments, skip previously posted duplicate findings, and store the completed review run plus finding records when `DATABASE_URL` is configured.
