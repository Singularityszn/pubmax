// Effective PostgreSQL proof for 0191 (foreign key covering indexes).
//
// A foreign key with no index on its own columns makes every delete of the
// parent row scan the child table under lock. Deleting one profile touched a
// dozen such tables. This proof applies every migration, reads the real
// catalog, and lists each foreign key in schema public whose columns are not
// the leading key columns of a plain (non-partial) index on its table. The
// list must equal the allowlist below, and the rollback must drop exactly the
// indexes 0191 adds.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { postgresSkipReason, startMigratedPostgres, type PostgresSession } from "./helpers/postgres";

const skipReason = postgresSkipReason();

const MIGRATION_PATH = join(
  process.cwd(),
  "supabase/migrations/20261018120000_0191_foreign_key_covering_indexes.sql",
);
const ROLLBACK_PATH = join(
  process.cwd(),
  "supabase/migrations/rollback/20261018120000_0191_foreign_key_covering_indexes_rollback.sql",
);

/**
 * Foreign keys that may stay without a covering index, each as
 * `table(col, ...) constraint_name` with its reason beside it. The list is
 * CLOSED and may only ever SHRINK: a new foreign key ships with its index in
 * the same migration, not with a row here. It is empty after 0191.
 */
const UNCOVERED_FOREIGN_KEY_ALLOWLIST: readonly string[] = [];

/**
 * Each row is one foreign key in public whose columns are not the leading key
 * columns of an index on the same table. Column order inside the prefix does
 * not matter, because the check probes by equality on every column at once.
 * A partial index counts only when its predicate is `<column> IS NOT NULL` on
 * a one-column key: the planner proves `column = $1` implies it, so the
 * generic plan of the foreign key check still uses that index.
 */
const UNCOVERED_FOREIGN_KEYS_SQL = `
  with fk as (
    select c.conrelid, c.conname, c.conkey,
           string_agg(a.attname, ', ' order by k.ord) as columns,
           min(a.attname) as first_column
    from pg_constraint c
    cross join lateral unnest(c.conkey) with ordinality as k(attnum, ord)
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
    where c.contype = 'f'
      and c.connamespace = 'public'::regnamespace
    group by c.conrelid, c.conname, c.conkey
  )
  select fk.conrelid::regclass::text || '(' || fk.columns || ') ' || fk.conname
  from fk
  where not exists (
    select 1
    from pg_index i
    where i.indrelid = fk.conrelid
      and i.indnkeyatts >= cardinality(fk.conkey)
      and (string_to_array(i.indkey::text, ' ')::int2[])[1:cardinality(fk.conkey)] @> fk.conkey
      and fk.conkey @> (string_to_array(i.indkey::text, ' ')::int2[])[1:cardinality(fk.conkey)]
      and (
        i.indpred is null
        or (
          cardinality(fk.conkey) = 1
          and pg_get_expr(i.indpred, i.indrelid) = format('(%s IS NOT NULL)', quote_ident(fk.first_column))
        )
      )
  )
  order by 1
`;

let database: PostgresSession | null = null;

function db(): PostgresSession {
  if (!database) throw new Error("PostgreSQL session unavailable.");
  return database;
}

function lines(output: string): string[] {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function uncoveredForeignKeys(): string[] {
  return lines(db().sql(UNCOVERED_FOREIGN_KEYS_SQL));
}

function namesIn(path: string, pattern: RegExp): string[] {
  return [...readFileSync(path, "utf8").matchAll(pattern)]
    .map((match) => match[1] ?? "")
    .filter(Boolean)
    .sort();
}

const ADDED = namesIn(MIGRATION_PATH, /create index if not exists (\w+)/g);
const DROPPED = namesIn(ROLLBACK_PATH, /drop index if exists public\.(\w+)/g);

function presentIndexes(names: readonly string[]): string[] {
  const list = names.map((name) => `'${name}'`).join(", ");
  return lines(
    db().sql(`
      select indexname from pg_indexes
      where schemaname = 'public' and indexname in (${list})
      order by indexname
    `),
  );
}

beforeAll(async () => {
  if (skipReason) return;
  database = await startMigratedPostgres({ label: "fk-index", database: "pubmax_fk_index" });
}, 300_000);

afterAll(async () => {
  await database?.stop();
});

describe("0191 foreign key covering indexes, as text", () => {
  it("names every index on the convention and drops exactly those in the rollback", () => {
    expect(ADDED.length).toBeGreaterThan(0);
    expect(DROPPED).toEqual(ADDED);
    for (const name of ADDED) {
      expect(name, name).toMatch(/_fk_idx$/);
      expect(name.length, name).toBeLessThanOrEqual(63);
    }
  });
});

describe.skipIf(skipReason !== null)("0191 foreign key covering indexes", () => {
  it("leaves no foreign key in public without a covering index beyond the allowlist", () => {
    expect(uncoveredForeignKeys()).toEqual([...UNCOVERED_FOREIGN_KEY_ALLOWLIST]);
  });

  it("creates every index the migration names", () => {
    expect(presentIndexes(ADDED)).toEqual(ADDED);
  });

  it("rolls back to exactly the uncovered foreign keys, then re-applies", () => {
    db().applyFile(ROLLBACK_PATH);
    expect(presentIndexes(ADDED)).toEqual([]);
    expect(uncoveredForeignKeys().length).toBe(
      UNCOVERED_FOREIGN_KEY_ALLOWLIST.length + ADDED.length,
    );

    db().applyFile(MIGRATION_PATH);
    expect(presentIndexes(ADDED)).toEqual(ADDED);
    expect(uncoveredForeignKeys()).toEqual([...UNCOVERED_FOREIGN_KEY_ALLOWLIST]);
  });
});
