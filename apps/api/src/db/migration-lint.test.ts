import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  GRANDFATHERED_API_DUPLICATES,
  GRANDFATHERED_ROOT_DUPLICATES,
  checkDuplicatePrefixes,
  findDuplicatePrefixes,
  migrationPrefix,
} from "./migration-lint";

const repoRoot = path.resolve(__dirname, "../../../..");

function sqlFiles(dir: string): string[] {
  return readdirSync(path.join(repoRoot, dir)).filter((file) => file.endsWith(".sql"));
}

describe("migrationPrefix", () => {
  it("parses leading digits as an integer regardless of padding", () => {
    expect(migrationPrefix("00027-foo.sql")).toBe(27);
    expect(migrationPrefix("0027-foo.sql")).toBe(27);
    expect(migrationPrefix("027_foo.sql")).toBe(27);
    expect(migrationPrefix("README.md")).toBeNull();
  });
});

describe("findDuplicatePrefixes", () => {
  it("flags 4- and 5-digit prefixes with the same value", () => {
    const dupes = findDuplicatePrefixes(["0031-a.sql", "00031-b.sql", "00032-c.sql"]);
    expect([...dupes.keys()]).toEqual([31]);
    expect(dupes.get(31)).toEqual(["00031-b.sql", "0031-a.sql"]);
  });

  it("does not count a .down.sql file against its up migration", () => {
    expect(findDuplicatePrefixes(["00040-a.sql", "00040-a.down.sql"]).size).toBe(0);
  });
});

describe("checkDuplicatePrefixes", () => {
  const allowed = new Map([[5, ["0005-a.sql", "00005-b.sql"]]]);

  it("accepts an exact grandfathered group", () => {
    expect(checkDuplicatePrefixes(["0005-a.sql", "00005-b.sql"], allowed)).toEqual([]);
  });

  it("rejects a new file joining a grandfathered group", () => {
    const errors = checkDuplicatePrefixes(["0005-a.sql", "00005-b.sql", "00005-c.sql"], allowed);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("prefix 5");
  });

  it("rejects a brand-new collision", () => {
    expect(checkDuplicatePrefixes(["00050-a.sql", "0050-b.sql"], allowed)).toHaveLength(1);
  });
});

describe("migration directories in this repo", () => {
  it("apps/api/migrations has no new duplicate prefixes", () => {
    expect(
      checkDuplicatePrefixes(sqlFiles("apps/api/migrations"), GRANDFATHERED_API_DUPLICATES)
    ).toEqual([]);
  });

  it("root migrations/ has no new duplicate prefixes", () => {
    expect(checkDuplicatePrefixes(sqlFiles("migrations"), GRANDFATHERED_ROOT_DUPLICATES)).toEqual(
      []
    );
  });
});
