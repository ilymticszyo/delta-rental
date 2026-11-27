-- CreateTable
CREATE TABLE "Meta" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,

    CONSTRAINT "Meta_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "User" (
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "ownerId" TEXT,

    CONSTRAINT "User_pkey" PRIMARY KEY ("username")
);

-- CreateTable
CREATE TABLE "Owner" (
    "id" TEXT NOT NULL,
    "contact" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "userId" TEXT,

    CONSTRAINT "Owner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Renter" (
    "contactKey" TEXT NOT NULL,
    "contact" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "tag" TEXT,
    "note" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "Renter_pkey" PRIMARY KEY ("contactKey")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "accountNo" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "ownerId" TEXT,
    "formerOwnerId" TEXT,
    "deleted" BOOLEAN NOT NULL DEFAULT false,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "orderNo" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payable" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "orderId" TEXT,
    "accountId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Recycle" (
    "id" TEXT NOT NULL,
    "requestNo" TEXT NOT NULL,
    "submitter" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "sourceAccountId" TEXT,
    "ownerId" TEXT,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Recycle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Audit" (
    "seq" INTEGER NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "summary" TEXT NOT NULL,

    CONSTRAINT "Audit_pkey" PRIMARY KEY ("seq")
);

-- CreateTable
CREATE TABLE "Upload" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "relPath" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "uploadedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Upload_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Owner_contact_idx" ON "Owner"("contact");

-- CreateIndex
CREATE UNIQUE INDEX "Account_accountNo_key" ON "Account"("accountNo");

-- CreateIndex
CREATE INDEX "Account_status_idx" ON "Account"("status");

-- CreateIndex
CREATE INDEX "Account_ownerId_idx" ON "Account"("ownerId");

-- CreateIndex
CREATE INDEX "Account_deleted_idx" ON "Account"("deleted");

-- CreateIndex
CREATE UNIQUE INDEX "Order_orderNo_key" ON "Order"("orderNo");

-- CreateIndex
CREATE INDEX "Order_accountId_idx" ON "Order"("accountId");

-- CreateIndex
CREATE INDEX "Order_status_idx" ON "Order"("status");

-- CreateIndex
CREATE INDEX "Payable_ownerId_idx" ON "Payable"("ownerId");

-- CreateIndex
CREATE INDEX "Payable_orderId_idx" ON "Payable"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "Recycle_requestNo_key" ON "Recycle"("requestNo");

-- CreateIndex
CREATE INDEX "Recycle_submitter_idx" ON "Recycle"("submitter");

-- CreateIndex
CREATE INDEX "Recycle_status_idx" ON "Recycle"("status");

