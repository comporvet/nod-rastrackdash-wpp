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

## 5. Token do WhatsApp e Lead de site na Meta (Advanced Matching)

Sem formulário, o primeiro dado pessoal do visitante é o telefone que chega no WhatsApp. A ponte liga esse telefone ao clique no site ou na LP e envia à Meta um **Lead** de site com telefone (hash), fbp, fbc, IP e user agent do clique.

```text
Clique no WhatsApp (site/LP) -> mensagem pré-preenchida com "_Atendimento: CV-XXXXXX_"
  -> GA4 click_whatsapp com ref_token -> sGTM -> RastrackDash (guarda o clique)
  -> visitante envia a mensagem -> API oficial do WhatsApp -> RastrackDash
  -> liga telefone ao clique -> Lead (action_source website) -> Meta CAPI
```

Requisito: os números da Comporvet conectados no RastrackDash como **WhatsApp API oficial (Meta Cloud)** em Integrações, com o app inscrito na WABA. Mensagens da UAZAPI não entram nesta ponte.

### 5.1 GTM Web (contêineres do site e das LPs)

Faça em cada contêiner Web (`GTM-MHMF75GT` e `GTM-ND8M6BWC`), num workspace novo:

1. **Tags → Nova → HTML personalizado**, nome `05 - [RASTRACKDASH] Token WhatsApp`, com o conteúdo de [`gtm-server-side/whatsapp-ref-token.html`](gtm-server-side/whatsapp-ref-token.html). Acionador **Initialization - All Pages**.
   - O texto padrão (quando o link não tem `text=`) fica na constante `DEFAULT_TEXT` do código; ajuste por contêiner se quiser.
2. **Variáveis → Nova → JavaScript personalizado**, nome `JS - RastrackDash Ref`:

   ```js
   function () {
     try { return window.__rtdRefToken || sessionStorage.getItem('rtd_ref') || undefined; }
     catch (e) { return undefined; }
   }
   ```

3. Na tag GA4 do evento `click_whatsapp`, adicione o parâmetro de evento `ref_token` = `{{JS - RastrackDash Ref}}`. Opcional: o mesmo parâmetro na tag do Google (configuração), para que o page_view também o carregue.
4. No Preview, clique no botão do WhatsApp: o link aberto deve terminar com `_Atendimento: CV-XXXXXX_` (no WhatsApp aparece em itálico) e o evento `click_whatsapp` deve mostrar o parâmetro `ref_token` com o mesmo valor.

Limitações: se o visitante apagar a linha `Atendimento:` antes de enviar, ou abrir o WhatsApp por outro caminho (copiando o número), não há ligação. O token é por sessão do navegador: vários cliques na mesma sessão usam o mesmo token, e só a primeira mensagem com ele gera Lead.

### 5.2 GTM Server-Side

Reimporte o modelo [`gtm-server-side/rastrackdash-tag.tpl`](gtm-server-side/rastrackdash-tag.tpl) (ou atualize o código e as permissões do modelo existente). A versão atual também envia `ref_token`, `ip_override` (IP do visitante) e `user_agent` do Event Data. O acionador e a tag não mudam.

### 5.3 RastrackDash

Em **Tracking Monitor → Configuração**:

- marque **Enviar Lead de site à Meta**;
- informe o pixel/conjunto de dados `1075406568726436` (vazio usa o pixel da conexão Meta do workspace). O token de acesso é o da conexão Meta já configurada;
- para o teste, preencha o **código de teste** do Gerenciador de Eventos e apague-o depois.

### 5.4 O que vai para a Meta

| Campo | Valor |
|---|---|
| `event_name` | `Lead` |
| `action_source` | `website` |
| `event_time` | horário da mensagem no WhatsApp |
| `event_id` | fixo por token (`rtd_lead_...`), então reenvios são deduplicados |
| `event_source_url` | página do clique (só UTMs e identificadores de clique na query) |
| `user_data.ph` | SHA-256 do telefone, com e sem o nono dígito |
| `user_data.fn` | SHA-256 do primeiro nome do perfil do WhatsApp, quando houver |
| `user_data.fbp` / `fbc` | cookies do clique; `fbc` montado do `fbclid` real quando não houver cookie |
| `user_data.client_ip_address` / `client_user_agent` | do clique, recebidos pelo sGTM |
| `user_data.external_id` | SHA-256 do client_id do GA4 |
| `custom_data` | `lead_source=whatsapp`, ambiente, modalidade/origem |

Situações no monitor: **Na fila**, **Tentando de novo** (erro temporário, até 6 tentativas), **Lead enviado**, **Falhou** (recusa da Meta, com a mensagem), **Envio desligado**, **Expirado** (mensagem com mais de 7 dias), **Sem clique com este token** (após 15 minutos sem o clique chegar), **Não enviado** (clique sem user agent).

O Lead é separado do `Contact` (o clique): não altera as conversões personalizadas `[LP][ONLINE]`, `[LP][PRESENCIAL]` e `[SITE] - Contato WhatsApp`.

### 5.5 Teste controlado

1. Com o código de teste preenchido, abra a LP Online em aba anônima, clique no WhatsApp e envie a mensagem sem apagar a linha `Atendimento:`, de um número que não seja o da Comporvet.
2. No Tracking Monitor, em **Contatos ligados a um clique**, o token deve aparecer como **Lead enviado** em até 2 minutos.
3. No Gerenciador de Eventos → Eventos de teste, o Lead deve aparecer com telefone, fbp, IP e user agent.
4. Apague o código de teste e salve.

## 6. external_id nas tags da Meta CAPI (ligar visitas e cliques ao Lead)

O Lead de site leva `external_id` = SHA-256 (hex) do `client_id` do GA4. Se as tags da Meta CAPI do sGTM (PageView e Contact) enviarem o mesmo valor, a Meta associa os eventos seguintes do mesmo navegador à pessoa identificada pelo telefone no Lead.

1. No sGTM, **Modelos → Modelos de variável → Novo → ⋮ → Importar** e escolha [`gtm-server-side/rastrackdash-external-id-variable.tpl`](gtm-server-side/rastrackdash-external-id-variable.tpl). Salve.
2. **Variáveis → Nova**, tipo **RastrackDash - External ID**, nome `RastrackDash External ID`.
3. As tags da Meta usam o modelo oficial **Conversions API Tag (facebookincubator)**, que não tem campo de dados do usuário: ele lê a chave `x-fb-ud-external_id` do Event Data. Crie em **Transformações → Nova**:
   - nome `02 - [META CAPI] external_id RastrackDash`, tipo **Aumentar evento**;
   - parâmetro `x-fb-ud-external_id` = `{{RastrackDash External ID}}`, sem condição;
   - tags afetadas: só `02 - [META CAPI] PageView` e `02 - [META CAPI] Contact - WhatsApp`.
4. No Preview do sGTM, compare o valor da variável (aba **Variáveis**) com `user_data.external_id` da requisição de saída para `graph.facebook.com` (aba **Solicitação**). Devem ser idênticos: o modelo não aplica outro hash a um valor de 64 caracteres hexadecimais (verificado em 26/11/2026).

Não muda o `event_id` nem a deduplicação Pixel/CAPI.

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

Também são gravados o token `ref_token`, o IP (`ip_override`) e o user agent do visitante, usados no Lead de site (seção 5). O telefone só é guardado como hash, na ligação com a mensagem; o texto da mensagem não é gravado.

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
