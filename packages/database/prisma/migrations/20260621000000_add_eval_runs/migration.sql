CREATE TABLE "EvalRun" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "modelVersion" TEXT NOT NULL,
  "promptVersion" TEXT NOT NULL,
  "precision" DECIMAL(5, 4) NOT NULL,
  "recall" DECIMAL(5, 4) NOT NULL,
  "falsePositiveCount" INTEGER NOT NULL DEFAULT 0,
  "falseNegativeCount" INTEGER NOT NULL DEFAULT 0,
  "costUsd" DECIMAL(12, 6) NOT NULL DEFAULT 0,
  "caseCount" INTEGER NOT NULL,
  "latencyMs" INTEGER NOT NULL DEFAULT 0,
  "passed" BOOLEAN NOT NULL DEFAULT false,
  "truePositiveCount" INTEGER NOT NULL DEFAULT 0,
  "validatorRejectionRate" DECIMAL(5, 4) NOT NULL DEFAULT 0,
  "findingsPerPr" DECIMAL(8, 4) NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "EvalRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EvalRun_createdAt_idx" ON "EvalRun"("createdAt");
CREATE INDEX "EvalRun_modelVersion_promptVersion_idx" ON "EvalRun"("modelVersion", "promptVersion");
