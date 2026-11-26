import { Inject, Injectable, Logger } from "@nestjs/common";
import { createHash } from "node:crypto";
import { PrismaService } from "../common/prisma/prisma.service";
import {
  brazilNinthDigitVariants,
  hashNormalizedPhone,
  normalizePhoneIdentity,
} from "../common/phone/phone-identity";
import type { ParsedInboundWebhookEvent } from "../inbound-webhooks/providers/inbound-webhook-parser";

const TOKEN_IN_TEXT = /\bCV-([A-HJ-NP-Z2-9]{6})\b/i;

export function extractRefToken(text: string | null | undefined): string | null {
  const match = text ? TOKEN_IN_TEXT.exec(text) : null;
  return match ? `CV-${match[1]!.toUpperCase()}` : null;
}

/** SHA-256 of the E.164 digits, plus the other Brazilian 9th-digit form. */
export function metaPhoneHashes(phone: string): string[] {
  const normalized = normalizePhoneIdentity(phone);
  if (!normalized) return [];
  return brazilNinthDigitVariants(normalized)
    .map((variant) => hashNormalizedPhone(variant))
    .filter((hash): hash is string => Boolean(hash));
}

export function leadMetaEventId(workspaceId: string, refToken: string): string {
  const digest = createHash("sha256").update(`${workspaceId}:${refToken}`).digest("hex").slice(0, 32);
  return `rtd_lead_${digest}`;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002";
}

/**
 * Called for every official WhatsApp (meta_cloud) delivery. Only the first
 * inbound message carrying a click token is kept: it is the outbox row the
 * Lead dispatcher sends to Meta. Never throws into the webhook pipeline.
 */
@Injectable()
export class TrackingContactMatcherService {
  private readonly logger = new Logger(TrackingContactMatcherService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async recordInboundMessages(workspaceId: string, events: readonly ParsedInboundWebhookEvent[]): Promise<number> {
    let recorded = 0;
    for (const event of events) {
      try {
        if (await this.recordOne(workspaceId, event)) recorded += 1;
      } catch (error) {
        this.logger.warn(
          JSON.stringify({ event: "tracking.contact_match_failed", errorType: (error as Error)?.name }),
        );
      }
    }
    return recorded;
  }

  private async recordOne(workspaceId: string, event: ParsedInboundWebhookEvent): Promise<boolean> {
    if (event.message.direction !== "inbound" || event.message.authorType === "organization_member") return false;
    const refToken = extractRefToken(event.message.text);
    if (!refToken) return false;
    const phoneHashes = metaPhoneHashes(event.contact.phoneNumber);
    if (phoneHashes.length === 0) return false;

    const click =
      (await this.prisma.trackingEvent.findFirst({
        where: { workspaceId, refToken, eventName: "click_whatsapp" },
        orderBy: { eventTime: "desc" },
        select: { id: true },
      })) ??
      (await this.prisma.trackingEvent.findFirst({
        where: { workspaceId, refToken },
        orderBy: { eventTime: "desc" },
        select: { id: true },
      }));
    try {
      await this.prisma.trackingContactMatch.create({
        data: {
          workspaceId,
          refToken,
          trackingEventId: click?.id ?? null,
          externalMessageId: event.externalMessageId,
          channelPhone: event.channel.connectedPhone || null,
          phoneHashes,
          contactName: event.contact.name,
          messageAt: event.occurredAt,
          metaEventId: leadMetaEventId(workspaceId, refToken),
        },
      });
      return true;
    } catch (error) {
      if (isUniqueViolation(error)) return false;
      throw error;
    }
  }
}
