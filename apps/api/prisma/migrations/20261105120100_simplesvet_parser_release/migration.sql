-- Leitor do SimplesVet (simplesvet/automation-v1), CERTIFICADO. O contrato é
-- próprio: quem envia é o workflow n8n da instalação, não uma plataforma externa.
-- As travas reais continuam valendo (licença utilizável, rota Meta válida e
-- lead com ctwa_clid). Idempotente: release retirada continua retirada.
INSERT INTO "InboundWebhookParserRelease" (
  "id",
  "provider",
  "version",
  "status",
  "certifiedAt",
  "createdAt",
  "updatedAt"
) VALUES (
  'inbound_parser_simplesvet_automation_v1',
  'simplesvet',
  'automation-v1',
  'certified',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("provider", "version") DO UPDATE
SET
  "status" = 'certified',
  "certifiedAt" = COALESCE("InboundWebhookParserRelease"."certifiedAt", CURRENT_TIMESTAMP),
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "InboundWebhookParserRelease"."status" = 'observation_only';
