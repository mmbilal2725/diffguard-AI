import { createSign } from "node:crypto";

import { Octokit } from "@octokit/rest";
import { z } from "zod";

const RepositoryRefSchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
});

export const PullRequestRefSchema = RepositoryRefSchema.extend({
  number: z.number().int().positive(),
});

const FileAtRefInputSchema = RepositoryRefSchema.extend({
  path: z.string().min(1),
  ref: z.string().min(1),
});

const PostPullRequestCommentInputSchema = z.object({
  body: z.string().min(1).max(65536),
  ref: PullRequestRefSchema,
});

const ReviewCommentInputSchema = z
  .object({
    body: z.string().min(1).max(65536),
    line: z.number().int().positive().optional(),
    path: z.string().min(1),
    side: z.enum(["LEFT", "RIGHT"]).optional(),
    startLine: z.number().int().positive().optional(),
    startSide: z.enum(["LEFT", "RIGHT"]).optional(),
  })
  .refine((comment) => comment.line !== undefined, {
    message: "line is required for inline review comments",
    path: ["line"],
  })
  .refine(
    (comment) => comment.startLine === undefined || comment.startLine <= (comment.line ?? 0),
    {
      message: "startLine must be less than or equal to line",
      path: ["startLine"],
    },
  );

const CreatePullRequestReviewInputSchema = z.object({
  body: z.string().min(1).max(65536).optional(),
  comments: z.array(ReviewCommentInputSchema).min(1),
  event: z.enum(["APPROVE", "REQUEST_CHANGES", "COMMENT"]),
  ref: PullRequestRefSchema,
});

const ListPullRequestReviewCommentsInputSchema = z.object({
  ref: PullRequestRefSchema,
  reviewId: z.number().int().positive(),
});

const GitHubClientConfigSchema = z
  .object({
    authToken: z.string().min(1).optional(),
    octokit: z.custom<GitHubApi>().optional(),
  })
  .refine((config) => config.authToken !== undefined || config.octokit !== undefined, {
    message: "authToken or octokit is required",
    path: ["authToken"],
  });

const PullRequestResponseSchema = z.object({
  additions: z.number(),
  base: z.object({ ref: z.string(), sha: z.string() }),
  changed_files: z.number(),
  deletions: z.number(),
  draft: z.boolean().optional().default(false),
  head: z.object({ ref: z.string(), sha: z.string() }),
  html_url: z.string(),
  id: z.number(),
  number: z.number(),
  state: z.string(),
  title: z.string(),
  user: z.object({ login: z.string() }).nullable().optional(),
});

const PullRequestFileResponseSchema = z.object({
  additions: z.number(),
  changes: z.number(),
  deletions: z.number(),
  filename: z.string(),
  patch: z.string().optional(),
  previous_filename: z.string().optional(),
  sha: z.string(),
  status: z.string(),
});

const RepositoryFileResponseSchema = z.object({
  content: z.string(),
  encoding: z.string(),
  html_url: z.string(),
  path: z.string(),
  sha: z.string(),
  size: z.number(),
  type: z.literal("file"),
});

const IssueCommentResponseSchema = z.object({
  body: z.string().nullable().optional(),
  html_url: z.string(),
  id: z.number(),
});

const PullRequestReviewResponseSchema = z.object({
  body: z.string().nullable().optional(),
  html_url: z.string(),
  id: z.number(),
  state: z.string(),
});

const PullRequestReviewCommentResponseSchema = z.object({
  body: z.string().nullable().optional(),
  html_url: z.string(),
  id: z.number(),
  line: z.number().nullable().optional(),
  path: z.string(),
  side: z.enum(["LEFT", "RIGHT"]).nullable().optional(),
});

const GitHubAppInstallationTokenInputSchema = z.object({
  appId: z.string().min(1),
  baseUrl: z.string().url().default("https://api.github.com"),
  fetchImpl: z
    .custom<FetchLike>()
    .default(() => fetch as FetchLike),
  installationId: z.string().min(1),
  now: z.date().default(() => new Date()),
  privateKey: z.string().min(1),
});

const InstallationTokenResponseSchema = z.object({
  expires_at: z.string().min(1),
  token: z.string().min(1),
});

export type PullRequestRef = z.infer<typeof PullRequestRefSchema>;
export type FileAtRefInput = z.infer<typeof FileAtRefInputSchema>;
export type PostPullRequestCommentInput = z.infer<typeof PostPullRequestCommentInputSchema>;
export type ReviewCommentInput = z.infer<typeof ReviewCommentInputSchema>;
export type CreatePullRequestReviewInput = z.infer<typeof CreatePullRequestReviewInputSchema>;
export type ListPullRequestReviewCommentsInput = z.infer<
  typeof ListPullRequestReviewCommentsInputSchema
>;

export type PullRequestMetadata = {
  additions: number;
  authorLogin?: string;
  baseRef: string;
  baseSha: string;
  changedFiles: number;
  deletions: number;
  draft: boolean;
  headRef: string;
  headSha: string;
  htmlUrl: string;
  id: number;
  number: number;
  state: string;
  title: string;
};

export type PullRequestFile = {
  additions: number;
  changes: number;
  deletions: number;
  filename: string;
  patch?: string;
  previousFilename?: string;
  sha: string;
  status: string;
};

export type RepositoryFile = {
  content: string;
  encoding: string;
  htmlUrl: string;
  path: string;
  sha: string;
  size: number;
};

export type PullRequestComment = {
  body?: string;
  htmlUrl: string;
  id: number;
};

export type PullRequestReview = {
  body?: string;
  htmlUrl: string;
  id: number;
  state: string;
};

export type PullRequestReviewComment = {
  body?: string;
  htmlUrl: string;
  id: number;
  line?: number;
  path: string;
  side?: "LEFT" | "RIGHT";
};

export type GitHubErrorKind =
  | "validation"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "rate_limited"
  | "unexpected_response"
  | "github_api";

export type GitHubError = {
  kind: GitHubErrorKind;
  message: string;
  status?: number;
  validationIssues?: Array<{ message: string; path: string }>;
};

export type GitHubResult<T> = { ok: true; data: T } | { ok: false; error: GitHubError };

export type GitHubClientConfig = z.input<typeof GitHubClientConfigSchema>;
export type GitHubAppInstallationTokenInput = z.input<
  typeof GitHubAppInstallationTokenInputSchema
>;
export type GitHubAppInstallationToken = {
  expiresAt: string;
  token: string;
};

type FetchLike = (
  url: string,
  init: {
    headers: Record<string, string>;
    method: "POST";
  },
) => Promise<{
  json(): Promise<unknown>;
  ok: boolean;
  status: number;
}>;

type GitHubResponse<T> = Promise<{ data: T }>;

type PullsGetParams = {
  owner: string;
  pull_number: number;
  repo: string;
};

type PullsListFilesParams = PullsGetParams & {
  per_page: number;
};

type ReposGetContentParams = {
  owner: string;
  path: string;
  ref: string;
  repo: string;
};

type IssuesCreateCommentParams = {
  body: string;
  issue_number: number;
  owner: string;
  repo: string;
};

type PullsCreateReviewCommentParams = {
  body: string;
  line: number;
  path: string;
  side?: "LEFT" | "RIGHT";
  start_line?: number;
  start_side?: "LEFT" | "RIGHT";
};

type PullsCreateReviewParams = {
  body?: string;
  comments: PullsCreateReviewCommentParams[];
  event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT";
  owner: string;
  pull_number: number;
  repo: string;
};

type PullsListReviewCommentsParams = PullsGetParams & {
  review_id: number;
};

type GitHubApi = {
  paginate<T>(method: unknown, params: PullsListFilesParams | PullsListReviewCommentsParams): Promise<T[]>;
  request(route: string, params: Record<string, unknown>): GitHubResponse<unknown>;
  rest: {
    issues: {
      createComment(params: IssuesCreateCommentParams): GitHubResponse<unknown>;
    };
    pulls: {
      createReview(params: PullsCreateReviewParams): GitHubResponse<unknown>;
      get(params: PullsGetParams): GitHubResponse<unknown>;
      listFiles: unknown;
      listReviewComments: unknown;
    };
    repos: {
      getContent(params: ReposGetContentParams): GitHubResponse<unknown>;
    };
  };
};

export type DiffGuardGitHubClient = {
  createPullRequestReview(
    input: CreatePullRequestReviewInput,
  ): Promise<GitHubResult<PullRequestReview>>;
  fetchPullRequestDiff(ref: PullRequestRef): Promise<GitHubResult<string>>;
  getPullRequestMetadata(ref: PullRequestRef): Promise<GitHubResult<PullRequestMetadata>>;
  listPullRequestFiles(ref: PullRequestRef): Promise<GitHubResult<PullRequestFile[]>>;
  listPullRequestReviewComments(
    input: ListPullRequestReviewCommentsInput,
  ): Promise<GitHubResult<PullRequestReviewComment[]>>;
  postPullRequestComment(
    input: PostPullRequestCommentInput,
  ): Promise<GitHubResult<PullRequestComment>>;
  readDiffGuardRules(input: Omit<FileAtRefInput, "path">): Promise<GitHubResult<string | null>>;
  readFileAtRef(input: FileAtRefInput): Promise<GitHubResult<RepositoryFile>>;
};

export function buildPullRequestKey(ref: PullRequestRef): string {
  const parsed = PullRequestRefSchema.parse(ref);

  return `${parsed.owner}/${parsed.repo}#${parsed.number}`;
}

export async function createGitHubAppInstallationToken(
  input: GitHubAppInstallationTokenInput,
): Promise<GitHubAppInstallationToken> {
  const parsed = GitHubAppInstallationTokenInputSchema.parse(input);
  const jwt = createGitHubAppJwt({
    appId: parsed.appId,
    now: parsed.now,
    privateKey: parsed.privateKey,
  });
  const response = await parsed.fetchImpl(
    `${parsed.baseUrl}/app/installations/${parsed.installationId}/access_tokens`,
    {
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${jwt}`,
        "x-github-api-version": "2022-11-28",
      },
      method: "POST",
    },
  );

  if (!response.ok) {
    throw new Error(`Failed to create GitHub installation token. Status: ${response.status}.`);
  }

  const payload = InstallationTokenResponseSchema.parse(await response.json());

  return {
    expiresAt: payload.expires_at,
    token: payload.token,
  };
}

export function createGitHubClient(config: GitHubClientConfig): DiffGuardGitHubClient {
  const parsedConfig = GitHubClientConfigSchema.parse(config);
  const octokit =
    parsedConfig.octokit ?? (new Octokit({ auth: parsedConfig.authToken }) as GitHubApi);

  return {
    async createPullRequestReview(input) {
      return withValidatedInput(CreatePullRequestReviewInputSchema, input, async (parsed) => {
        const response = await octokit.rest.pulls.createReview({
          body: parsed.body,
          comments: parsed.comments.map(toGitHubReviewComment),
          event: parsed.event,
          owner: parsed.ref.owner,
          pull_number: parsed.ref.number,
          repo: parsed.ref.repo,
        });
        const review = PullRequestReviewResponseSchema.parse(response.data);

        return {
          body: review.body ?? undefined,
          htmlUrl: review.html_url,
          id: review.id,
          state: review.state,
        };
      });
    },

    async fetchPullRequestDiff(ref) {
      return withValidatedInput(PullRequestRefSchema, ref, async (parsed) => {
        const response = await octokit.request("GET /repos/{owner}/{repo}/pulls/{pull_number}", {
          headers: { accept: "application/vnd.github.v3.diff" },
          owner: parsed.owner,
          pull_number: parsed.number,
          repo: parsed.repo,
        });

        if (typeof response.data !== "string") {
          throw createUnexpectedResponseError("GitHub diff response was not text.");
        }

        return response.data;
      });
    },

    async getPullRequestMetadata(ref) {
      return withValidatedInput(PullRequestRefSchema, ref, async (parsed) => {
        const response = await octokit.rest.pulls.get({
          owner: parsed.owner,
          pull_number: parsed.number,
          repo: parsed.repo,
        });
        const pullRequest = PullRequestResponseSchema.parse(response.data);

        return {
          additions: pullRequest.additions,
          authorLogin: pullRequest.user?.login,
          baseRef: pullRequest.base.ref,
          baseSha: pullRequest.base.sha,
          changedFiles: pullRequest.changed_files,
          deletions: pullRequest.deletions,
          draft: pullRequest.draft,
          headRef: pullRequest.head.ref,
          headSha: pullRequest.head.sha,
          htmlUrl: pullRequest.html_url,
          id: pullRequest.id,
          number: pullRequest.number,
          state: pullRequest.state,
          title: pullRequest.title,
        };
      });
    },

    async listPullRequestFiles(ref) {
      return withValidatedInput(PullRequestRefSchema, ref, async (parsed) => {
        const files = await octokit.paginate<unknown>(octokit.rest.pulls.listFiles, {
          owner: parsed.owner,
          per_page: 100,
          pull_number: parsed.number,
          repo: parsed.repo,
        });

        return files.map((file) => {
          const parsedFile = PullRequestFileResponseSchema.parse(file);

          return {
            additions: parsedFile.additions,
            changes: parsedFile.changes,
            deletions: parsedFile.deletions,
            filename: parsedFile.filename,
            patch: parsedFile.patch,
            previousFilename: parsedFile.previous_filename,
            sha: parsedFile.sha,
            status: parsedFile.status,
          };
        });
      });
    },

    async listPullRequestReviewComments(input) {
      return withValidatedInput(ListPullRequestReviewCommentsInputSchema, input, async (parsed) => {
        const comments = await octokit.paginate<unknown>(octokit.rest.pulls.listReviewComments, {
          owner: parsed.ref.owner,
          pull_number: parsed.ref.number,
          repo: parsed.ref.repo,
          review_id: parsed.reviewId,
        });

        return comments.map((comment) => {
          const parsedComment = PullRequestReviewCommentResponseSchema.parse(comment);

          return {
            body: parsedComment.body ?? undefined,
            htmlUrl: parsedComment.html_url,
            id: parsedComment.id,
            line: parsedComment.line ?? undefined,
            path: parsedComment.path,
            side: parsedComment.side ?? undefined,
          };
        });
      });
    },

    async postPullRequestComment(input) {
      return withValidatedInput(PostPullRequestCommentInputSchema, input, async (parsed) => {
        const response = await octokit.rest.issues.createComment({
          body: parsed.body,
          issue_number: parsed.ref.number,
          owner: parsed.ref.owner,
          repo: parsed.ref.repo,
        });
        const comment = IssueCommentResponseSchema.parse(response.data);

        return {
          body: comment.body ?? undefined,
          htmlUrl: comment.html_url,
          id: comment.id,
        };
      });
    },

    async readDiffGuardRules(input) {
      const parsed = RepositoryRefSchema.extend({ ref: z.string().min(1) }).safeParse(input);
      if (!parsed.success) {
        return createValidationResult(parsed.error);
      }

      const fileResult = await this.readFileAtRef({
        owner: parsed.data.owner,
        path: ".diffguard-rules.md",
        ref: parsed.data.ref,
        repo: parsed.data.repo,
      });

      if (!fileResult.ok && fileResult.error.kind === "not_found") {
        return { ok: true, data: null };
      }

      if (!fileResult.ok) {
        return fileResult;
      }

      return { ok: true, data: fileResult.data.content };
    },

    async readFileAtRef(input) {
      return withValidatedInput(FileAtRefInputSchema, input, async (parsed) => {
        const response = await octokit.rest.repos.getContent({
          owner: parsed.owner,
          path: parsed.path,
          ref: parsed.ref,
          repo: parsed.repo,
        });
        const file = RepositoryFileResponseSchema.parse(response.data);

        return {
          content: decodeRepositoryFile(file.content, file.encoding),
          encoding: file.encoding,
          htmlUrl: file.html_url,
          path: file.path,
          sha: file.sha,
          size: file.size,
        };
      });
    },
  };
}

function createGitHubAppJwt(input: { appId: string; now: Date; privateKey: string }): string {
  const issuedAt = Math.floor(input.now.getTime() / 1000) - 60;
  const expiresAt = issuedAt + 9 * 60;
  const header = base64UrlJson({
    alg: "RS256",
    typ: "JWT",
  });
  const payload = base64UrlJson({
    exp: expiresAt,
    iat: issuedAt,
    iss: input.appId,
  });
  const signingInput = `${header}.${payload}`;
  const signature = createSign("RSA-SHA256")
    .update(signingInput)
    .end()
    .sign(input.privateKey)
    .toString("base64url");

  return `${signingInput}.${signature}`;
}

function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

async function withValidatedInput<TInput, TOutput>(
  schema: z.ZodType<TInput>,
  input: unknown,
  operation: (input: TInput) => Promise<TOutput>,
): Promise<GitHubResult<TOutput>> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return createValidationResult(parsed.error);
  }

  try {
    return { ok: true, data: await operation(parsed.data) };
  } catch (error) {
    return { ok: false, error: toGitHubError(error) };
  }
}

function createValidationResult<T>(error: z.ZodError): GitHubResult<T> {
  return {
    ok: false,
    error: {
      kind: "validation",
      message: "Invalid GitHub client input.",
      validationIssues: error.issues.map((issue) => ({
        message: issue.message,
        path: issue.path.join("."),
      })),
    },
  };
}

function toGitHubReviewComment(comment: ReviewCommentInput): PullsCreateReviewCommentParams {
  if (comment.line === undefined) {
    throw createUnexpectedResponseError("Validated review comment is missing a line.");
  }

  return {
    body: comment.body,
    line: comment.line,
    path: comment.path,
    side: comment.side,
    start_line: comment.startLine,
    start_side: comment.startSide,
  };
}

function decodeRepositoryFile(content: string, encoding: string): string {
  if (encoding !== "base64") {
    throw createUnexpectedResponseError(`Unsupported repository file encoding: ${encoding}.`);
  }

  return Buffer.from(content.replace(/\s/g, ""), "base64").toString("utf8");
}

function createUnexpectedResponseError(message: string): GitHubError {
  return { kind: "unexpected_response", message };
}

function toGitHubError(error: unknown): GitHubError {
  if (isGitHubError(error)) {
    return fromStatus(error.status);
  }

  if (error instanceof z.ZodError) {
    return {
      kind: "unexpected_response",
      message: "GitHub response did not match the expected shape.",
      validationIssues: error.issues.map((issue) => ({
        message: issue.message,
        path: issue.path.join("."),
      })),
    };
  }

  if (isDiffGuardGitHubError(error)) {
    return error;
  }

  return {
    kind: "github_api",
    message: "GitHub request failed.",
  };
}

function fromStatus(status: number): GitHubError {
  switch (status) {
    case 401:
      return {
        kind: "unauthorized",
        message: "GitHub request failed with status 401.",
        status,
      };
    case 403:
      return {
        kind: "forbidden",
        message: "GitHub request failed with status 403.",
        status,
      };
    case 404:
      return {
        kind: "not_found",
        message: "GitHub resource was not found.",
        status,
      };
    case 429:
      return {
        kind: "rate_limited",
        message: "GitHub request was rate limited.",
        status,
      };
    default:
      return {
        kind: "github_api",
        message: `GitHub request failed with status ${status}.`,
        status,
      };
  }
}

function isGitHubError(error: unknown): error is { status: number } {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof (error as { status: unknown }).status === "number"
  );
}

function isDiffGuardGitHubError(error: unknown): error is GitHubError {
  return (
    typeof error === "object" &&
    error !== null &&
    "kind" in error &&
    typeof (error as { kind: unknown }).kind === "string" &&
    "message" in error &&
    typeof (error as { message: unknown }).message === "string"
  );
}
