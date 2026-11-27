# RastrackDash 2.0 — Auditoria e roteiro (Comporvet)

Data: 26/11/2026. Base: branch `feat/simplesvet-provider`, produção em `5bd99ca` mais esta entrega.

Este documento confronta a especificação `RASTRACKDASH_2.0_ESPECIFICACAO_TECNICA.md` com o código, registra o que foi entregue nas Fases 1 e 2 e organiza as Fases 3 a 8.

## Legenda de estado

- **Implementado:** código no repositório.
- **Testado:** coberto por testes automatizados.
- **Homologado:** validado com a plataforma real.
- **Aguardando credenciais:** depende de acesso que ainda não existe.
- **Em produção:** publicado na VPS.

## 1. Estado atual do projeto

| Área | Situação | Evidência |
|---|---|---|
| Stack | API NestJS (Express) + Prisma/PostgreSQL + BullMQ/Redis; web Next.js 15 / React 19; Docker Swarm | `apps/api/src/main.ts`, `apps/api/src/common/queue/queue.module.ts` |
| Origem do projeto | Template de aluno PalmUP (`nod-rastrackdash-wpp`), com licença que bloqueia escritas com 423 | `apps/api/src/licensing-client/license-softlock.guard.ts` |
| Recepção de webhooks | URLs por conexão com token (hash SHA-256), payload cifrado, fila BullMQ, idempotência por `ingressKey` | `apps/api/src/inbound-webhooks/inbound-webhook-ingestion.service.ts` |
| Leads | Criados a partir de mensagens WhatsApp **com `ctwa_clid`** (anúncio Click-to-WhatsApp) | `apps/api/src/webhooks/webhooks.controller.ts:668`, `:1034`; `apps/api/src/leads/leads.service.ts:1015` |
| Atribuição de lead | `campaignId`, `adSetId`, `adId`, `ctwaClid`; sem UTM, gclid nem fbclid | `apps/api/prisma/schema.prisma` (model `Lead`) |
| Meta CAPI | `action_source: business_messaging`, exige `ctwa_clid`, `event_id` determinístico | `apps/api/src/conversion-events/meta-capi-payload.builder.ts` |
| Purchase | Vendas do SimplesVet via n8n (`sale.paid`), com deduplicação por `ProviderPurchaseClaim` | `apps/api/src/inbound-webhooks/providers/simplesvet/simplesvet-automation-v1.parser.ts` |
| GA4 | Somente leitura pela Data API e Admin API (tela Site e LPs) | `apps/api/src/google-analytics/` |
| Google Ads | Nenhuma integração | busca por `gclid`, `googleads`, `uploadClickConversions` sem resultado |
| Eventos de catálogo | LeadSubmitted, QualifiedLead, Purchase e eventos de pedido; **sem `Schedule`** | `packages/shared/src/schemas/conversion-events.ts` |
| Consulta / agendamento | Não existe entidade | — |
| WhatsApp da Comporvet | UAZAPI (não a Cloud API oficial) | workflows n8n da instalação |

## 2. Divergências entre a especificação e o código

1. **"O RastrackDash recebe eventos do GTM Web"** (§3, §6): **falso**. Não havia endpoint de coleta, visitante, sessão nem UTM. Não há recepção Web a preservar. A Fase 2 criou a recepção pelo GTM Server-Side, e só por ele, por decisão do responsável.
2. **Token de atribuição no WhatsApp** (§17): um lead só nasce quando a mensagem traz `ctwa_clid`. Uma conversa iniciada pelo site ou pela LP, sem anúncio CTWA, **não cria lead** hoje. O token `CV-XXXXXX` exige um caminho novo de criação de lead para mensagens orgânicas, no núcleo de webhooks da PalmUP. Isso gera custo de merge a cada atualização do template.
3. **Funil comercial** (§20): não há consulta, agendamento nem pagamento como entidades. O único fato comercial com valor é o `Purchase` do SimplesVet, com valor estimado.
4. **Meta CAPI comercial** (§16): o envio atual é `business_messaging` e depende de `ctwa_clid`. Clientes vindos do site ou do Google não têm esse identificador. Um fluxo `website` ou `system_generated` para eles é novo.
5. **WhatsApp Business Cloud API** (§4, §17.3): a Comporvet usa UAZAPI. Os dados de `referral` da Cloud API só existem se o número migrar.
6. **`.env` com IDs fixos** (§28): o projeto guarda configuração por workspace no banco, não em variáveis. Os IDs do GA4 já ficam na conexão GA4.

## 3. Entregue nas Fases 1 e 2

| Item | Estado |
|---|---|
| Endpoint `POST /tracking/server/v1/events` (token, janela de 5 min, 32 KB, 600/min, flag `TRACKING_INGEST_ENABLED`) | Implementado, testado |
| Tabelas `TrackingIngestConnection`, `TrackingEvent`, `TrackingEventReceipt`, `TrackingIngestRejection` (migration aditiva `20261126120000_tracking_server_ingest`) | Implementado, testado (PGlite) |
| Deduplicação por `event_id`, chave derivada marcada quando falta, proteção a concorrência por índice único | Implementado, testado |
| Classificação `site` / `lp_online` / `lp_presencial` / `unknown` com as regras da conexão GA4 | Implementado, testado |
| URL reduzida a parâmetros de atribuição permitidos; sem IP, user agent ou PII | Implementado, testado |
| Tela Tracking Monitor (`/analytics/tracking`) com token, eventos permitidos e pausa | Implementado |
| Template `04 - [RASTRACKDASH] Enviar Eventos` e guia | Implementado; **homologação pendente** no Preview do sGTM |
| Ponte WhatsApp (Fase 3, parte): tag do GTM Web com `_Atendimento: CV-XXXXXX_`, ligação da mensagem da API oficial (`meta_cloud`) ao clique e Lead de site à Meta com telefone (hash), fbp, fbc, IP e user agent (migration `20261126130000_tracking_whatsapp_ref`) | Implementado, testado; **homologação pendente** (tag Web, sGTM e teste com código de teste da Meta) |
| Em produção | **Não**: aguarda deploy e o teste controlado |

Decisões:

- **Token Bearer em vez de HMAC.** O `hmacSha256` do sGTM exige configurar `SGTM_CREDENTIALS` no contêiner do servidor, uma mudança de infraestrutura fora do escopo.
- **Processamento síncrono.** O volume é de dezenas de eventos por dia e não justifica fila.
- **Sem tabela de entregas.** O RastrackDash não retransmite eventos Web; as entregas comerciais pertencem à Fase 6.
- **Código num módulo próprio** (`apps/api/src/tracking/`), fora do núcleo PalmUP.

## 4. Roteiro das próximas fases

| Fase | Conteúdo | Depende de | Impacto no núcleo PalmUP |
|---|---|---|---|
| 3 — Atribuição | Feito: código `_Atendimento: CV-XXXXXX_`, Lead de site pela API oficial e tela Origem dos leads (pago Google/Meta × orgânico, primeiro contato por `client_id` em 90 dias, último clique não direto). Falta: criar o lead do CRM para conversas sem `ctwa_clid` e levar a origem aos relatórios de Visão geral | Decisão sobre o texto pré-preenchido; caminho de lead sem `ctwa_clid` | **Alto**: criação de lead nos receptores de webhook |
| 4 — APIs de marketing | Google Ads API (campanhas, custos, conversões), sincronização incremental | Customer ID confirmado pela API, developer token, OAuth | Baixo (módulo próprio) |
| 5 — Funil comercial | Entidades de consulta (agendada, paga, realizada, cancelada, no-show, reembolsada); webhooks do n8n | Fonte do agendamento e da realização (IVet? SimplesVet?) | Médio |
| 6 — Conversões | Data Manager API (offline e Enhanced Conversions for Leads); Meta CAPI comercial (`Schedule`, `Purchase` por consulta) com outbox | Acesso à Data Manager API, ações `[COMPORVET][OFFLINE]`, WABA ID se houver CAPI de mensagens | Médio: catálogo de eventos compartilhado |
| 7 — Dashboard | Central de Conversões, funil completo, CAC e ROAS por consulta, análise de rolagem por sessão | Fases 3 a 6 | Baixo |
| 8 — Homologação | Testes de ponta a ponta, checklist de publicação | Todas | — |

Credenciais e dados pendentes:

- Google Ads: Customer ID confirmado pela API, developer token, OAuth, label da conversão da LP Online.
- Data Manager API: acesso habilitado e destino.
- Meta: ID da conta de anúncios (já sincronizada pelo módulo Meta existente) e WABA ID, se houver migração para a Cloud API.

Pendências de produto:

- Retenção de `TrackingEvent`.
- Rate limit distribuído (hoje é por processo).
- Análise de rolagem por sessão (Fase 7).

## 5. Riscos e rollback das Fases 1 e 2

| Risco | Mitigação |
|---|---|
| Tag do sGTM falhar e afetar outras tags | Tempo limite de 2 s; a falha só marca a própria tag |
| Eventos sem `event_id` | Chave derivada exata, marcada no monitor; o guia explica como expor o `event_id` |
| Duplicação por reenvio | Índice único por `dedupeKey` e por recibo |
| Vazamento de PII pela URL | Lista de permissão de parâmetros; `link_url` sem query |
| Licença bloqueada | A rota recebe 423, como os demais webhooks; as tags do sGTM não são afetadas |

Rollback:

1. Desligue `TRACKING_INGEST_ENABLED`, ou pause a conexão na tela.
2. Se necessário, volte às imagens anteriores da API e do web.
3. As tabelas novas podem permanecer; nada mais depende delas.
