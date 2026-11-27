-- AlterTable
ALTER TABLE "Upload" ADD COLUMN "accountId" TEXT;

-- CreateIndex
CREATE INDEX "Upload_uploadedBy_idx" ON "Upload"("uploadedBy");

-- CreateIndex
CREATE INDEX "Upload_accountId_idx" ON "Upload"("accountId");

-- CreateTable
CREATE TABLE "Session" (
    "tokenHash" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "absoluteExpiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("tokenHash")
);

-- CreateIndex
CREATE INDEX "Session_username_idx" ON "Session"("username");

-- CreateTable
CREATE TABLE "IdempotencyRecord" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "bodyHash" TEXT NOT NULL,
    "statusCode" INTEGER NOT NULL,
    "body" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IdempotencyRecord_createdAt_idx" ON "IdempotencyRecord"("createdAt");
