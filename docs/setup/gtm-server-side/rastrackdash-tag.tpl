___TERMS_OF_SERVICE___

By creating or modifying this file you agree to Google Tag Manager's Community
Template Gallery Developer Terms of Service available at
https://developers.google.com/tag-manager/gallery-tos (or such other URL as
Google may provide), as modified from time to time.


___INFO___

{
  "type": "TAG",
  "id": "cvt_temp_public_id",
  "version": 1,
  "securityGroups": [],
  "displayName": "RastrackDash - Enviar Eventos",
  "categories": ["ANALYTICS"],
  "brand": {
    "id": "brand_dummy",
    "displayName": "RastrackDash"
  },
  "description": "Envia ao RastrackDash uma cópia dos eventos monitorados (page_view, scroll_depth, click_whatsapp, click). Não altera nem atrasa as tags do GA4, do Google Ads e da Meta.",
  "containerContexts": [
    "SERVER"
  ]
}


___TEMPLATE_PARAMETERS___

[
  {
    "type": "TEXT",
    "name": "endpointUrl",
    "displayName": "URL de recepção do RastrackDash",
    "simpleValueType": true,
    "defaultValue": "https://rastrackdash-api.ivet.app.br/tracking/server/v1/events",
    "valueValidators": [
      { "type": "NON_EMPTY" },
      { "type": "REGEX", "args": ["^https://.+"] }
    ]
  },
  {
    "type": "TEXT",
    "name": "connectionId",
    "displayName": "ID da conexão",
    "simpleValueType": true,
    "help": "Mostrado no Tracking Monitor ao gerar o token.",
    "valueValidators": [{ "type": "NON_EMPTY" }]
  },
  {
    "type": "TEXT",
    "name": "token",
    "displayName": "Token da recepção",
    "simpleValueType": true,
    "help": "Use uma variável constante do contêiner de servidor, por exemplo {{RastrackDash Token}}. Nunca coloque o token no contêiner Web.",
    "valueValidators": [{ "type": "NON_EMPTY" }]
  },
  {
    "type": "TEXT",
    "name": "allowedEvents",
    "displayName": "Eventos enviados (separados por vírgula)",
    "simpleValueType": true,
    "defaultValue": "page_view,scroll_depth,click_whatsapp,click"
  },
  {
    "type": "TEXT",
    "name": "eventIdKey",
    "displayName": "Chave do event_id no Event Data",
    "simpleValueType": true,
    "defaultValue": "event_id",
    "help": "Parâmetro do evento GA4 que carrega o mesmo event_id usado pela Meta. Confira no Preview do sGTM."
  },
  {
    "type": "TEXT",
    "name": "timeoutMs",
    "displayName": "Tempo limite (ms)",
    "simpleValueType": true,
    "defaultValue": "2000",
    "valueValidators": [{ "type": "POSITIVE_NUMBER" }]
  }
]


___SANDBOXED_JS_FOR_SERVER___

const getEventData = require('getEventData');
const getCookieValues = require('getCookieValues');
const getTimestampMillis = require('getTimestampMillis');
const getType = require('getType');
const JSON = require('JSON');
const logToConsole = require('logToConsole');
const makeInteger = require('makeInteger');
const makeNumber = require('makeNumber');
const makeString = require('makeString');
const sendHttpRequest = require('sendHttpRequest');

const text = (value) => {
  if (value === undefined || value === null) return undefined;
  const result = makeString(value);
  return result ? result : undefined;
};

const firstCookie = (name) => {
  const values = getCookieValues(name);
  return values && values.length ? values[0] : undefined;
};

// x-ga-gcs = "G1" + ad_storage + analytics_storage (1 granted, 0 denied).
const consentFromGcs = (gcs) => {
  const state = (digit) => (digit === '1' ? 'granted' : digit === '0' ? 'denied' : 'unknown');
  if (getType(gcs) !== 'string' || gcs.length < 4) {
    return { analytics_storage: 'unknown', ad_storage: 'unknown' };
  }
  return { ad_storage: state(gcs.charAt(2)), analytics_storage: state(gcs.charAt(3)) };
};

const eventName = getEventData('event_name');
const allowed = makeString(data.allowedEvents || '')
  .split(',')
  .map((name) => name.trim())
  .filter((name) => name.length > 0);

if (getType(eventName) !== 'string' || allowed.indexOf(eventName) < 0) {
  data.gtmOnSuccess();
  return;
}

const percentScrolled = getEventData('percent_scrolled');
const payload = {
  schema_version: '1.0',
  event_name: eventName,
  event_id: text(getEventData(data.eventIdKey || 'event_id')),
  event_time: getTimestampMillis(),
  page_location: text(getEventData('page_location')),
  page_referrer: text(getEventData('page_referrer')),
  client_id: text(getEventData('client_id')),
  session_id: text(getEventData('ga_session_id')),
  modalidade: text(getEventData('modalidade')),
  origem: text(getEventData('origem')),
  ref_token: text(getEventData('ref_token')),
  ip_address: text(getEventData('ip_override')),
  user_agent: text(getEventData('user_agent')),
  attribution: {
    fbp: text(firstCookie('_fbp')),
    fbc: text(firstCookie('_fbc')),
  },
  consent: consentFromGcs(getEventData('x-ga-gcs')),
  properties: {
    percent_scrolled: percentScrolled === undefined ? undefined : makeNumber(percentScrolled),
    link_url: text(getEventData('link_url')),
    link_domain: text(getEventData('link_domain')),
    outbound: getType(getEventData('outbound')) === 'boolean' ? getEventData('outbound') : undefined,
  },
};

sendHttpRequest(
  data.endpointUrl,
  {
    method: 'POST',
    timeout: makeInteger(data.timeoutMs) || 2000,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + data.token,
      'X-Rastrack-Connection': data.connectionId,
      'X-Rastrack-Timestamp': makeString(getTimestampMillis()),
    },
  },
  JSON.stringify(payload)
).then(
  (result) => {
    if (result.statusCode >= 200 && result.statusCode < 300) {
      data.gtmOnSuccess();
    } else {
      logToConsole('RastrackDash recusou o evento', eventName, result.statusCode);
      data.gtmOnFailure();
    }
  },
  (error) => {
    logToConsole('RastrackDash indisponível', eventName, error && error.reason);
    data.gtmOnFailure();
  }
);


___SERVER_PERMISSIONS___

[
  {
    "instance": {
      "key": { "publicId": "read_event_data", "versionId": "1" },
      "param": [
        {
          "key": "keyPatterns",
          "value": {
            "type": 2,
            "listItem": [
              { "type": 1, "string": "event_name" },
              { "type": 1, "string": "event_id" },
              { "type": 1, "string": "page_location" },
              { "type": 1, "string": "page_referrer" },
              { "type": 1, "string": "client_id" },
              { "type": 1, "string": "ga_session_id" },
              { "type": 1, "string": "modalidade" },
              { "type": 1, "string": "origem" },
              { "type": 1, "string": "ref_token" },
              { "type": 1, "string": "ip_override" },
              { "type": 1, "string": "user_agent" },
              { "type": 1, "string": "x-ga-gcs" },
              { "type": 1, "string": "percent_scrolled" },
              { "type": 1, "string": "link_url" },
              { "type": 1, "string": "link_domain" },
              { "type": 1, "string": "outbound" }
            ]
          }
        },
        { "key": "eventDataAccess", "value": { "type": 1, "string": "specific" } }
      ]
    },
    "clientAnnotations": { "isEditedByUser": true },
    "isRequired": true
  },
  {
    "instance": {
      "key": { "publicId": "get_cookies", "versionId": "1" },
      "param": [
        { "key": "cookieAccess", "value": { "type": 1, "string": "specific" } },
        {
          "key": "cookieNames",
          "value": {
            "type": 2,
            "listItem": [
              { "type": 1, "string": "_fbp" },
              { "type": 1, "string": "_fbc" }
            ]
          }
        }
      ]
    },
    "clientAnnotations": { "isEditedByUser": true },
    "isRequired": true
  },
  {
    "instance": {
      "key": { "publicId": "send_http", "versionId": "1" },
      "param": [
        { "key": "allowedUrls", "value": { "type": 1, "string": "specific" } },
        {
          "key": "urls",
          "value": {
            "type": 2,
            "listItem": [
              { "type": 1, "string": "https://rastrackdash-api.ivet.app.br/tracking/server/v1/events" }
            ]
          }
        }
      ]
    },
    "clientAnnotations": { "isEditedByUser": true },
    "isRequired": true
  },
  {
    "instance": {
      "key": { "publicId": "logging", "versionId": "1" },
      "param": [
        { "key": "environments", "value": { "type": 1, "string": "debug" } }
      ]
    },
    "clientAnnotations": { "isEditedByUser": true },
    "isRequired": true
  }
]


___TESTS___

scenarios: []


___NOTES___

Gerado para o RastrackDash (recepção GTM Server-Side, schema 1.0). Se a chave
do event_id for diferente de event_id, inclua o nome dela também na permissão
"Lê dados de evento".
