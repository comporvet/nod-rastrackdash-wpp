import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDir = resolve(__dirname, "../../prisma/migrations");
const release = "20261105120100_simplesvet_parser_release";

function sql(name: string): string {
  return readFileSync(resolve(migrationsDir, name, "migration.sql"), "utf8");
}

describe("SimplesVet migrations on PostgreSQL", () => {
  it("applies the whole chain and stays idempotent", async () => {
    const db = new PGlite();
    const names = readdirSync(migrationsDir)
      .filter((entry) => /^\d{14}_/u.test(entry))
      .sort();
    for (const name of names) await db.exec(sql(name));
    await db.exec(sql(release));

    const { rows } = await db.query<{ status: string }>(
      `SELECT status FROM "InboundWebhookParserRelease"
        WHERE provider = 'simplesvet' AND version = 'automation-v1'`,
    );
    expect(rows).toEqual([{ status: "certified" }]);

    await db.exec(
      `UPDATE "InboundWebhookParserRelease" SET status = 'retired'
        WHERE provider = 'simplesvet'`,
    );
    await db.exec(sql(release));
    const retired = await db.query<{ status: string }>(
      `SELECT status FROM "InboundWebhookParserRelease"
        WHERE provider = 'simplesvet'`,
    );
    expect(retired.rows).toEqual([{ status: "retired" }]);
    await db.close();
  }, 60_000);
});
