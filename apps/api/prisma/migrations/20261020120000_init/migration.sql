CREATE TYPE "BudgetStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'REVIEWED', 'APPROVED', 'RETURNED');

CREATE TYPE "AccessRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED');

CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "keycloakId" TEXT NOT NULL,
    "activeOrganizationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "User_keycloakId_key" ON "User"("keycloakId");

CREATE TABLE "BudgetDocument" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "fiscalYear" INTEGER NOT NULL,
    "status" "BudgetStatus" NOT NULL DEFAULT 'DRAFT',
    "creatorId" TEXT NOT NULL,
    "creatorKeycloakId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BudgetDocument_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BudgetDocument_organizationId_status_idx" ON "BudgetDocument"("organizationId", "status");

CREATE TABLE "BudgetLine" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    CONSTRAINT "BudgetLine_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BudgetWorkflowHistory" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "fromStatus" "BudgetStatus",
    "toStatus" "BudgetStatus" NOT NULL,
    "actorKeycloakId" TEXT NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BudgetWorkflowHistory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AccessRequest" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "positionGroupId" TEXT NOT NULL,
    "targetKeycloakId" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "riskLevel" TEXT NOT NULL,
    "status" "AccessRequestStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3),
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AccessRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AccessRequest_targetKeycloakId_positionGroupId_status_idx" ON "AccessRequest"("targetKeycloakId", "positionGroupId", "status");
CREATE INDEX "AccessRequest_organizationId_status_idx" ON "AccessRequest"("organizationId", "status");

CREATE TABLE "AccessApproval" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "approverId" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AccessApproval_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "actorKeycloakId" TEXT,
    "organizationId" TEXT,
    "action" TEXT NOT NULL,
    "permission" TEXT,
    "resourceType" TEXT,
    "resourceId" TEXT,
    "decision" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AuditEvent_actorKeycloakId_createdAt_idx" ON "AuditEvent"("actorKeycloakId", "createdAt");

ALTER TABLE "BudgetDocument" ADD CONSTRAINT "BudgetDocument_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BudgetLine" ADD CONSTRAINT "BudgetLine_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "BudgetDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BudgetWorkflowHistory" ADD CONSTRAINT "BudgetWorkflowHistory_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "BudgetDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AccessRequest" ADD CONSTRAINT "AccessRequest_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AccessApproval" ADD CONSTRAINT "AccessApproval_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "AccessRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AccessApproval" ADD CONSTRAINT "AccessApproval_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
