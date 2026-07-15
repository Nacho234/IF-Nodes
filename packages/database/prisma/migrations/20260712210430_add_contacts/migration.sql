-- CreateTable
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "status" TEXT NOT NULL DEFAULT 'new',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notes" TEXT,
    "data" JSONB,
    "lastContactedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Contact_projectId_status_idx" ON "Contact"("projectId", "status");

-- CreateIndex
CREATE INDEX "Contact_projectId_updatedAt_idx" ON "Contact"("projectId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Contact_projectId_phone_key" ON "Contact"("projectId", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "Contact_projectId_email_key" ON "Contact"("projectId", "email");

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
