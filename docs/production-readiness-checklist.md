# Production Readiness Checklist

Use this as the final gate before deploying DiffGuard-AI to a real
organization or expanding a beta installation beyond a test repository.

## Automated local gate

Run the automated checks from the repository root:

```bash
pnpm production:check
```

On Windows PowerShell, use:

```powershell
pnpm.cmd production:check
```

The script runs the checks that can be verified from a local checkout:

- build passes
- lint passes
- typecheck passes
- tests pass
- eval suite passes in deterministic local mode with `--fail-on-regression`
  and writes `artifacts/production-check/eval-report.json`
- Docker images build with `docker compose -f docker-compose.prod.yml build`
- database migrations apply cleanly when `DATABASE_URL` is configured

Useful options:

```bash
pnpm production:check -- --skip-docker
pnpm production:check -- --skip-migrations
```

Use `--skip-docker` only when Docker is unavailable on the workstation running
the gate. Use `--skip-migrations` only when no disposable or intended deployment
database is available. A release is not production-ready until both skipped
checks have been run somewhere.

## Required Final Gate

Mark each item before production traffic:

- [ ] build passes through `pnpm production:check`
- [ ] lint passes through `pnpm production:check`
- [ ] typecheck passes through `pnpm production:check`
- [ ] tests pass through `pnpm production:check`
- [ ] eval suite passes with the intended production prompt and model, using
  `--fail-on-regression` before broad rollout
- [ ] Docker images build for API, worker, and web
- [ ] database migrations apply cleanly to a disposable database restored from
  production-like backup data
- [ ] GitHub webhook signature verification works for a real GitHub delivery
- [ ] duplicate webhooks are ignored and do not enqueue duplicate review jobs
- [ ] worker processes PR jobs successfully from Redis
- [ ] comments are posted to GitHub on a controlled test PR
- [ ] dashboard shows real review data from Postgres, not demo data
- [ ] dashboard auth works and rejects missing or invalid bearer credentials
- [ ] secrets are not logged in API, worker, CLI, Docker, or reverse proxy logs
- [ ] rate limiting works on public API endpoints
- [ ] healthchecks pass for API, database, Redis, worker, and web dashboard
- [ ] release tag exists and matches the deployed image or source revision
- [ ] deployment docs are complete and match the environment being deployed

## Manual production checks

Some readiness checks require live infrastructure and cannot be proven by a
local script alone.

1. Install the GitHub App on a test repository.
2. Trigger a pull request webhook from GitHub and confirm the API returns `202`.
3. Re-deliver the same webhook from GitHub and confirm it is treated as a
   duplicate.
4. Watch worker logs until the review job reaches a completed status.
5. Confirm the controlled test PR receives only high-confidence comments.
6. Open the dashboard and verify real review runs, findings, model calls, and
   eval summaries are visible.
7. Try the dashboard API without credentials and with an invalid token; both
   should be rejected.
8. Send enough requests to exceed the configured rate limit and confirm the API
   returns a rate-limit response.
9. Check `/health`, `/health/database`, `/health/redis`, `/health/ready`, and
   worker readiness after deployment.
10. Review logs for redaction before sharing logs outside the deployment team.

## Release Decision

Treat the deployment as blocked if any required item is unchecked. Prefer a
small beta installation over broad repository rollout until the full checklist
has passed on the target environment.
