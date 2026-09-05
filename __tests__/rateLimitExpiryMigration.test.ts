import { join } from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  postgresSkipReason,
  startPostgres,
  type PostgresSession,
} from "./helpers/postgres";

const skipReason = postgresSkipReason();

const MIGRATION_PATH = join(
  process.cwd(),
  "supabase/migrations/20260806145644_0070_rate_limit_expiry.sql",
);

let session: PostgresSession | null = null;

beforeAll(async () => {
  if (skipReason) return;
  session = await startPostgres({
    label: "rate-limit-expiry-0125",
    database: "pubmax_rate_limit_expiry",
  });
  // The pre-0070 shape the migration is applied over.
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
  session.applyFile(MIGRATION_PATH);
}, 180_000);

beforeEach(() => {
  session?.sql("truncate public.round_price_line_charges, public.round_spends, public.rate_limits");
});

afterAll(async () => {
  await session?.stop();
});

function requireSession(): PostgresSession {
  if (!session) throw new Error("PostgreSQL expiry session did not start.");
  return session;
}

function seedExpiredAndFreshRows(): void {
  requireSession().sql(`
    insert into public.rate_limits (key, expires_at) values
      ('expired', now() - interval '1 minute'),
      ('fresh', now() + interval '1 hour');
  `);
}

function storedKeys(): string[] {
  const output = requireSession().sql(
    "select key from public.rate_limits order by key",
  );
  return output ? output.split("\n") : [];
}

describe.skipIf(skipReason !== null)("durable rate-limit expiry migration", () => {
  it("deletes an expired row and preserves a fresh row", () => {
    seedExpiredAndFreshRows();

    expect(requireSession().sql("select public.prune_expired_rate_limits()"))
      .toBe("1");
    expect(storedKeys()).toEqual(["fresh"]);
  });

  it("prunes expired rows when check_rate_limit records a hit", () => {
    seedExpiredAndFreshRows();

    expect(requireSession().sql(
      "select public.check_rate_limit('check-writer', 10, 60000)",
    )).toBe("f");
    expect(storedKeys()).toEqual(["check-writer", "fresh"]);
  });

  it("prunes expired rows when charge_round_price_line records a hit", () => {
    seedExpiredAndFreshRows();
    requireSession().sql(`
      insert into public.round_spends (id, items, promotion_actor)
      values (
        '11111111-1111-4111-8111-111111111111',
        '[{"promotionStatus":"pending"}]'::jsonb,
        'profile:test'
      );
    `);

    expect(requireSession().sql(`
      select public.charge_round_price_line(
        'profile:test',
        'round-writer',
        10,
        0,
        '11111111-1111-4111-8111-111111111111',
        60000
      )
    `)).toBe("charged");
    expect(storedKeys()).toEqual(["fresh", "round-writer"]);
  });
});
