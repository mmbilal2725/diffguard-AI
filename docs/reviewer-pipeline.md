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
8. Reject style-only output.
9. Dedupe by file path, start line, category, and normalized title.
10. Filter findings below the confidence threshold.
11. Return a `ReviewResult` with findings, rejected finding reasons, dry-run
    state, and per-stage timings.

Missing `.diffguard-rules.md` is treated as an empty rules context and does not
fail the review. The first version does not post GitHub comments; dry-run state
is recorded on the context and result for the worker/API layers to honor when
comment posting is added.
