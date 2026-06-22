DO $$
BEGIN
  ALTER TYPE "ReviewRunStatus" ADD VALUE 'SKIPPED';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "ReviewRun" ADD COLUMN IF NOT EXISTS "errorMessage" TEXT;

CREATE TABLE IF NOT EXISTS "ValidatorDecision" (
  "id" TEXT NOT NULL,
  "reviewRunId" TEXT NOT NULL,
  "findingId" TEXT,
  "findingTitle" TEXT NOT NULL,
  "decision" TEXT NOT NULL,
  "valid" BOOLEAN,
  "shouldPost" BOOLEAN,
  "confidence" DECIMAL(5, 4),
  "falsePositiveRisk" TEXT,
  "reason" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ValidatorDecision_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ValidatorDecision_reviewRunId_fkey"
    FOREIGN KEY ("reviewRunId") REFERENCES "ReviewRun"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ValidatorDecision_findingId_fkey"
    FOREIGN KEY ("findingId") REFERENCES "Finding"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "ReviewRun_status_createdAt_idx" ON "ReviewRun"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "Finding_status_createdAt_idx" ON "Finding"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "ModelCall_reviewRunId_createdAt_idx" ON "ModelCall"("reviewRunId", "createdAt");
CREATE INDEX IF NOT EXISTS "ValidatorDecision_reviewRunId_decision_idx" ON "ValidatorDecision"("reviewRunId", "decision");
CREATE INDEX IF NOT EXISTS "ValidatorDecision_findingId_idx" ON "ValidatorDecision"("findingId");
CREATE INDEX IF NOT EXISTS "ValidatorDecision_createdAt_idx" ON "ValidatorDecision"("createdAt");
