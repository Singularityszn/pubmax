import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const MIGRATION = join(
  process.cwd(),
  "supabase/migrations/20260831140000_0128_price_trust_visibility_queue.sql",
);
const ROLLBACK = join(
  process.cwd(),
  "supabase/migrations/rollback/20260831140000_0128_price_trust_visibility_queue_rollback.sql",
);
const BASE_MIGRATION = join(
  process.cwd(),
  "supabase/migrations/20260831120000_0126_price_trust_reconciliation_queue.sql",
);

function compactSql(path: string): string {
  return existsSync(path)
    ? readFileSync(path, "utf8").replace(/\s+/g, " ")
    : "";
}

function functionDefinition(path: string): string {
  const sql = compactSql(path);
  const start = sql.indexOf(
    "create or replace function public.queue_community_price_trust_reconciliation()",
  );
  const end = sql.indexOf(" $$;", start);
  return start >= 0 && end >= 0 ? sql.slice(start, end + 4) : "";
}

describe("0128 price trust visibility queue fence", () => {
  it("queues moderation visibility changes through the existing trust worker", () => {
    expect(existsSync(MIGRATION)).toBe(true);
    const sql = compactSql(MIGRATION);

    expect(sql).toMatch(
      /after insert or update of venue_id, drink_category, price_pennies, actor, submitted_at, hidden_at on public\.community_prices/,
    );
    expect(sql).toMatch(
      /execute function public\.queue_community_price_trust_reconciliation\(\)/,
    );
    expect(sql).toMatch(
      /create or replace function public\.queue_community_price_trust_reconciliation\(\)/,
    );
    expect(sql).toMatch(/new\.hidden_at is distinct from old\.hidden_at/);
    expect(sql).toMatch(
      /if new\.drink_category is not null and \( new\.actor is not null or \( tg_op = 'UPDATE'/,
    );
    expect(sql).not.toMatch(/create table/i);
  });

  it("queues every existing price Venue-category pair once", () => {
    const sql = compactSql(MIGRATION);

    expect(sql).toMatch(
      /insert into public\.price_trust_reconciliation_queue as queue \( venue_id, category, version, enqueued_at \)/,
    );
    expect(sql).toMatch(
      /select distinct btrim\(price\.venue_id\) as venue_id, price\.drink_category as category from public\.community_prices as price/,
    );
    expect(sql).toMatch(
      /where price\.drink_category is not null and nullif\(btrim\(price\.venue_id\), ''\) is not null/,
    );
    expect(sql).not.toMatch(/where price\.actor is not null/);
    expect(sql).toMatch(
      /on conflict on constraint price_trust_reconciliation_queue_pkey do update set version = nextval\('public\.price_trust_reconciliation_version_seq'\)/,
    );
  });

  it("restores the 0126 trigger shape on rollback", () => {
    expect(existsSync(ROLLBACK)).toBe(true);
    const sql = compactSql(ROLLBACK);

    expect(sql).toMatch(
      /after insert or update of venue_id, drink_category, price_pennies, actor, submitted_at on public\.community_prices/,
    );
    expect(sql).not.toMatch(/update of [^;]*hidden_at/i);
    expect(sql).not.toMatch(/new\.hidden_at/);
    expect(sql).toMatch(/old\.actor is not null and old\.drink_category is not null/);
    expect(sql).toMatch(/if new\.actor is not null and new\.drink_category is not null/);
    expect(sql).toMatch(
      /execute function public\.queue_community_price_trust_reconciliation\(\)/,
    );
    expect(functionDefinition(ROLLBACK)).toBe(functionDefinition(BASE_MIGRATION));
  });
});
