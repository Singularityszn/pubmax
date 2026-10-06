// `public.report_community_price`, proved on a cluster holding every migration.
//
// The RPC is the one write behind "this price looks wrong": the service-role
// store (`lib/communityPriceStore.ts`) hands it the price id, a hashed actor and
// a reason. The count it keeps must mean "how many different people", so a
// repeat from one actor, even a concurrent burst of them, moves it once. The
// function runs with its caller's rights and keeps the default EXECUTE, so the
// browser roles are held out by the table grants under it, and this file proves
// that the refusal really lands for anon and for a signed-in account.

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  asBrowserRole,
  asServiceRole,
  postgresSkipReason,
  startMigratedPostgres,
  type PostgresSession,
} from "./helpers/postgres";

const skipReason = postgresSkipReason();

const PRICE = "c0000000-0000-4000-8000-0000000000a1";
const BURST_PRICE = "c0000000-0000-4000-8000-0000000000a2";
const CROWD_PRICE = "c0000000-0000-4000-8000-0000000000a3";
const BROWSER_PRICE = "c0000000-0000-4000-8000-0000000000a4";
const UNKNOWN_PRICE = "c0000000-0000-4000-8000-0000000000ff";
const ALICE = "a0000000-0000-4000-8000-000000000001";

let session: PostgresSession | null = null;

function db(): PostgresSession {
  if (!session) throw new Error("PostgreSQL community price session did not start.");
  return session;
}

function seedPrice(id: string, venueId: string): void {
  db().sql(`
    insert into public.community_prices (id, venue_id, drink_category, price_pennies, actor)
    values ('${id}', '${venueId}', 'beer', 650, 'profile:seed-${venueId}')
  `);
}

function report(id: string, actorHash: string | null, reason: string | null): string {
  const quote = (value: string | null) => (value === null ? "null" : `'${value}'`);
  return `select coalesce(public.report_community_price('${id}', ${quote(actorHash)}, ${quote(reason)})::text, 'null')`;
}

function counts(id: string): string {
  return db().sql(`
    select p.report_count || '|' || (select count(*) from public.community_price_reports r where r.community_price_id = p.id)
    from public.community_prices p where p.id = '${id}'
  `);
}

beforeAll(async () => {
  if (skipReason) return;
  session = await startMigratedPostgres({
    label: "price-report",
    database: "pubmax_price_report",
  });
  seedPrice(PRICE, "venue-report-one");
  seedPrice(BURST_PRICE, "venue-report-burst");
  seedPrice(CROWD_PRICE, "venue-report-crowd");
  seedPrice(BROWSER_PRICE, "venue-report-browser");
}, 180_000);

afterAll(async () => {
  await session?.stop();
});

describe.skipIf(skipReason !== null)("report_community_price", () => {
  it("flags the price on a first report and keeps the reason", () => {
    expect(db().sql(asServiceRole(report(PRICE, "actor-a", "wrong pub")))).toBe("true");
    expect(counts(PRICE)).toBe("1|1");
    expect(
      db().sql(`
        select report_reason || '|' || (reported_at is not null)
        from public.community_prices where id = '${PRICE}'
      `),
    ).toBe("wrong pub|true");
  });

  it("answers yes to the same actor again without moving the count", () => {
    expect(db().sql(asServiceRole(report(PRICE, "actor-a", "still wrong")))).toBe("true");
    expect(counts(PRICE)).toBe("1|1");
    expect(db().sql(`select report_reason from public.community_prices where id = '${PRICE}'`)).toBe(
      "wrong pub",
    );
  });

  it("counts a different actor, and a blank reason keeps the last one given", () => {
    expect(db().sql(asServiceRole(report(PRICE, "actor-b", "")))).toBe("true");
    expect(counts(PRICE)).toBe("2|2");
    expect(db().sql(`select report_reason from public.community_prices where id = '${PRICE}'`)).toBe(
      "wrong pub",
    );
  });

  it("answers null for a price that does not exist and writes nothing", () => {
    expect(db().sql(asServiceRole(report(UNKNOWN_PRICE, "actor-a", "ghost")))).toBe("null");
    expect(
      db().sql(
        `select count(*) from public.community_price_reports where community_price_id = '${UNKNOWN_PRICE}'`,
      ),
    ).toBe("0");
  });

  it("moves the count once for a concurrent burst from one actor", async () => {
    const answers = await db().concurrentResults(
      Array.from({ length: 8 }, () => asServiceRole(report(BURST_PRICE, "actor-burst", "burst"))),
    );
    expect(answers).toEqual(Array.from({ length: 8 }, () => "true"));
    expect(counts(BURST_PRICE)).toBe("1|1");
  });

  it("counts every one of a concurrent crowd of different actors", async () => {
    const answers = await db().concurrentResults(
      Array.from({ length: 6 }, (_, index) =>
        asServiceRole(report(CROWD_PRICE, `actor-crowd-${index}`, "crowd")),
      ),
    );
    expect(answers).toEqual(Array.from({ length: 6 }, () => "true"));
    expect(counts(CROWD_PRICE)).toBe("6|6");
  });

  it("refuses anon and a signed-in account, and the price stays unflagged", async () => {
    for (const [role, sub] of [
      ["anon", null],
      ["authenticated", ALICE],
    ] as const) {
      const answer = await db().attempt(
        asBrowserRole(role, sub, report(BROWSER_PRICE, `actor-${role}`, "browser")),
      );
      expect(answer.ok, `${role} must not report a price itself`).toBe(false);
      expect(answer.said).toMatch(/permission denied for table community_price/);
    }
    expect(counts(BROWSER_PRICE)).toBe("0|0");
    expect(
      db().sql(`select reported_at is null from public.community_prices where id = '${BROWSER_PRICE}'`),
    ).toBe("t");
  });
});
