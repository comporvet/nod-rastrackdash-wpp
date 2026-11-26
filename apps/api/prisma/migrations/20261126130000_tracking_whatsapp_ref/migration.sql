-- Token de referência do clique no WhatsApp e Lead de site à Meta. Aditiva e
-- idempotente: colunas opcionais e uma tabela nova.
ALTER TABLE "TrackingIngestConnection" ADD COLUMN IF NOT EXISTS "metaLeadEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "TrackingIngestConnection" ADD COLUMN IF NOT EXISTS "metaPixelId" TEXT;
ALTER TABLE "TrackingIngestConnection" ADD COLUMN IF NOT EXISTS "metaTestEventCode" TEXT;

ALTER TABLE "TrackingEvent" ADD COLUMN IF NOT EXISTS "refToken" TEXT;
ALTER TABLE "TrackingEvent" ADD COLUMN IF NOT EXISTS "ipAddress" TEXT;
ALTER TABLE "TrackingEvent" ADD COLUMN IF NOT EXISTS "userAgent" TEXT;

CREATE TABLE IF NOT EXISTS "TrackingContactMatch" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "refToken" TEXT NOT NULL,
    "trackingEventId" TEXT,
    "externalMessageId" TEXT NOT NULL,
    "channelPhone" TEXT,
    "phoneHashes" TEXT[],
    "contactName" TEXT,
    "messageAt" TIMESTAMP(3) NOT NULL,
    "metaStatus" TEXT NOT NULL DEFAULT 'pending',
    "metaEventId" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "responseSummary" JSONB,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrackingContactMatch_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "TrackingContactMatch_metaStatus_nextAttemptAt_idx" ON "TrackingContactMatch"("metaStatus", "nextAttemptAt");
CREATE UNIQUE INDEX IF NOT EXISTS "TrackingContactMatch_workspaceId_refToken_key" ON "TrackingContactMatch"("workspaceId", "refToken");
CREATE UNIQUE INDEX IF NOT EXISTS "TrackingContactMatch_workspaceId_externalMessageId_key" ON "TrackingContactMatch"("workspaceId", "externalMessageId");
CREATE INDEX IF NOT EXISTS "TrackingEvent_workspaceId_refToken_idx" ON "TrackingEvent"("workspaceId", "refToken");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TrackingContactMatch_workspaceId_fkey') THEN
    ALTER TABLE "TrackingContactMatch" ADD CONSTRAINT "TrackingContactMatch_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TrackingContactMatch_trackingEventId_fkey') THEN
    ALTER TABLE "TrackingContactMatch" ADD CONSTRAINT "TrackingContactMatch_trackingEventId_fkey" FOREIGN KEY ("trackingEventId") REFERENCES "TrackingEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
