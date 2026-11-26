# Recepção do GTM Server-Side (Tracking Monitor)

O contêiner GTM Server-Side envia ao RastrackDash uma cópia dos eventos monitorados. O RastrackDash grava cada interação uma única vez, classifica o ambiente (site, LP Online, LP Presencial) e mostra na tela **Site e LPs → Tracking Monitor** o que chegou, o que foi recusado e a qualidade dos identificadores.

O RastrackDash só recebe. Ele não reenvia nada ao GA4, ao Google Ads nem à Meta: essas entregas continuam com as tags atuais do sGTM.

## Fluxo

```text
Site / LP -> GTM Web -> GTM Server-Side -> GA4, Google Ads, Meta CAPI (tags atuais)
                                        -> RastrackDash (tag 04, nova)
```

O RastrackDash lê o evento do cliente GA4 antes das transformações da Meta. Por isso `click_whatsapp` chega com esse nome, e não como `Contact`.

## 1. Ligar a recepção na API

1. Defina `TRACKING_INGEST_ENABLED=true` nas variáveis da API e faça o redeploy. Antes disso, a rota responde 404.
2. Abra **Site e LPs → Tracking Monitor** e clique em **Gerar token da recepção** (precisa da permissão de gerenciar integrações).
3. Copie o **ID da conexão** e o **token** na hora: o token não aparece de novo. Gerar outro invalida o anterior.

## 2. Configurar o contêiner de servidor

Faça tudo num **workspace novo** do contêiner `[SERVER] - GTM Server-Side` e **não publique** antes de testar.

1. **Modelos → Modelos de tag → Novo → menu ⋮ → Importar** e escolha [`gtm-server-side/rastrackdash-tag.tpl`](gtm-server-side/rastrackdash-tag.tpl). Salve.
   - Em **Permissões → Envia solicitações HTTP**, confira se a URL bate com a sua API. O padrão é `https://rastrackdash-api.ivet.app.br/tracking/server/v1/events`.
2. **Variáveis → Nova → Constante**, nome `RastrackDash Token`, valor = o token copiado. Nunca coloque o token no contêiner Web.
3. **Acionadores → Novo → Personalizado**, nome `04 - [RASTRACKDASH] Eventos Monitorados`:
   - Alguns eventos: `Client Name` igual a `GA4`;
   - e `Event Name` corresponde à expressão regular `^(page_view|scroll_depth|click_whatsapp|click)$`.
4. **Tags → Nova**, tipo **RastrackDash - Enviar Eventos**, nome `04 - [RASTRACKDASH] Enviar Eventos`:
   - URL de recepção: a da sua API;
   - ID da conexão: o copiado na tela;
   - Token da recepção: `{{RastrackDash Token}}`;
   - Eventos enviados: `page_view,scroll_depth,click_whatsapp,click`;
   - Chave do event_id: `event_id` (veja a seção 3);
   - Acionador: `04 - [RASTRACKDASH] Eventos Monitorados`.

A tag responde em até 2 segundos e falha sozinha: uma queda do RastrackDash não afeta o GA4, o Google Ads nem a Meta.

## 3. Conferir o event_id

A deduplicação confiável depende de um `event_id` único por interação. No **Preview** do sGTM:

1. Abra a LP e clique no WhatsApp.
2. No evento `click_whatsapp`, aba **Event Data**, procure `event_id`.

- **Se existir**, nada a fazer.
- **Se não existir**, o RastrackDash usa uma chave derivada (evento, client_id, sessão, horário e página) e marca o evento como "derivada" no monitor. Para ter o `event_id`, no contêiner **Web** adicione à tag GA4 o parâmetro de evento `event_id` com a mesma variável que já alimenta a Meta (por exemplo `JS - Meta PageView Event ID` no page_view e a variável do Contact no clique). Essa mudança é opcional e fica a seu critério; ela não altera o que a Meta recebe.
- Se o nome do parâmetro for outro, informe-o em **Chave do event_id** e inclua o mesmo nome na permissão **Lê dados de evento** do modelo.

## 4. Testar uma vez

Com o Preview ligado:

1. Acesse uma vez o site, a LP Online e a LP Presencial, clicando uma vez no WhatsApp em cada.
2. No Preview, a tag `04 - [RASTRACKDASH]` deve aparecer como **Succeeded** nos eventos monitorados.
3. No Tracking Monitor: 3 `page_view` e 3 `click_whatsapp` únicos, cada um no ambiente certo, e 0 recebimentos duplicados.

Publicar o contêiner é uma decisão sua. Antes de publicar, confira que as tags 00 a 03 continuam como estavam.

## O que é gravado

| Campo | Origem | Observação |
|---|---|---|
| Evento, event_id, horário | Event Data | Horário em UTC; a tela mostra America/Sao_Paulo |
| URL da página | `page_location` | Só origem, caminho e `utm_*`, `gclid`, `gbraid`, `wbraid`, `dclid`, `fbclid`. O resto da query é descartado |
| Referenciador | `page_referrer` | Só o domínio |
| client_id, ga_session_id | Event Data | Identificadores pseudônimos do GA4 |
| modalidade, origem | Event Data | Quando a tag GA4 envia esses parâmetros |
| `_fbp`, `_fbc` | Cookies da requisição | Como recebidos, sem hash |
| Consentimento | `x-ga-gcs` | `ad_storage` e `analytics_storage`; o resto fica `unknown` |
| Rolagem e link | `percent_scrolled`, `link_url`, `link_domain`, `outbound` | `link_url` sem query (a mensagem do wa.me não é gravada) |

Não são gravados IP, user agent, telefone, e-mail nem o texto da mensagem do WhatsApp.

## Segurança

- Autenticação: cabeçalhos `X-Rastrack-Connection` e `Authorization: Bearer <token>`. O banco guarda só o SHA-256 do token. Qualquer falha responde o mesmo 404.
- `X-Rastrack-Timestamp` precisa estar a menos de 5 minutos do relógio da API. Somado à deduplicação, isso impede o reaproveitamento de uma requisição antiga.
- Corpo de até 32 KB, um evento por requisição, schema `1.0`. Até 600 requisições por minuto por conexão.
- Conexão pausada, flag desligada ou licença bloqueada (423) não afetam as outras tags.
- Por que não HMAC: o modelo de servidor do GTM até tem `hmacSha256`, mas a chave precisa estar num arquivo apontado pela variável `SGTM_CREDENTIALS` do contêiner do servidor. Isso exige mexer na infraestrutura do sGTM. Se um dia essa chave for configurada, a assinatura pode substituir o token sem mudar o schema.

## Contrato da requisição

```http
POST /tracking/server/v1/events
Content-Type: application/json
Authorization: Bearer <token>
X-Rastrack-Connection: <id da conexão>
X-Rastrack-Timestamp: 1795716000000

{
  "schema_version": "1.0",
  "event_name": "click_whatsapp",
  "event_id": "cv-123",
  "event_time": 1795716000000,
  "page_location": "https://consultas.comporvet.com.br/?utm_source=google&gclid=...",
  "client_id": "123.456",
  "session_id": "1795715000",
  "modalidade": "online",
  "attribution": { "fbp": "fb.1....", "fbc": "fb.1...." },
  "consent": { "ad_storage": "granted", "analytics_storage": "granted" },
  "properties": { "link_url": "https://wa.me/5548999106081" }
}
```

Respostas: `202 {"status":"accepted","eventId":"...","duplicate":false}`; `202 {"status":"ignored"}` para evento fora da lista; `400` para schema ou horário inválido; `401` para timestamp fora da janela; `404` para autenticação recusada; `413` acima de 32 KB; `429` acima do limite.

## Desligar

Defina `TRACKING_INGEST_ENABLED=false`, ou pause a conexão no Tracking Monitor. A tag passa a receber 404 e as demais tags do sGTM seguem normais. As tabelas `Tracking*` podem ficar no banco.
