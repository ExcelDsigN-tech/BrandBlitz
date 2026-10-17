import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const originalDatabaseUrl = process.env.DATABASE_URL;
const schemaName = `timestamps_test_${Date.now()}_${randomUUID().replace(/-/g, "")}`;

function withSearchPath(connectionString: string, schema: string): string {
  const url = new URL(connectionString);
  const existingOptions = url.searchParams.get("options");
  const searchPathOption = `-c search_path=${schema}`;
  url.searchParams.set(
    "options",
    existingOptions ? `${existingOptions} ${searchPathOption}` : searchPathOption
  );
  return url.toString();
}

if (originalDatabaseUrl) {
  process.env.DATABASE_URL = withSearchPath(originalDatabaseUrl, schemaName);
}

const describeIntegration = originalDatabaseUrl ? describe : describe.skip;

describeIntegration("timestamp columns and updated_at trigger", () => {
  let query: typeof import("../index").query;
  let closeDb: typeof import("../index").closeDb;

  beforeAll(async () => {
    const db = await import("../index");
    query = db.query;
    closeDb = db.closeDb;

    await query(`CREATE SCHEMA IF NOT EXISTS ${schemaName}`);
    await query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);

    await query(`
      CREATE TABLE timestamp_test (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await query(`
      CREATE OR REPLACE FUNCTION set_updated_at()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = NOW();
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    await query(`
      CREATE TRIGGER timestamp_test_updated_at
      BEFORE UPDATE ON timestamp_test
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    `);
  });

  afterAll(async () => {
    if (query) {
      await query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
    }
    if (closeDb) {
      await closeDb();
    }
    process.env.DATABASE_URL = originalDatabaseUrl;
  });

  it("sets updated_at equal to created_at on insert", async () => {
    const result = await query<{
      id: string;
      created_at: Date;
      updated_at: Date;
    }>(
      `INSERT INTO timestamp_test (name)
       VALUES ($1)
       RETURNING id, created_at, updated_at`,
      ["first"]
    );

    const row = result.rows[0];
    expect(row.id).toBeTruthy();
    expect(row.created_at.getTime()).toBeGreaterThan(0);
    expect(row.updated_at.getTime()).toBeGreaterThan(0);
    expect(Math.abs(row.updated_at.getTime() - row.created_at.getTime())).toBeLessThan(1000);
  });

  it("bumps updated_at when a row is updated", async () => {
    const insertResult = await query<{
      id: string;
      created_at: Date;
      updated_at: Date;
    }>(
      `INSERT INTO timestamp_test (name)
       VALUES ($1)
       RETURNING id, created_at, updated_at`,
      ["before-update"]
    );

    const row = insertResult.rows[0];
    await new Promise((resolve) => setTimeout(resolve, 10));

    await query(`UPDATE timestamp_test SET name = $1 WHERE id = $2`, ["after-update", row.id]);

    const updatedResult = await query<{ updated_at: Date; created_at: Date }>(
      `SELECT created_at, updated_at FROM timestamp_test WHERE id = $1`,
      [row.id]
    );

    const updatedRow = updatedResult.rows[0];
    expect(updatedRow.created_at.getTime()).toBe(row.created_at.getTime());
    expect(updatedRow.updated_at.getTime()).toBeGreaterThan(row.updated_at.getTime());
  });
});
