# Reviewer Pipeline

`packages/reviewer` contains the first review pipeline version. It accepts a
repository owner, repository name, pull request number, and GitHub auth context.
The auth context can provide either an auth token or an injected GitHub client.

The pipeline flow is:

1. Fetch pull request metadata.
2. List changed files.
3. Read `.diffguard-rules.md` from the pull request head SHA.
4. Build a `ReviewContext`.
5. Run placeholder static checks.
6. Run a placeholder or injected LLM reviewer.
7. Validate reviewer output with Zod.
8. Call the finding validator for every parsed candidate. The validator receives
   the PR diff, relevant file patch context, `.diffguard-rules.md` content,
   static check output, and the candidate finding details.
9. Reject candidates unless the validator returns `valid: true`,
   `shouldPost: true`, confidence above the configured threshold, and
   `falsePositiveRisk` other than `high`.
10. Reject style-only and non-actionable candidates even if the validator
    approves them.
11. Apply validator `improvedComment` text to the final finding when provided.
12. Dedupe by file path, start line, category, and normalized title.
13. Filter findings below the original reviewer confidence threshold.
14. Return a `ReviewResult` with findings, rejected finding reasons, dry-run
    state, and per-stage timings.

Missing `.diffguard-rules.md` is treated as an empty rules context and does not
fail the review. The first version does not post GitHub comments; dry-run state
is recorded on the context and result for the worker/API layers to honor when
comment posting is added. If no validator is configured, the placeholder
validator rejects candidates by default so DiffGuard-AI prefers silence over
posting unvalidated comments.
