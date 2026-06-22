CREATE SCHEMA IF NOT EXISTS "public";

CREATE TYPE "PullRequestStatus" AS ENUM ('OPEN', 'CLOSED', 'MERGED');
CREATE TYPE "ReviewRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELED');
CREATE TYPE "FindingSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
CREATE TYPE "FindingCategory" AS ENUM (
  'logic',
  'security',
  'performance',
  'reliability',
  'regression',
  'testing',
  'data-loss',
  'api-contract',
  'authorization',
  'validation'
);
CREATE TYPE "FindingSide" AS ENUM ('LEFT', 'RIGHT');
CREATE TYPE "FindingStatus" AS ENUM (
  'VALIDATED',
  'POSTED',
  'DISMISSED',
  'RESOLVED',
  'UNRESOLVED',
  'FALSE_POSITIVE',
  'UNKNOWN'
);
CREATE TYPE "ModelCallStatus" AS ENUM ('SUCCEEDED', 'FAILED');
CREATE TYPE "FeedbackEventType" AS ENUM (
  'FALSE_POSITIVE',
  'RESOLVED',
  'DISMISSED',
  'HELPFUL',
  'NOT_HELPFUL'
);

CREATE TABLE "Repository" (
  "id" TEXT NOT NULL,
  "owner" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "githubInstallationId" TEXT,
  "defaultBranch" TEXT,
  "rulesPath" TEXT NOT NULL DEFAULT '.diffguard-rules.md',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Repository_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PullRequest" (
  "id" TEXT NOT NULL,
  "repositoryId" TEXT NOT NULL,
  "number" INTEGER NOT NULL,
  "title" TEXT NOT NULL,
  "authorLogin" TEXT,
  "baseSha" TEXT,
  "headSha" TEXT,
  "status" "PullRequestStatus" NOT NULL DEFAULT 'OPEN',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PullRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ReviewRun" (
  "id" TEXT NOT NULL,
  "pullRequestId" TEXT NOT NULL,
  "status" "ReviewRunStatus" NOT NULL DEFAULT 'QUEUED',
  "trigger" TEXT,
  "githubDeliveryId" TEXT,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "findingsDetected" INTEGER NOT NULL DEFAULT 0,
  "findingsPosted" INTEGER NOT NULL DEFAULT 0,
  "validatorRejectionRate" DECIMAL(5, 4),
  "estimatedFalsePositives" INTEGER NOT NULL DEFAULT 0,
  "resolvedFindings" INTEGER NOT NULL DEFAULT 0,
  "totalCostUsd" DECIMAL(12, 6) NOT NULL DEFAULT 0,
  "latencyMs" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ReviewRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WebhookDelivery" (
  "id" TEXT NOT NULL,
  "deliveryId" TEXT NOT NULL,
  "eventName" TEXT NOT NULL,
  "action" TEXT,
  "processedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Finding" (
  "id" TEXT NOT NULL,
  "reviewRunId" TEXT NOT NULL,
  "dedupeKey" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "evidence" TEXT NOT NULL,
  "category" "FindingCategory" NOT NULL,
  "severity" "FindingSeverity" NOT NULL,
  "confidence" DECIMAL(3, 2) NOT NULL,
  "filePath" TEXT NOT NULL,
  "line" INTEGER NOT NULL,
  "side" "FindingSide" NOT NULL DEFAULT 'RIGHT',
  "suggestedFix" TEXT,
  "whyItMatters" TEXT NOT NULL,
  "relatedRuleIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "status" "FindingStatus" NOT NULL DEFAULT 'VALIDATED',
  "githubCommentId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Finding_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ModelCall" (
  "id" TEXT NOT NULL,
  "reviewRunId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "modelName" TEXT NOT NULL,
  "promptVersion" TEXT NOT NULL,
  "inputTokens" INTEGER NOT NULL DEFAULT 0,
  "outputTokens" INTEGER NOT NULL DEFAULT 0,
  "totalTokens" INTEGER NOT NULL DEFAULT 0,
  "costUsd" DECIMAL(12, 6) NOT NULL DEFAULT 0,
  "latencyMs" INTEGER NOT NULL,
  "status" "ModelCallStatus" NOT NULL,
  "errorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ModelCall_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FeedbackEvent" (
  "id" TEXT NOT NULL,
  "reviewRunId" TEXT NOT NULL,
  "findingId" TEXT,
  "type" "FeedbackEventType" NOT NULL,
  "actorLogin" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "FeedbackEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Repository_githubInstallationId_idx" ON "Repository"("githubInstallationId");
CREATE UNIQUE INDEX "Repository_owner_name_key" ON "Repository"("owner", "name");

CREATE INDEX "PullRequest_repositoryId_status_idx" ON "PullRequest"("repositoryId", "status");
CREATE UNIQUE INDEX "PullRequest_repositoryId_number_key" ON "PullRequest"("repositoryId", "number");

CREATE INDEX "ReviewRun_pullRequestId_status_idx" ON "ReviewRun"("pullRequestId", "status");
CREATE INDEX "ReviewRun_githubDeliveryId_idx" ON "ReviewRun"("githubDeliveryId");
CREATE INDEX "ReviewRun_createdAt_idx" ON "ReviewRun"("createdAt");

CREATE UNIQUE INDEX "WebhookDelivery_deliveryId_key" ON "WebhookDelivery"("deliveryId");
CREATE INDEX "WebhookDelivery_eventName_action_idx" ON "WebhookDelivery"("eventName", "action");
CREATE INDEX "WebhookDelivery_processedAt_idx" ON "WebhookDelivery"("processedAt");

CREATE INDEX "Finding_reviewRunId_status_idx" ON "Finding"("reviewRunId", "status");
CREATE INDEX "Finding_filePath_idx" ON "Finding"("filePath");
CREATE UNIQUE INDEX "Finding_reviewRunId_dedupeKey_key" ON "Finding"("reviewRunId", "dedupeKey");

CREATE INDEX "ModelCall_reviewRunId_idx" ON "ModelCall"("reviewRunId");
CREATE INDEX "ModelCall_modelName_promptVersion_idx" ON "ModelCall"("modelName", "promptVersion");

CREATE INDEX "FeedbackEvent_reviewRunId_type_idx" ON "FeedbackEvent"("reviewRunId", "type");
CREATE INDEX "FeedbackEvent_findingId_idx" ON "FeedbackEvent"("findingId");

ALTER TABLE "PullRequest"
  ADD CONSTRAINT "PullRequest_repositoryId_fkey"
  FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ReviewRun"
  ADD CONSTRAINT "ReviewRun_pullRequestId_fkey"
  FOREIGN KEY ("pullRequestId") REFERENCES "PullRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Finding"
  ADD CONSTRAINT "Finding_reviewRunId_fkey"
  FOREIGN KEY ("reviewRunId") REFERENCES "ReviewRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ModelCall"
  ADD CONSTRAINT "ModelCall_reviewRunId_fkey"
  FOREIGN KEY ("reviewRunId") REFERENCES "ReviewRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FeedbackEvent"
  ADD CONSTRAINT "FeedbackEvent_reviewRunId_fkey"
  FOREIGN KEY ("reviewRunId") REFERENCES "ReviewRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FeedbackEvent"
  ADD CONSTRAINT "FeedbackEvent_findingId_fkey"
  FOREIGN KEY ("findingId") REFERENCES "Finding"("id") ON DELETE SET NULL ON UPDATE CASCADE;
