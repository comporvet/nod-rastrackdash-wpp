-- Cliques no link (inline_link_clicks) da Meta por campanha e dia, para o funil
-- de aquisição. Aditiva e idempotente: coluna nova com padrão 0; a próxima
-- sincronização preenche o período sincronizado.
ALTER TABLE "MetaCampaignDailyInsight" ADD COLUMN IF NOT EXISTS "linkClicks" INTEGER NOT NULL DEFAULT 0;
