# Google Analytics 4 (Site e LPs)

Tela **Site e LPs** (`/analytics`): tráfego, engajamento, rolagem e progressão até o WhatsApp lidos do GA4 pela Google Analytics Data API, separados por ambiente pela URL da página. Somente leitura: nada é alterado no GA4 nem no GTM.

## O que é preciso

- Um projeto no Google Cloud com a **Google Analytics Data API** e a **Google Analytics Admin API** ativadas.
- Uma **conta de serviço** com chave JSON.
- O e-mail dessa conta adicionado como **Leitor** na propriedade GA4 (Administrador → Gerenciamento de acesso à propriedade). Criar a conta no Cloud não dá acesso aos dados.
- O **ID numérico da propriedade** (Administrador → Detalhes da propriedade). Os `G-...` são IDs de medição dos fluxos, não servem aqui.
- A API com `INBOUND_WEBHOOKS_ENABLED=true` e `INBOUND_WEBHOOK_ENCRYPTION_KEY` preenchida. A chave JSON fica cifrada com essa chave (AES-256-GCM, contexto próprio amarrado ao workspace). **Não há variável nova.** Não troque essa chave numa instalação no ar: a chave do GA4 salva deixaria de ser lida e precisaria ser enviada de novo.

## Configurar

1. Abra **Site e LPs → Configurar GA4** (precisa da permissão de gerenciar integrações).
2. Preencha o ID numérico da propriedade, cole a chave JSON e, se quiser conferir, os IDs de medição esperados (ex.: `G-XM10SRKV8D, G-D3GRCTSMNW`).
3. Revise os **ambientes**. O padrão traz os três da Comporvet:

   | Chave | Host (RE2) | Caminho (RE2) |
   |---|---|---|
   | `site` | `^(www\.)?comporvet\.com\.br$` | qualquer |
   | `lp_online` | `^consultas\.comporvet\.com\.br$` | `^/(online/?)?$` |
   | `lp_presencial` | `^consultas\.comporvet\.com\.br$` | `^/presencial/?$` |

   As regras ficam num lugar só e são aplicadas em todas as consultas pela dimensão `hostName` e `pagePath` (sem query string). O número do WhatsApp nunca é usado para identificar o ambiente.
4. **Salvar e testar** roda a descoberta: propriedades que a conta enxerga, fuso e moeda da propriedade, fluxos com ID numérico e ID de medição, e se `customEvent:scroll_percent` e `customEvent:modalidade` existem nos metadados.

A chave nunca volta para o painel. Para trocar, cole uma nova; deixar vazio mantém a atual.

## O que a tela mostra

| Bloco | Fonte e regra |
|---|---|
| Cards e comparação | `totalUsers`, `activeUsers`, `sessions`, `screenPageViews`, `engagementRate` e engajamento médio por sessão (`userEngagementDuration` / `sessions`); eventos e usuários de `click_whatsapp`. Variação contra o período anterior de mesmo tamanho. Exporta CSV. |
| Série diária | Visualizações e eventos `click_whatsapp` por dia. |
| Funis | `runFunnelReport` (v1alpha): funil fechado, etapa 1 `page_view`, etapa 2 `click_whatsapp` com `isDirectlyFollowedBy: false`, filtro no parâmetro `page_location` nas duas etapas (montado a partir do host e do caminho do ambiente, porque o funil não aceita `hostName` nem `pagePath`), detalhado por `deviceCategory`. Progressão = etapa 2 / etapa 1 × 100. |
| Rolagem | `scroll_depth` com `customEvent:scroll_percent` nos marcos 10, 25, 50, 75, 90 e 100: usuários distintos que alcançaram **pelo menos** cada marco (uma consulta sem a dimensão de página, para não somar a mesma pessoa duas vezes) e a tabela por página. Não é ponto de abandono. |
| Aquisição | `sessionSourceMedium`, `sessionDefaultChannelGroup`, `sessionCampaignName` e `deviceCategory`. |

Filtros globais: período, comparação, ambiente, dispositivo, origem/mídia e campanha (valor exato). Sessões de teste (origem `tagassistant.google.com`, do preview do GTM/Tag Assistant, e `eventsmanager.facebook.com`, do teste de eventos da Meta) ficam fora de todos os números, funis inclusive, a não ser que **Incluir sessões de teste** esteja marcado; a tela diz qual dos dois está valendo. Cada funil mostra a fonte: `runFunnelReport` ou a aproximação. **Atualizar agora** ignora o cache de 10 minutos. No máximo 4 consultas simultâneas por propriedade, abaixo do limite de 10 da Data API.

Cada bloco mostra o próprio estado: Conectado, Sem autorização, Configuração incompleta, Sem dados para o período, Cota da API esgotada, Erro temporário de API. Falha nunca aparece como zero.

Se o `runFunnelReport` estiver indisponível, o funil cai para a razão simples entre usuários com `page_view` e com `click_whatsapp`, marcada como **aproximação, não sequencial**.

## Limites conhecidos

- O GA4 pode levar até 48 horas para processar dados; o dia corrente costuma vir incompleto.
- Dimensões personalizadas não recuperam dados anteriores ao registro.
- Os números dos testes de configuração (18/1, 12/3, 1/1) são referência de teste, não meta.
- `click_whatsapp` é interesse em contato, não mensagem enviada nem consulta agendada. Não some com o `Contact` do Pixel nem com conversões atribuídas pela Meta.
- Meta Ads continua em **Relatórios** (integração existente). Google Ads, auditoria do GTM e dados comerciais (IVet, n8n) ainda não estão ligados.

## Problemas comuns

- **Sem autorização**: o e-mail da conta de serviço não é Leitor da propriedade, ou a Data API não foi ativada no projeto.
- **Consulta recusada pela API** ao salvar com `G-...`: use o ID numérico.
- **Configuração incompleta** na rolagem: `customEvent:scroll_percent` não está registrada como dimensão personalizada de evento na propriedade consultada.
- "Não foi possível ler a chave salva": a `INBOUND_WEBHOOK_ENCRYPTION_KEY` mudou. Cole a chave JSON de novo.
