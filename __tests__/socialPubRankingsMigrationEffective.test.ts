// Effective PostgreSQL proof for 0186 (your pubs in your own order).
//
// A pub lands between the two neighbours the comparisons found, inside its
// band; a stale pair is refused; placing an already-ranked pub moves it; the
// read is in band order then place; one person's list never reaches another.
// Browser roles hold nothing, and the rollback drops it all.

import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  asServiceRole,
  postgresSkipReason,
  startMigratedPostgres,
  type PostgresSession,
} from "./helpers/postgres";

const skipReason = postgresSkipReason();

const ROLLBACK = join(
  process.cwd(),
  "supabase/migrations/rollback/20261017170000_0186_social_pub_rankings_rollback.sql",
);

const ME = "00000000-0000-4000-8000-0000000000c1";
const YOU = "00000000-0000-4000-8000-0000000000c2";

let database: PostgresSession | null = null;

function db(): PostgresSession {
  if (!database) throw new Error("PostgreSQL session unavailable.");
  return database;
}

function q(value: string | null): string {
  return value === null ? "null" : `'${value}'`;
}

function place(author: string, venue: string, band: string, above: string | null, below: string | null): string {
  return asServiceRole(
    `select venue_id from public.place_social_pub_ranking('${author}', '${venue}', '${band}', ${q(above)}, ${q(below)});`,
  );
}

function order(author = ME): string[] {
  const rows = db().sql(asServiceRole(`select band || ':' || venue_id from public.read_social_pub_rankings('${author}');`));
  return rows ? rows.split("\n") : [];
}

beforeAll(async () => {
  if (skipReason) return;
  database = await startMigratedPostgres({ label: "pub-rankings", database: "pubmax_pub_rankings" });
  db().sql(`insert into public.profiles (id, handle) values ('${ME}', 'me'), ('${YOU}', 'you');`);
}, 300_000);

afterAll(async () => {
  await database?.stop();
  database = null;
});

describe.skipIf(skipReason !== null)("0186 social pub rankings", () => {
  it("builds a band in the order the comparisons found", () => {
    db().sql(place(ME, "harp", "loved", null, null));
    db().sql(place(ME, "lamb", "loved", "harp", null));
    db().sql(place(ME, "crown", "loved", "harp", "lamb"));
    db().sql(place(ME, "anchor", "loved", null, "harp"));
    db().sql(place(ME, "spoons", "not_for_me", null, null));
    db().sql(place(ME, "bell", "fine", null, null));
    expect(order()).toEqual([
      "loved:anchor", "loved:harp", "loved:crown", "loved:lamb", "fine:bell", "not_for_me:spoons",
    ]);
  });

  it("refuses neighbours that are no longer adjacent, from another band, or the pub itself", () => {
    expect(db().expectRefusal(place(ME, "plough", "loved", "anchor", "crown"))).toMatch(/stale Social ranking/);
    expect(db().expectRefusal(place(ME, "plough", "loved", "lamb", "harp"))).toMatch(/stale Social ranking/);
    expect(db().expectRefusal(place(ME, "plough", "fine", "harp", null))).toMatch(/stale Social ranking/);
    expect(db().expectRefusal(place(ME, "plough", "loved", "plough", null))).toMatch(/invalid Social ranking venue/);
    expect(db().expectRefusal(place(ME, "plough", "great", null, null))).toMatch(/invalid Social ranking band/);
    expect(order()).not.toContain("loved:plough");
  });

  it("moves a pub that is already ranked, across bands too", () => {
    db().sql(place(ME, "harp", "fine", "bell", null));
    expect(order()).toEqual(["loved:anchor", "loved:crown", "loved:lamb", "fine:bell", "fine:harp", "not_for_me:spoons"]);
    db().sql(place(ME, "harp", "loved", null, "anchor"));
    expect(order()[0]).toBe("loved:harp");
    expect(order()).toHaveLength(6);
  });

  it("keeps one person's list from another, and removes a pub", () => {
    db().sql(place(YOU, "harp", "not_for_me", null, null));
    expect(order(YOU)).toEqual(["not_for_me:harp"]);
    expect(order()).toContain("loved:harp");
    expect(db().sql(asServiceRole(`select public.remove_social_pub_ranking('${ME}', 'spoons');`))).toBe("t");
    expect(db().sql(asServiceRole(`select public.remove_social_pub_ranking('${ME}', 'spoons');`))).toBe("f");
    expect(order()).not.toContain("not_for_me:spoons");
  });

  it("keeps placing after many halvings between the same two pubs", () => {
    let above = "anchor";
    for (let i = 0; i < 40; i += 1) {
      const venue = `squeeze-${i}`;
      db().sql(place(ME, venue, "loved", above, "crown"));
      above = venue;
    }
    const loved = order().filter((row) => row.startsWith("loved:"));
    expect(loved.indexOf("loved:squeeze-39")).toBe(loved.indexOf("loved:crown") - 1);
  });

  it("gives browser roles nothing", () => {
    for (const role of ["anon", "authenticated"]) {
      expect(db().sql(`select has_table_privilege('${role}', 'public.social_pub_rankings', 'select,insert,update,delete');`)).toBe("f");
      expect(db().sql(`select has_function_privilege('${role}', 'public.place_social_pub_ranking(uuid,text,text,text,text)', 'execute');`)).toBe("f");
      expect(db().sql(`select has_function_privilege('${role}', 'public.read_social_pub_rankings(uuid)', 'execute');`)).toBe("f");
    }
  });

  it("rolls back to nothing, and a second rollback is a no-op", () => {
    db().applyFile(ROLLBACK);
    db().applyFile(ROLLBACK);
    expect(db().sql("select to_regclass('public.social_pub_rankings') is null;")).toBe("t");
    expect(db().sql("select count(*) from pg_proc where proname in ('place_social_pub_ranking', 'remove_social_pub_ranking', 'read_social_pub_rankings');")).toBe("0");
  });
});
