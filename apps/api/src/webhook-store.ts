export type RecordDeliveryInput = {
  action?: string;
  deliveryId: string;
  eventName: string;
};

export type RepositoryInstallationInput = {
  defaultBranch?: string;
  installationId: string;
  name: string;
  owner: string;
};

export type PullRequestWebhookInput = {
  authorLogin?: string;
  baseSha?: string;
  headSha?: string;
  number: number;
  repositoryId: string;
  status: "CLOSED" | "OPEN";
  title: string;
};

export type CreateReviewRunInput = {
  deliveryId?: string;
  pullRequestId: string;
  trigger: string;
};

export type WebhookStore = {
  createReviewRun(input: CreateReviewRunInput): Promise<{ reviewRunId: string }>;
  recordDelivery(input: RecordDeliveryInput): Promise<{ duplicate: boolean }>;
  upsertPullRequest(input: PullRequestWebhookInput): Promise<{ pullRequestId: string }>;
  upsertRepositoryInstallation(
    input: RepositoryInstallationInput,
  ): Promise<{ repositoryId: string }>;
};

type PrismaRepository = {
  id: string;
};

type PrismaPullRequest = {
  id: string;
};

type PrismaReviewRun = {
  id: string;
};

type PrismaKnownRequestError = {
  code: string;
};

type PrismaWebhookClient = {
  pullRequest: {
    upsert(input: {
      create: {
        authorLogin?: string;
        baseSha?: string;
        headSha?: string;
        number: number;
        repositoryId: string;
        status: string;
        title: string;
      };
      update: {
        authorLogin?: string;
        baseSha?: string;
        headSha?: string;
        status: string;
        title: string;
      };
      where: {
        repositoryId_number: {
          number: number;
          repositoryId: string;
        };
      };
    }): Promise<PrismaPullRequest>;
  };
  repository: {
    upsert(input: {
      create: {
        defaultBranch?: string;
        githubInstallationId: string;
        name: string;
        owner: string;
      };
      update: {
        defaultBranch?: string;
        githubInstallationId: string;
      };
      where: {
        owner_name: {
          name: string;
          owner: string;
        };
      };
    }): Promise<PrismaRepository>;
  };
  reviewRun: {
    create(input: {
      data: {
        githubDeliveryId?: string;
        pullRequestId: string;
        status: string;
        trigger: string;
      };
    }): Promise<PrismaReviewRun>;
  };
  webhookDelivery: {
    create(input: {
      data: {
        action?: string;
        deliveryId: string;
        eventName: string;
        processedAt: Date;
      };
    }): Promise<unknown>;
  };
};

export function createPrismaWebhookStore(database: PrismaWebhookClient): WebhookStore {
  return {
    async createReviewRun(input) {
      const reviewRun = await database.reviewRun.create({
        data: {
          ...(input.deliveryId === undefined ? {} : { githubDeliveryId: input.deliveryId }),
          pullRequestId: input.pullRequestId,
          status: "QUEUED",
          trigger: input.trigger,
        },
      });

      return { reviewRunId: reviewRun.id };
    },

    async recordDelivery(input) {
      try {
        await database.webhookDelivery.create({
          data: {
            ...(input.action === undefined ? {} : { action: input.action }),
            deliveryId: input.deliveryId,
            eventName: input.eventName,
            processedAt: new Date(),
          },
        });

        return { duplicate: false };
      } catch (error) {
        if (isUniqueConstraintError(error)) {
          return { duplicate: true };
        }

        throw error;
      }
    },

    async upsertPullRequest(input) {
      const pullRequest = await database.pullRequest.upsert({
        create: {
          ...(input.authorLogin === undefined ? {} : { authorLogin: input.authorLogin }),
          ...(input.baseSha === undefined ? {} : { baseSha: input.baseSha }),
          ...(input.headSha === undefined ? {} : { headSha: input.headSha }),
          number: input.number,
          repositoryId: input.repositoryId,
          status: input.status,
          title: input.title,
        },
        update: {
          ...(input.authorLogin === undefined ? {} : { authorLogin: input.authorLogin }),
          ...(input.baseSha === undefined ? {} : { baseSha: input.baseSha }),
          ...(input.headSha === undefined ? {} : { headSha: input.headSha }),
          status: input.status,
          title: input.title,
        },
        where: {
          repositoryId_number: {
            number: input.number,
            repositoryId: input.repositoryId,
          },
        },
      });

      return { pullRequestId: pullRequest.id };
    },

    async upsertRepositoryInstallation(input) {
      const repository = await database.repository.upsert({
        create: {
          ...(input.defaultBranch === undefined ? {} : { defaultBranch: input.defaultBranch }),
          githubInstallationId: input.installationId,
          name: input.name,
          owner: input.owner,
        },
        update: {
          ...(input.defaultBranch === undefined ? {} : { defaultBranch: input.defaultBranch }),
          githubInstallationId: input.installationId,
        },
        where: {
          owner_name: {
            name: input.name,
            owner: input.owner,
          },
        },
      });

      return { repositoryId: repository.id };
    },
  };
}

function isUniqueConstraintError(error: unknown): error is PrismaKnownRequestError {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === "P2002"
  );
}
