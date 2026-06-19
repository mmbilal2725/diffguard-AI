import { type ReviewTrigger } from "@diffguard/shared";
import { z } from "zod";

const SupportedPullRequestActionSchema = z.enum(["opened", "reopened", "synchronize"]);
const ManualReviewCommand = "/diffguard review";

const RepositorySchema = z.object({
  default_branch: z.string().min(1).optional(),
  name: z.string().min(1),
  owner: z.object({
    login: z.string().min(1),
  }),
});

const InstallationSchema = z.object({
  id: z.number().int().positive(),
});

const PullRequestPayloadSchema = z.object({
  action: SupportedPullRequestActionSchema,
  installation: InstallationSchema,
  pull_request: z.object({
    base: z.object({
      sha: z.string().min(1),
    }),
    head: z.object({
      sha: z.string().min(1),
    }),
    number: z.number().int().positive(),
    state: z.string().min(1),
    title: z.string().min(1),
    user: z
      .object({
        login: z.string().min(1),
      })
      .nullable()
      .optional(),
  }),
  repository: RepositorySchema,
});

const IssueCommentPayloadSchema = z.object({
  action: z.literal("created"),
  comment: z.object({
    body: z.string(),
  }),
  installation: InstallationSchema,
  issue: z.object({
    number: z.number().int().positive(),
    pull_request: z.unknown().optional(),
    state: z.string().min(1),
    title: z.string().min(1),
    user: z
      .object({
        login: z.string().min(1),
      })
      .nullable()
      .optional(),
  }),
  repository: RepositorySchema,
});

export type ReviewWebhookRequest = {
  baseSha?: string;
  defaultBranch?: string;
  headSha?: string;
  installationId: string;
  owner: string;
  pullNumber: number;
  pullRequestAuthorLogin?: string;
  pullRequestStatus: "CLOSED" | "OPEN";
  pullRequestTitle: string;
  repo: string;
  trigger: ReviewTrigger;
};

export function readWebhookAction(payload: unknown): string | undefined {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "action" in payload &&
    typeof (payload as { action: unknown }).action === "string"
  ) {
    return (payload as { action: string }).action;
  }

  return undefined;
}

export function toReviewWebhookRequest(
  eventName: string,
  payload: unknown,
): ReviewWebhookRequest | null {
  if (eventName === "pull_request") {
    return readPullRequestReviewRequest(payload);
  }

  if (eventName === "issue_comment") {
    return readManualReviewRequest(payload);
  }

  return null;
}

function readPullRequestReviewRequest(payload: unknown): ReviewWebhookRequest | null {
  const parsed = PullRequestPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    return null;
  }

  return {
    baseSha: parsed.data.pull_request.base.sha,
    defaultBranch: parsed.data.repository.default_branch,
    headSha: parsed.data.pull_request.head.sha,
    installationId: String(parsed.data.installation.id),
    owner: parsed.data.repository.owner.login,
    pullNumber: parsed.data.pull_request.number,
    pullRequestAuthorLogin: parsed.data.pull_request.user?.login,
    pullRequestStatus: mapPullRequestStatus(parsed.data.pull_request.state),
    pullRequestTitle: parsed.data.pull_request.title,
    repo: parsed.data.repository.name,
    trigger: `pull_request.${parsed.data.action}`,
  };
}

function readManualReviewRequest(payload: unknown): ReviewWebhookRequest | null {
  const parsed = IssueCommentPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    return null;
  }

  if (parsed.data.issue.pull_request === undefined) {
    return null;
  }

  if (parsed.data.comment.body.trim() !== ManualReviewCommand) {
    return null;
  }

  return {
    defaultBranch: parsed.data.repository.default_branch,
    installationId: String(parsed.data.installation.id),
    owner: parsed.data.repository.owner.login,
    pullNumber: parsed.data.issue.number,
    pullRequestAuthorLogin: parsed.data.issue.user?.login,
    pullRequestStatus: mapPullRequestStatus(parsed.data.issue.state),
    pullRequestTitle: parsed.data.issue.title,
    repo: parsed.data.repository.name,
    trigger: "issue_comment.diffguard_review",
  };
}

function mapPullRequestStatus(state: string): "CLOSED" | "OPEN" {
  return state.toLowerCase() === "closed" ? "CLOSED" : "OPEN";
}
