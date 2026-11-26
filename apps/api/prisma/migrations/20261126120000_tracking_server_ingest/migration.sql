-- Recepção de eventos do GTM Server-Side. Aditiva e idempotente: só cria
-- tabelas, índices e chaves novas; nada existente é alterado.
CREATE TABLE IF NOT EXISTS "TrackingIngestConnection" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "secretHash" TEXT NOT NULL,
    "allowedEvents" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'active',
    "lastReceivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrackingIngestConnection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "TrackingEvent" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "schemaVersion" TEXT NOT NULL,
    "eventName" TEXT NOT NULL,
    "eventId" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "dedupeConfidence" TEXT NOT NULL,
    "eventTime" TIMESTAMP(3) NOT NULL,
    "firstReceivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "environment" TEXT NOT NULL,
    "hostname" TEXT,
    "pagePath" TEXT,
    "pageLocation" TEXT,
    "pageReferrerHost" TEXT,
    "clientId" TEXT,
    "sessionId" TEXT,
    "modalidade" TEXT,
    "origem" TEXT,
    "attribution" JSONB NOT NULL DEFAULT '{}',
    "consent" JSONB NOT NULL DEFAULT '{}',
    "properties" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "TrackingEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "TrackingEventReceipt" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "trackingEventId" TEXT NOT NULL,
    "transportSource" TEXT NOT NULL,
    "receiptKey" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "latencyMs" INTEGER,
    "duplicate" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "TrackingEventReceipt_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "TrackingIngestRejection" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT,
    "reason" TEXT NOT NULL,
    "eventName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrackingIngestRejection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "TrackingIngestConnection_workspaceId_key" ON "TrackingIngestConnection"("workspaceId");
CREATE INDEX IF NOT EXISTS "TrackingEvent_workspaceId_eventTime_idx" ON "TrackingEvent"("workspaceId", "eventTime");
CREATE INDEX IF NOT EXISTS "TrackingEvent_workspaceId_environment_eventName_eventTime_idx" ON "TrackingEvent"("workspaceId", "environment", "eventName", "eventTime");
CREATE UNIQUE INDEX IF NOT EXISTS "TrackingEvent_workspaceId_dedupeKey_key" ON "TrackingEvent"("workspaceId", "dedupeKey");
CREATE INDEX IF NOT EXISTS "TrackingEventReceipt_workspaceId_receivedAt_idx" ON "TrackingEventReceipt"("workspaceId", "receivedAt");
CREATE UNIQUE INDEX IF NOT EXISTS "TrackingEventReceipt_trackingEventId_transportSource_receip_key" ON "TrackingEventReceipt"("trackingEventId", "transportSource", "receiptKey");
CREATE INDEX IF NOT EXISTS "TrackingIngestRejection_workspaceId_createdAt_idx" ON "TrackingIngestRejection"("workspaceId", "createdAt");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TrackingIngestConnection_workspaceId_fkey') THEN
    ALTER TABLE "TrackingIngestConnection" ADD CONSTRAINT "TrackingIngestConnection_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TrackingEvent_workspaceId_fkey') THEN
    ALTER TABLE "TrackingEvent" ADD CONSTRAINT "TrackingEvent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TrackingEventReceipt_workspaceId_fkey') THEN
    ALTER TABLE "TrackingEventReceipt" ADD CONSTRAINT "TrackingEventReceipt_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TrackingEventReceipt_trackingEventId_fkey') THEN
    ALTER TABLE "TrackingEventReceipt" ADD CONSTRAINT "TrackingEventReceipt_trackingEventId_fkey" FOREIGN KEY ("trackingEventId") REFERENCES "TrackingEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TrackingIngestRejection_workspaceId_fkey') THEN
    ALTER TABLE "TrackingIngestRejection" ADD CONSTRAINT "TrackingIngestRejection_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
