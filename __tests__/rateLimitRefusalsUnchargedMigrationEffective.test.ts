// Effective PostgreSQL proof for 0181.
//
// Before this migration both durable limiters stamp every call, so a refused
// call grows the key's hits past the limit. After 0181 a refused call keeps
// the window at the limit, the verdicts are unchanged, a refused round line
// writes no receipt, and the rollback puts the old charging back.

import { join } from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  postgresSkipReason,
  startPostgres,
  type PostgresSession,
} from "./helpers/postgres";

const skipReason = postgresSkipReason();

const MIGRATIONS = join(process.cwd(), "supabase/migrations");
const EXPIRY = join(MIGRATIONS, "20260806145644_0070_rate_limit_expiry.sql");
const FORWARD = join(MIGRATIONS, "20261017090000_0181_rate_limit_refusals_uncharged.sql");
const ROLLBACK = join(
  MIGRATIONS,
  "rollback/20261017090000_0181_rate_limit_refusals_uncharged_rollback.sql",
);

const SPEND = "11111111-1111-4111-8111-111111111181";

let session: PostgresSession | null = null;

function requireSession(): PostgresSession {
  if (!session) throw new Error("PostgreSQL session unavailable.");
  return session;
}

function flood(key: string, limit: number, calls: number): string[] {
  const verdicts: string[] = [];
  for (let i = 0; i < calls; i++) {
    verdicts.push(requireSession().sql(`select public.check_rate_limit('${key}', ${limit}, 60000)`));
  }
  return verdicts;
}

function stamps(key: string): string {
  return requireSession().sql(
    `select cardinality(hits) from public.rate_limits where key = '${key}'`,
  );
}

function chargeLine(lineIndex: number, limit: number): string {
  return requireSession().sql(
    `select public.charge_round_price_line('profile:test', 'round-key', ${limit}, ${lineIndex}, '${SPEND}', 60000)`,
  );
}

beforeAll(async () => {
  if (skipReason) return;
  session = await startPostgres({
    label: "rate-limit-refusals-0181",
    database: "pubmax_rate_limit_refusals",
  });
  // The pre-0070 shape 0070 is applied over, as in rateLimitExpiryMigration.
  session.sql(`
    create role anon noinherit;
    create role authenticated noinherit;
    create role service_role noinherit;

    create table public.rate_limits (
      key text primary key,
      hits timestamptz[] not null default '{}',
      updated_at timestamptz not null default now()
    );

    create table public.round_spends (
      id uuid primary key,
      items jsonb not null default '[]'::jsonb,
      promotion_actor text
    );

    create table public.round_price_line_charges (
      spend_id uuid not null references public.round_spends(id) on delete cascade,
      line_index integer not null,
      actor text not null,
      primary key (spend_id, line_index)
    );
  `);
  session.applyFile(EXPIRY);
}, 180_000);

beforeEach(() => {
  session?.sql(`
    truncate public.round_price_line_charges, public.round_spends, public.rate_limits;
    insert into public.round_spends (id, items, promotion_actor) values (
      '${SPEND}',
      '[{"promotionStatus":"pending"},{"promotionStatus":"pending"},{"promotionStatus":"pending"}]'::jsonb,
      'profile:test'
    );
  `);
});

afterAll(async () => {
  await session?.stop();
  session = null;
});

describe.skipIf(skipReason !== null)("0181 rate-limit refusals uncharged", () => {
  it("BEFORE: a refused call is still stamped", () => {
    expect(flood("flood", 2, 5)).toEqual(["f", "f", "t", "t", "t"]);
    expect(stamps("flood")).toBe("5");
  });

  it("keeps the verdicts and holds the window at the limit", () => {
    requireSession().applyFile(FORWARD);

    expect(flood("flood", 2, 5)).toEqual(["f", "f", "t", "t", "t"]);
    expect(stamps("flood")).toBe("2");
    // A zero budget refuses the first call and stores nothing.
    expect(flood("closed", 0, 2)).toEqual(["t", "t"]);
    expect(stamps("closed")).toBe("0");
  });

  it("frees the window once the admitted hits expire", () => {
    requireSession().sql(
      `insert into public.rate_limits (key, hits, expires_at)
       values ('aged', array[now() - interval '2 minutes', now() - interval '2 minutes'], now() + interval '1 minute')`,
    );
    expect(flood("aged", 2, 3)).toEqual(["f", "f", "t"]);
    expect(stamps("aged")).toBe("2");
  });

  it("refuses a round line past the budget without a receipt or a stamp", () => {
    expect(chargeLine(0, 1)).toBe("charged");
    expect(chargeLine(1, 1)).toBe("limited");
    expect(chargeLine(1, 1)).toBe("limited");
    expect(chargeLine(0, 1)).toBe("already_charged");
    expect(stamps("round-key")).toBe("1");
    expect(
      requireSession().sql(
        "select string_agg(line_index::text, ',' order by line_index) from public.round_price_line_charges",
      ),
    ).toBe("0");
  });

  it("admits one near-cap warning per lane and threshold during a concurrent cooldown", async () => {
    requireSession().applyFile(FORWARD);
    const warning80 = "select public.check_rate_limit('paid_spend.near_cap.ask.80', 1, 900000)";
    const verdicts = await requireSession().concurrentResults(Array(12).fill(warning80));
    expect(verdicts.filter((verdict) => verdict === "f")).toHaveLength(1);
    expect(verdicts.filter((verdict) => verdict === "t")).toHaveLength(11);
    expect(requireSession().sql(
      "select public.check_rate_limit('paid_spend.near_cap.ask.90', 1, 900000)",
    )).toBe("f");
    requireSession().sql(`update public.rate_limits
      set hits = array[now() - interval '16 minutes']
      where key = 'paid_spend.near_cap.ask.80'`);
    expect(requireSession().sql(warning80)).toBe("f");
  });

  it("rolls back to charging every call", () => {
    requireSession().applyFile(ROLLBACK);

    expect(flood("flood", 2, 5)).toEqual(["f", "f", "t", "t", "t"]);
    expect(stamps("flood")).toBe("5");
    expect(chargeLine(0, 1)).toBe("charged");
    expect(chargeLine(1, 1)).toBe("limited");
    expect(stamps("round-key")).toBe("2");
  });
});
