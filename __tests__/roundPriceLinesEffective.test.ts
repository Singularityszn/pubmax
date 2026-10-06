// The rounds price-line RPCs, proved on a cluster holding every migration:
// `public.reconcile_round_price_keys` and `public.transition_round_price_lines`.
//
// A round's spend lines can become community prices. The service-role store
// (`lib/roundsStore.ts`) hands both RPCs a spend id and the caller's actor key,
// and the RPCs own the money rules: only the actor who recorded a spend may move
// its lines; within one round an actor owns ONE line per pub and drink, the
// newest, and every older one is superseded; a line moves pending to ready to
// promoted, and reaches promoted only when the community price it became really
// exists. Concurrent transitions on one spend lose no line, and no browser role
// may call either function.

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  asBrowserRole,
  asServiceRole,
  postgresSkipReason,
  startMigratedPostgres,
  type PostgresSession,
} from "./helpers/postgres";

const skipReason = postgresSkipReason();

const ROUND = "f0000000-0000-4000-8000-000000000001";
const ALICE_ACTOR = "profile:a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1";
const BOB_ACTOR = "profile:b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2";
const ALICE = "a0000000-0000-4000-8000-000000000001";
/** Alice's first spend at the Crown: a beer, a wine and a demo line. */
const OLDER = "f1000000-0000-4000-8000-000000000001";
/** Alice's later spend at the Crown: a beer again, and a gin. */
const NEWER = "f1000000-0000-4000-8000-000000000002";
/** Bob's spend at the Crown, a beer: his to own, not Alice's to supersede. */
const BOBS = "f1000000-0000-4000-8000-000000000003";
/** Alice's spend whose lines walk the promotion ladder. */
const LADDER = "f1000000-0000-4000-8000-000000000004";
/** Alice's earlier beer at the Stag, never reconciled before its transition. */
const STALE = "f1000000-0000-4000-8000-000000000005";
/** Alice's later beer at the Stag, which owns the key. */
const FRESH = "f1000000-0000-4000-8000-000000000006";
const UNKNOWN_SPEND = "f1000000-0000-4000-8000-0000000000ff";

let session: PostgresSession | null = null;

function db(): PostgresSession {
  if (!session) throw new Error("PostgreSQL rounds session did not start.");
  return session;
}

type Line = { drinkCategory: string; source?: "round" | "demo"; promotionStatus?: string };

function itemsJson(lines: readonly Line[]): string {
  return JSON.stringify(
    lines.map((line) => ({
      name: line.drinkCategory,
      drinkCategory: line.drinkCategory,
      pricePence: 600,
      source: line.source ?? "round",
      promotionStatus: line.promotionStatus ?? "pending",
    })),
  );
}

function seedSpend(options: {
  id: string;
  clientRef: string;
  venueId: string;
  actor: string;
  recordedAt: string;
  lines: readonly Line[];
}): void {
  db().sql(`
    insert into public.round_spends (
      id, round_id, client_ref, payer_handle, recorded_by_handle,
      venue_id, venue_name, total_pence, items, recorded_at, promotion_actor
    ) values (
      '${options.id}', '${ROUND}', '${options.clientRef}', 'alice', 'alice',
      '${options.venueId}', 'The Pub', 1200, '${itemsJson(options.lines)}'::jsonb,
      timestamptz '${options.recordedAt}', '${options.actor}'
    )
  `);
}

/** Each line's promotion status, in order. */
function statuses(spendId: string): string {
  return db().sql(`
    select string_agg(item->>'promotionStatus', ',' order by ordinality)
    from public.round_spends, jsonb_array_elements(items) with ordinality as line(item, ordinality)
    where id = '${spendId}'
  `);
}

function reconcile(spendId: string, actor: string): string {
  return `select public.reconcile_round_price_keys('${spendId}', '${actor}')`;
}

function transition(spendId: string, actor: string, updates: unknown): string {
  return `select public.transition_round_price_lines('${spendId}', '${actor}', '${JSON.stringify(updates)}'::jsonb)`;
}

beforeAll(async () => {
  if (skipReason) return;
  session = await startMigratedPostgres({
    label: "round-price",
    database: "pubmax_round_price",
  });
  db().sql(`
    insert into public.rounds (id, code, title, created_by_handle)
    values ('${ROUND}', 'ROUNDPROOF', 'Friday', 'alice')
  `);
  seedSpend({
    id: OLDER,
    clientRef: "older",
    venueId: "venue-crown",
    actor: ALICE_ACTOR,
    recordedAt: "2026-10-02 19:00:00+01",
    lines: [{ drinkCategory: "beer" }, { drinkCategory: "wine" }, { drinkCategory: "beer", source: "demo" }],
  });
  seedSpend({
    id: NEWER,
    clientRef: "newer",
    venueId: "venue-crown",
    actor: ALICE_ACTOR,
    recordedAt: "2026-10-02 20:00:00+01",
    lines: [{ drinkCategory: "beer" }, { drinkCategory: "gin" }],
  });
  seedSpend({
    id: BOBS,
    clientRef: "bobs",
    venueId: "venue-crown",
    actor: BOB_ACTOR,
    recordedAt: "2026-10-02 21:00:00+01",
    lines: [{ drinkCategory: "beer" }],
  });
  seedSpend({
    id: LADDER,
    clientRef: "ladder",
    venueId: "venue-ladder",
    actor: ALICE_ACTOR,
    recordedAt: "2026-10-02 18:00:00+01",
    lines: [
      { drinkCategory: "beer" },
      { drinkCategory: "wine" },
      { drinkCategory: "gin" },
      { drinkCategory: "rum", source: "demo" },
      { drinkCategory: "vodka" },
    ],
  });
}, 180_000);

afterAll(async () => {
  await session?.stop();
});

describe.skipIf(skipReason !== null)("reconcile_round_price_keys", () => {
  it("refuses a blank actor, an unknown spend and another actor's spend, and moves nothing", () => {
    expect(db().sql(asServiceRole(reconcile(OLDER, "  ")))).toBe("forbidden");
    expect(db().sql(asServiceRole(reconcile(UNKNOWN_SPEND, ALICE_ACTOR)))).toBe("not_found");
    expect(db().sql(asServiceRole(reconcile(OLDER, BOB_ACTOR)))).toBe("forbidden");
    expect(statuses(OLDER)).toBe("pending,pending,pending");
  });

  it("keeps the newest line per pub and drink and supersedes the older one", () => {
    expect(db().sql(asServiceRole(reconcile(OLDER, ALICE_ACTOR)))).toBe("ok");
    // The older beer loses to the newer beer; the wine is the only wine; the
    // demo line is not a round price and is never touched.
    expect(statuses(OLDER)).toBe("superseded,pending,pending");
    expect(statuses(NEWER)).toBe("pending,pending");
    // Bob's beer at the same pub is his own key, not Alice's to supersede.
    expect(statuses(BOBS)).toBe("pending");
  });

  it("is idempotent", () => {
    expect(db().sql(asServiceRole(reconcile(NEWER, ALICE_ACTOR)))).toBe("ok");
    expect(statuses(OLDER)).toBe("superseded,pending,pending");
    expect(statuses(NEWER)).toBe("pending,pending");
  });
});

describe.skipIf(skipReason !== null)("transition_round_price_lines", () => {
  it("refuses a blank actor, a non-array update, an unknown spend and another actor", () => {
    expect(db().sql(asServiceRole(transition(LADDER, "", [{ index: 0, status: "ready" }])))).toBe("forbidden");
    expect(db().sql(asServiceRole(transition(LADDER, ALICE_ACTOR, { index: 0, status: "ready" })))).toBe("forbidden");
    expect(db().sql(asServiceRole(transition(UNKNOWN_SPEND, ALICE_ACTOR, [])))).toBe("not_found");
    expect(db().sql(asServiceRole(transition(LADDER, BOB_ACTOR, [{ index: 0, status: "ready" }])))).toBe("forbidden");
    expect(statuses(LADDER)).toBe("pending,pending,pending,pending,pending");
  });

  it("moves pending to ready, and skips a demo line, a bad index and a skipped rung", () => {
    expect(
      db().sql(
        asServiceRole(transition(LADDER, ALICE_ACTOR, [
          { index: 0, status: "ready" },
          { index: 1, status: "promoted" },
          { index: 3, status: "ready" },
          { index: "2", status: "ready" },
          { index: -1, status: "ready" },
          { index: 99, status: "ready" },
          "not an object",
        ])),
      ),
    ).toBe("ok");
    expect(statuses(LADDER)).toBe("ready,pending,ready,pending,pending");
  });

  it("promotes a ready line only once its community price exists", () => {
    expect(db().sql(asServiceRole(transition(LADDER, ALICE_ACTOR, [{ index: 0, status: "promoted" }])))).toBe("ok");
    expect(statuses(LADDER)).toBe("ready,pending,ready,pending,pending");

    // A price at the right line but written by somebody else does not count.
    db().sql(`
      insert into public.community_prices (venue_id, drink_category, price_pennies, actor, round_spend_id, round_line_index)
      values ('venue-ladder', 'beer', 600, '${BOB_ACTOR}', '${LADDER}', 0)
    `);
    expect(db().sql(asServiceRole(transition(LADDER, ALICE_ACTOR, [{ index: 0, status: "promoted" }])))).toBe("ok");
    expect(statuses(LADDER)).toBe("ready,pending,ready,pending,pending");

    db().sql(`
      delete from public.community_prices where round_spend_id = '${LADDER}';
      insert into public.community_prices (venue_id, drink_category, price_pennies, actor, round_spend_id, round_line_index)
      values ('venue-ladder', 'beer', 600, '${ALICE_ACTOR}', '${LADDER}', 0)
    `);
    expect(db().sql(asServiceRole(transition(LADDER, ALICE_ACTOR, [{ index: 0, status: "promoted" }])))).toBe("ok");
    expect(statuses(LADDER)).toBe("promoted,pending,ready,pending,pending");
  });

  it("supersedes a pending, ready or promoted line, and never revives one", () => {
    expect(
      db().sql(
        asServiceRole(transition(LADDER, ALICE_ACTOR, [
          { index: 0, status: "superseded" },
          { index: 2, status: "superseded" },
        ])),
      ),
    ).toBe("ok");
    expect(statuses(LADDER)).toBe("superseded,pending,superseded,pending,pending");
    expect(
      db().sql(
        asServiceRole(transition(LADDER, ALICE_ACTOR, [
          { index: 0, status: "ready" },
          { index: 2, status: "pending" },
        ])),
      ),
    ).toBe("ok");
    expect(statuses(LADDER)).toBe("superseded,pending,superseded,pending,pending");
  });

  it("supersedes the older line itself before it moves anything", () => {
    seedSpend({
      id: STALE,
      clientRef: "stale",
      venueId: "venue-stag",
      actor: ALICE_ACTOR,
      recordedAt: "2026-10-02 19:00:00+01",
      lines: [{ drinkCategory: "beer" }],
    });
    seedSpend({
      id: FRESH,
      clientRef: "fresh",
      venueId: "venue-stag",
      actor: ALICE_ACTOR,
      recordedAt: "2026-10-02 20:00:00+01",
      lines: [{ drinkCategory: "beer" }],
    });
    // No reconcile has run for the Stag: FRESH's beer owns the key, so the
    // transition itself supersedes STALE's beer instead of readying it.
    expect(db().sql(asServiceRole(transition(STALE, ALICE_ACTOR, [{ index: 0, status: "ready" }])))).toBe("ok");
    expect(statuses(STALE)).toBe("superseded");
    expect(statuses(FRESH)).toBe("pending");
  });

  it("loses no line when two transitions on one spend land at once", async () => {
    await db().concurrent([
      asServiceRole(transition(LADDER, ALICE_ACTOR, [{ index: 1, status: "ready" }])),
      asServiceRole(transition(LADDER, ALICE_ACTOR, [{ index: 4, status: "ready" }])),
    ]);
    expect(statuses(LADDER)).toBe("superseded,ready,superseded,pending,ready");
  });
});

describe.skipIf(skipReason !== null)("the rounds RPCs and the browser roles", () => {
  it("refuses anon and a signed-in account on both functions, and nothing moves", async () => {
    const before = [statuses(OLDER), statuses(NEWER), statuses(LADDER)];
    for (const [role, sub] of [
      ["anon", null],
      ["authenticated", ALICE],
    ] as const) {
      const reconciled = await db().attempt(asBrowserRole(role, sub, reconcile(NEWER, ALICE_ACTOR)));
      expect(reconciled.ok, `${role} must not reconcile a round`).toBe(false);
      expect(reconciled.said).toMatch(/permission denied for function reconcile_round_price_keys/);

      const moved = await db().attempt(
        asBrowserRole(role, sub, transition(NEWER, ALICE_ACTOR, [{ index: 1, status: "ready" }])),
      );
      expect(moved.ok, `${role} must not move a round line`).toBe(false);
      expect(moved.said).toMatch(/permission denied for function transition_round_price_lines/);
    }
    expect([statuses(OLDER), statuses(NEWER), statuses(LADDER)]).toEqual(before);
  });
});
