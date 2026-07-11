-- Agrega el token público de webhook con backfill para filas existentes
ALTER TABLE "Workflow" ADD COLUMN "webhookToken" TEXT;
UPDATE "Workflow" SET "webhookToken" = 'whk_' || md5(random()::text || clock_timestamp()::text) WHERE "webhookToken" IS NULL;
ALTER TABLE "Workflow" ALTER COLUMN "webhookToken" SET NOT NULL;
CREATE UNIQUE INDEX "Workflow_webhookToken_key" ON "Workflow"("webhookToken");
