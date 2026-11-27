___TERMS_OF_SERVICE___

By creating or modifying this file you agree to Google Tag Manager's Community
Template Gallery Developer Terms of Service available at
https://developers.google.com/tag-manager/gallery-tos (or such other URL as
Google may provide), as modified from time to time.


___INFO___

{
  "type": "MACRO",
  "id": "cvt_temp_public_id",
  "version": 1,
  "securityGroups": [],
  "displayName": "RastrackDash - External ID",
  "categories": ["UTILITY"],
  "description": "SHA-256 (hex) do client_id do GA4: o mesmo external_id que o RastrackDash envia no Lead de site. Use no campo External ID das tags da Meta CAPI.",
  "containerContexts": [
    "SERVER"
  ]
}


___TEMPLATE_PARAMETERS___

[]


___SANDBOXED_JS_FOR_SERVER___

const getEventData = require('getEventData');
const makeString = require('makeString');
const sha256Sync = require('sha256Sync');

const clientId = getEventData('client_id');
if (clientId === undefined || clientId === null || makeString(clientId) === '') {
  return undefined;
}
return sha256Sync(makeString(clientId), { outputEncoding: 'hex' });


___SERVER_PERMISSIONS___

[
  {
    "instance": {
      "key": { "publicId": "read_event_data", "versionId": "1" },
      "param": [
        {
          "key": "keyPatterns",
          "value": { "type": 2, "listItem": [{ "type": 1, "string": "client_id" }] }
        },
        { "key": "eventDataAccess", "value": { "type": 1, "string": "specific" } }
      ]
    },
    "clientAnnotations": { "isEditedByUser": true },
    "isRequired": true
  }
]


___TESTS___

scenarios: []


___NOTES___

Mesmo cálculo do RastrackDash (apps/api/src/tracking/tracking-lead-dispatcher.service.ts,
external_id = sha256(client_id) em hex). O valor já sai com hash: a tag da Meta não deve
aplicar outro hash.
