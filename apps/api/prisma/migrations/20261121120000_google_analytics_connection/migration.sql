-- GA4 por workspace (somente leitura). Aditiva: só cria a tabela nova.
CREATE TABLE "GoogleAnalyticsConnection" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "serviceAccountEmail" TEXT NOT NULL,
    "credentialEncrypted" TEXT NOT NULL,
    "credentialIv" TEXT NOT NULL,
    "credentialTag" TEXT NOT NULL,
    "environments" JSONB NOT NULL,
    "expectedMeasurementIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lastValidatedAt" TIMESTAMP(3),
    "lastErrorKind" TEXT,
    "lastErrorMessage" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoogleAnalyticsConnection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GoogleAnalyticsConnection_workspaceId_key" ON "GoogleAnalyticsConnection"("workspaceId");

ALTER TABLE "GoogleAnalyticsConnection" ADD CONSTRAINT "GoogleAnalyticsConnection_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
