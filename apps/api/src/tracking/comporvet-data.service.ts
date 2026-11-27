import { Inject, Injectable, Logger, type OnModuleDestroy } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { RUNTIME_ENV, type RuntimeEnv } from "../common/runtime/runtime.module";
import { metaPhoneHashes } from "./tracking-contact-matcher.service";

const CACHE_TTL_MS = 5 * 60_000;
const PHONE_COLUMNS = ["TELEFONE", ...Array.from({ length: 10 }, (_, index) => `PHONE ${index + 1}`)];

export type ComporvetSourceStatus = "ok" | "not_configured" | "missing_table" | "error";

export type ComporvetCustomers = {
  status: ComporvetSourceStatus;
  /** Phone hash (both 9th-digit forms) -> first purchase date (YYYY-MM-DD). */
  firstPurchaseByHash: Map<string, string>;
};

export type ComporvetAppointment = { createdAt: Date; startsAt: Date | null; status: string };

export type ComporvetAppointments = {
  status: ComporvetSourceStatus;
  byHash: Map<string, ComporvetAppointment[]>;
};

/** "dd/mm/yyyy[ hh:mm]" (SimplesVet export) or ISO "yyyy-mm-dd". */
export function parseComporvetDate(value: unknown): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  if (typeof value !== "string") return null;
  const text = value.trim();
  const br = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(text);
  if (br) return `${br[3]}-${br[2]!.padStart(2, "0")}-${br[1]!.padStart(2, "0")}`;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : null;
}

export function phonesOf(value: unknown): string[] {
  if (typeof value !== "string") return [];
  return value
    .split(/[,;/|]/)
    .map((phone) => phone.trim())
    .filter((phone) => phone.replace(/\D/g, "").length >= 10);
}

function isMissingRelation(error: unknown): boolean {
  const text = String((error as { message?: unknown })?.message ?? "");
  return /42P01|does not exist|não existe/i.test(text);
}

/**
 * Read-only access to the Comporvet database (customers from the SimplesVet
 * sync and appointments written by the n8n Google Calendar flow). Optional:
 * without COMPORVET_DATABASE_URL the funnel shows those stages as unavailable.
 */
@Injectable()
export class ComporvetDataService implements OnModuleDestroy {
  private readonly logger = new Logger(ComporvetDataService.name);
  private client: PrismaClient | null = null;
  private customersCache: { at: number; value: ComporvetCustomers } | null = null;
  private appointmentsCache: { at: number; value: ComporvetAppointments } | null = null;

  constructor(@Inject(RUNTIME_ENV) private readonly env: RuntimeEnv) {}

  async onModuleDestroy(): Promise<void> {
    await this.client?.$disconnect();
  }

  private connection(): PrismaClient | null {
    const url = this.env.COMPORVET_DATABASE_URL?.trim();
    if (!url) return null;
    this.client ??= new PrismaClient({ datasourceUrl: url });
    return this.client;
  }

  async customers(now = Date.now()): Promise<ComporvetCustomers> {
    if (this.customersCache && now - this.customersCache.at < CACHE_TTL_MS) return this.customersCache.value;
    const db = this.connection();
    if (!db) return { status: "not_configured", firstPurchaseByHash: new Map() };
    try {
      const columns = [...PHONE_COLUMNS, "PRIMEIRA COMPRA"].map((name) => `"${name}"`).join(", ");
      const rows = await db.$queryRawUnsafe<Record<string, unknown>[]>(`SELECT ${columns} FROM "Clientes"`);
      const firstPurchaseByHash = new Map<string, string>();
      for (const row of rows) {
        const firstPurchase = parseComporvetDate(row["PRIMEIRA COMPRA"]);
        if (!firstPurchase) continue;
        for (const phone of PHONE_COLUMNS.flatMap((column) => phonesOf(row[column]))) {
          for (const hash of metaPhoneHashes(phone)) {
            const current = firstPurchaseByHash.get(hash);
            if (!current || firstPurchase < current) firstPurchaseByHash.set(hash, firstPurchase);
          }
        }
      }
      const value: ComporvetCustomers = { status: "ok", firstPurchaseByHash };
      this.customersCache = { at: now, value };
      return value;
    } catch (error) {
      this.logger.warn(JSON.stringify({ event: "comporvet.customers_failed", errorType: (error as Error)?.name }));
      return { status: isMissingRelation(error) ? "missing_table" : "error", firstPurchaseByHash: new Map() };
    }
  }

  async appointments(now = Date.now()): Promise<ComporvetAppointments> {
    if (this.appointmentsCache && now - this.appointmentsCache.at < CACHE_TTL_MS) return this.appointmentsCache.value;
    const db = this.connection();
    if (!db) return { status: "not_configured", byHash: new Map() };
    try {
      const rows = await db.$queryRawUnsafe<
        { telefone: string | null; inicio: Date | null; status: string | null; criado_em: Date }[]
      >(`SELECT telefone, inicio, status, criado_em FROM "Rastrack_Agendamentos"`);
      const byHash = new Map<string, ComporvetAppointment[]>();
      for (const row of rows) {
        const appointment = {
          createdAt: new Date(row.criado_em),
          startsAt: row.inicio ? new Date(row.inicio) : null,
          status: (row.status ?? "agendado").toLowerCase(),
        };
        for (const hash of phonesOf(row.telefone).flatMap((phone) => metaPhoneHashes(phone))) {
          const list = byHash.get(hash) ?? [];
          list.push(appointment);
          byHash.set(hash, list);
        }
      }
      const value: ComporvetAppointments = { status: "ok", byHash };
      this.appointmentsCache = { at: now, value };
      return value;
    } catch (error) {
      this.logger.warn(JSON.stringify({ event: "comporvet.appointments_failed", errorType: (error as Error)?.name }));
      return { status: isMissingRelation(error) ? "missing_table" : "error", byHash: new Map() };
    }
  }
}
