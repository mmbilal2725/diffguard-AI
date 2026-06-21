# Reviewer Pipeline

`packages/reviewer` contains the review pipeline. It accepts a repository owner,
repository name, pull request number, and GitHub auth context. The auth context
can provide either an auth token or an injected GitHub client.

The package is intentionally strict: every candidate must match the structured
finding schema, pass validator review, survive deduplication, and clear the
configured confidence threshold before it can be posted.

The pipeline flow is:

1. Fetch pull request metadata.
2. List changed files.
3. Read `.diffguard-rules.md` from the pull request head SHA.
4. Build a `ReviewContext`.
5. Run static checks. The default runner is a no-op until concrete checks are
   configured.
6. Run LLM review candidates. The default package runner is a no-op; callers can
   inject one or more structured LLM review passes. The CLI and GitHub App
   worker inject the `packages/llm` reviewer when `OPENAI_API_KEY` is
   configured. By default they run `logic-bugs`, `security-bugs`, and
   `regression-test-gaps`. Set `DIFFGUARD_REVIEW_PASSES` to a comma-separated
   subset, such as `security-bugs,regression-test-gaps`, to limit the passes.
7. Validate reviewer output with Zod.
8. Call the finding validator for every parsed candidate. The validator receives
   the PR diff, the exact changed file patch for the candidate path, relevant
   file patch context, `.diffguard-rules.md` content, static check output, the
   candidate finding details, and the original reviewer confidence.
9. Reject candidates unless the validator returns `valid: true`,
   `shouldPost: true`, confidence above the configured threshold, and
   `falsePositiveRisk` other than `high`.
10. Reject style-only and non-actionable candidates even if the validator
    approves them.
11. Apply validator `improvedComment` text to the final finding when provided.
12. Dedupe by file path, start line, category, and normalized title.
13. Filter findings below the original reviewer confidence threshold.
14. Return a `ReviewResult` with findings, rejected finding reasons, dry-run
    state, model-call telemetry, and per-stage timings.

Missing `.diffguard-rules.md` is treated as an empty rules context and does not
fail the review. Comment posting happens after this package returns a
`ReviewResult`: `packages/review-run` caps findings, skips previously posted
dedupe keys when database state is available, uses the shared unified diff
parser to map findings to diff-valid lines, batches inline GitHub review
comments into one review, posts a summary issue comment only for findings that
cannot be mapped inline, and stores review-run/finding records. The CLI and
GitHub App worker both use this shared finalization package. If no validator is
configured, the default validator rejects candidates so DiffGuard-AI prefers
silence over posting unvalidated comments.

Production validator calls are provided by `packages/llm` through the
versioned `validator-v1` prompt and the `diffguard_finding_validation`
structured-output schema. The validator model must return:

- `valid`
- `shouldPost`
- `confidence`
- `falsePositiveRisk`
- `improvedComment`
- `reason`

CLI and worker mode configure the finding validator only when
`DIFFGUARD_VALIDATOR_MODEL` or `OPENAI_RESOLUTION_MODEL` is set.
`DIFFGUARD_VALIDATOR_MODEL` takes precedence. If neither validator model is
configured, the production pipeline does not call a fallback review model for
validation; it rejects every candidate safely.

If `OPENAI_API_KEY` is missing, CLI and worker mode do not call the LLM provider.
They return or log a clear warning that `OPENAI_API_KEY` is not configured and
LLM review is being skipped safely, then continue without speculative comments.
Structured LLM output is always parsed through `ReviewFindingOutputSchema`;
invalid mocked or real model responses are rejected before findings reach
validator, deduplication, or posting.
