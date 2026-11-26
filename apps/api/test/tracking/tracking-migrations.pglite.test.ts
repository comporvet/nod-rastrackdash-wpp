import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDir = resolve(__dirname, "../../prisma/migrations");
const migration = "20261126120000_tracking_server_ingest";

function sql(name: string): string {
  return readFileSync(resolve(migrationsDir, name, "migration.sql"), "utf8");
}

describe("tracking migration on PostgreSQL", () => {
  it("applies the whole chain, stays idempotent and enforces the dedupe key", async () => {
    const db = new PGlite();
    const names = readdirSync(migrationsDir)
      .filter((entry) => /^\d{14}_/u.test(entry))
      .sort();
    for (const name of names) await db.exec(sql(name));
    await db.exec(sql(migration));

    await db.exec(`INSERT INTO "Workspace" ("id", "name", "slug", "createdAt", "updatedAt")
      VALUES ('ws_1', 'Teste', 'teste', now(), now())`);
    const insertEvent = (id: string) =>
      db.exec(`INSERT INTO "TrackingEvent" ("id", "workspaceId", "schemaVersion", "eventName", "dedupeKey",
        "dedupeConfidence", "eventTime", "environment")
        VALUES ('${id}', 'ws_1', '1.0', 'click_whatsapp', 'id:click_whatsapp:cv-1', 'event_id', now(), 'lp_online')`);
    await insertEvent("evt_1");
    await expect(insertEvent("evt_2")).rejects.toThrow();

    const { rows } = await db.query<{ attribution: unknown }>(
      `SELECT "attribution" FROM "TrackingEvent" WHERE "id" = 'evt_1'`,
    );
    expect(rows).toEqual([{ attribution: {} }]);
    await db.close();
  }, 60_000);
});
