-- Origem dos leads: busca as visitas anteriores do mesmo navegador (client_id).
-- Aditiva e idempotente: só cria um índice.
CREATE INDEX IF NOT EXISTS "TrackingEvent_workspaceId_clientId_eventTime_idx" ON "TrackingEvent"("workspaceId", "clientId", "eventTime");
