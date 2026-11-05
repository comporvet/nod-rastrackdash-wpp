-- SimplesVet (plataforma de venda na URL única): só valores de enum.
-- IMPORTANTE: nenhuma linha que use 'simplesvet' entra nesta mesma migration.
-- O PostgreSQL não deixa usar um valor de enum recém-criado antes do commit,
-- e o Prisma envolve cada migration numa transação (ADD VALUE + INSERT = P3009).
-- Aditiva e idempotente (IF NOT EXISTS).
ALTER TYPE "InboundWebhookProvider" ADD VALUE IF NOT EXISTS 'simplesvet';
ALTER TYPE "DiagnosticSource" ADD VALUE IF NOT EXISTS 'simplesvet';
