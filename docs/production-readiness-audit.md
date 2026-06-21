# Production Readiness Audit

Date: 2026-06-21

Scope: current `F:\diffguard-AI` checkout, including workspace install, root scripts, TypeScript, lint, tests, Prisma generation/schema validation, package references, CLI smoke behavior, and README/docs claims.

## Summary

The repository is in good shape for TypeScript, lint, tests, workspace linking, and Prisma client generation. The main production-readiness blocker is Prisma migration history: the checked-in migration set does not create the full schema from an empty database.

No application code fixes were made during this audit. This file is the only intended audit artifact.

## Fix Pass Update

Date: 2026-06-21

Requested scope: fix current build, lint, typecheck, test, workspace reference, package dependency, script, and Prisma generation failures without changing product behavior.

Result: no product code fixes were required. The current workspace scripts, imports, exports, package dependencies, workspace references, unit tests, TypeScript configuration, and Prisma client generation all verify cleanly.

The only reproduced failure was command-shell specific: running `pnpm lint` directly in PowerShell selected `C:\Users\MyCom\AppData\Roaming\npm\pnpm.ps1`, which was blocked by the local execution policy before the repository scripts ran. This is not a repo failure. Running the same scripts through `cmd /c pnpm ...` or `pnpm.cmd ...` resolves the Windows command shim and exercises the actual workspace commands.

No feature behavior was changed.

## Verification Results

| Area | Command | Result |
| --- | --- | --- |
| Install compatibility | `pnpm.cmd install --frozen-lockfile` | Passed. Lockfile was up to date and workspace links were already current. |
| Lint | `pnpm.cmd lint` | Passed across all packages with `--max-warnings=0`. |
| TypeScript | `pnpm.cmd typecheck` | Passed across all packages. |
| Tests | `pnpm.cmd test` | Passed across all packages. Total observed package tests: shared 5, database 1, web 6, github 12, api 20, llm 6, reviewer 20, review-run 6, evals 4, worker 8, cli 19. |
| Prisma generate | `pnpm.cmd prisma:generate` | Passed outside the managed sandbox. Generated Prisma Client successfully. |
| Prisma schema validation | `cmd /c "set DATABASE_URL=postgresql://diffguard:diffguard@localhost:5432/diffguard && pnpm.cmd --filter @diffguard/database exec prisma validate"` | Passed. Schema is valid. |
| Prisma migration inspection | `pnpm.cmd --filter @diffguard/database exec prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script` | Passed and showed the full baseline schema that migrations should be able to create. |
| CLI eval smoke | `pnpm.cmd --filter @diffguard/cli start -- eval run --model audit-smoke --prompt-version audit-smoke --output json` | Passed with exit code 0. Report showed 10 false negatives and 0 false positives because no LLM-backed reviewer was configured. |
| Web production build | `cmd /c pnpm --filter @diffguard/web build` | Passed. Next.js emitted a non-fatal warning that the Next ESLint plugin is not configured. |

Note: in the managed sandbox, Node-based commands that execute package binaries can fail before repo code runs with `EPERM: operation not permitted, lstat 'C:\Users\MyCom'`. Rerunning outside the sandbox confirmed `prisma:generate` and the CLI smoke path work.

Latest fix-pass verification:

| Area | Command | Result |
| --- | --- | --- |
| Install compatibility | `cmd /c pnpm install --frozen-lockfile` | Passed. Lockfile was up to date and workspace links were current. |
| Lint | `cmd /c pnpm lint` | Passed across all packages. |
| TypeScript | `cmd /c pnpm typecheck` | Passed across all packages. |
| Tests | `cmd /c pnpm test` | Passed across all packages. |
| Prisma generate | `cmd /c pnpm prisma:generate` | Passed and generated Prisma Client. |
| Web production build | `cmd /c pnpm --filter @diffguard/web build` | Passed. |

## Prioritized Blockers

### P0 - Prisma migration history is incomplete

`packages/database/prisma/schema.prisma` defines the full application database model:

- `Repository`
- `PullRequest`
- `ReviewRun`
- `WebhookDelivery`
- `EvalRun`
- `Finding`
- `ModelCall`
- `FeedbackEvent`
- all supporting enums, indexes, and foreign keys

The only checked-in migration is `packages/database/prisma/migrations/20260621000000_add_eval_runs/migration.sql`, and it only creates `EvalRun`.

Impact: a fresh production database created with `pnpm prisma:migrate` will not get the required repository, pull request, review run, finding, model call, webhook delivery, or feedback tables. GitHub App mode, dashboard APIs, review persistence, duplicate suppression, and resolution tracking all depend on those tables.

Recommended fix: add an intentional baseline migration for the pre-`EvalRun` schema, then keep the existing `add_eval_runs` migration after it. If any real database already has tables created outside Prisma migrations, decide whether to baseline with `prisma migrate resolve` or reset that environment before applying the new migration history.

### P1 - Migration command was not run against a live database in this audit

`pnpm.cmd prisma:generate` and Prisma schema validation pass, but `pnpm prisma:migrate` requires a reachable Postgres database and was not applied during this audit. Because migration history is incomplete, applying it to an empty database is expected to be wrong until P0 is fixed.

Recommended verification after P0: start Postgres, set `DATABASE_URL`, then run `pnpm.cmd prisma:migrate` or `pnpm.cmd --filter @diffguard/database prisma:migrate` against a disposable database.

### P1 - README production-readiness wording is ahead of migration readiness

The current README says the project is ready for controlled beta deployments. Most supporting implementation exists and the verification suite passes, but the incomplete migration history blocks reliable database-backed deployment from a fresh environment.

Recommended fix: either fix P0 first or soften the README wording to say controlled beta is blocked until database migrations are baselined.

### P2 - Eval smoke has zero recall without an LLM-backed reviewer

The CLI eval smoke command exits successfully without `--fail-on-regression`, but the starter suite reports 10 false negatives and 0 true positives when run with the default/no-provider path.

This matches the current local behavior and is not a script failure. For production gates, run evals with the intended LLM configuration and `--fail-on-regression`.

## Docs And Implementation Alignment

Verified as implemented:

- Dashboard API routes in `apps/api`: `/dashboard/overview`, `/dashboard/review-runs`, `/dashboard/review-runs/:id`, `/dashboard/repositories`, `/dashboard/findings`, `/dashboard/evals`.
- Dashboard API bearer-key support through `DIFFGUARD_DASHBOARD_API_KEY`.
- Browser origin allowlisting through `DIFFGUARD_ALLOWED_ORIGINS`.
- Per-client in-memory API rate limiting through `DIFFGUARD_RATE_LIMIT_MAX_REQUESTS` and `DIFFGUARD_RATE_LIMIT_WINDOW_MS`.
- Web dashboard server-side API loading through `apps/web/src/lib/dashboard-data.ts`.
- Local dashboard demo fallback only when `DIFFGUARD_DEMO_MODE=true`.
- Eval summary persistence when `DATABASE_URL` is set.
- GitHub webhook signature verification, duplicate delivery handling, GitHub App installation token flow, and review queueing are covered by code and tests.

Known mismatch:

- README/docs imply database-backed beta readiness, but the migration directory cannot currently build the full schema from scratch.

## Commands Needed To Verify The Repo

Use `pnpm.cmd` on Windows PowerShell:

```powershell
pnpm.cmd install --frozen-lockfile
pnpm.cmd lint
pnpm.cmd typecheck
pnpm.cmd test
pnpm.cmd prisma:generate
cmd /c "set DATABASE_URL=postgresql://diffguard:diffguard@localhost:5432/diffguard && pnpm.cmd --filter @diffguard/database exec prisma validate"
pnpm.cmd --filter @diffguard/database exec prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script
pnpm.cmd --filter @diffguard/cli start -- eval run --model audit-smoke --prompt-version audit-smoke --output json
```

After fixing migration history, add a disposable database migration check:

```powershell
pnpm.cmd prisma:migrate
```

Use a real or disposable `DATABASE_URL`; do not point this at production until the baseline migration strategy is decided.
