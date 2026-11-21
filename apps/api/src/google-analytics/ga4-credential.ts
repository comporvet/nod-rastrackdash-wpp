import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { z } from "zod";
import type { RuntimeEnv } from "../common/runtime/runtime.module";
import { parseInboundWebhooksConfig } from "../config/deployment-config";

export const serviceAccountKeySchema = z.object({
  type: z.literal("service_account"),
  client_email: z.string().email(),
  private_key: z.string().includes("PRIVATE KEY"),
  private_key_id: z.string().optional(),
  token_uri: z.string().url().optional(),
});

export type ServiceAccountKey = z.infer<typeof serviceAccountKeySchema>;

export type EncryptedGa4Credential = {
  credentialEncrypted: string;
  credentialIv: string;
  credentialTag: string;
};

const ASSOCIATED_DATA_PREFIX = "wpptrack:ga4-service-account:v1";

export class Ga4CredentialUnavailableError extends Error {
  constructor() {
    super("INBOUND_WEBHOOK_ENCRYPTION_KEY ausente ou webhooks desligados");
  }
}

function encryptionKey(env: RuntimeEnv): Buffer {
  const config = parseInboundWebhooksConfig(env);
  if (!config.enabled) throw new Ga4CredentialUnavailableError();
  return config.encryptionKey;
}

function associatedData(workspaceId: string): Buffer {
  return Buffer.from(`${ASSOCIATED_DATA_PREFIX}\0${workspaceId}`, "utf8");
}

export function parseServiceAccountKey(raw: string): ServiceAccountKey | null {
  try {
    const parsed = serviceAccountKeySchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function encryptServiceAccountKey(
  env: RuntimeEnv,
  workspaceId: string,
  key: ServiceAccountKey,
): EncryptedGa4Credential {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(env), iv);
  cipher.setAAD(associatedData(workspaceId));
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(key), "utf8"),
    cipher.final(),
  ]);
  return {
    credentialEncrypted: encrypted.toString("base64"),
    credentialIv: iv.toString("base64"),
    credentialTag: cipher.getAuthTag().toString("base64"),
  };
}

export function decryptServiceAccountKey(
  env: RuntimeEnv,
  workspaceId: string,
  input: EncryptedGa4Credential,
): ServiceAccountKey {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(env),
    Buffer.from(input.credentialIv, "base64"),
  );
  decipher.setAAD(associatedData(workspaceId));
  decipher.setAuthTag(Buffer.from(input.credentialTag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(input.credentialEncrypted, "base64")),
    decipher.final(),
  ]).toString("utf8");
  return serviceAccountKeySchema.parse(JSON.parse(plaintext));
}
