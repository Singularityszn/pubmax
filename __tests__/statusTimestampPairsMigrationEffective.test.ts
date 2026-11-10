import { readdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { postgresSkipReason, startPostgres, type PostgresSession } from "./helpers/postgres";

const skipReason = postgresSkipReason();
const directory = join(process.cwd(), "supabase/migrations");
const name = "20261110080000_0227_status_timestamp_pairs.sql";
const rollback = join(directory, "rollback/20261110080000_0227_status_timestamp_pairs_rollback.sql");
const HASH = "a".repeat(64);
const PAIRS = ["social_post_videos_review_pair_check", "venue_submissions_review_pair_check",
  "wanteds_fulfilled_pair_check", "analytics_event_receipts_delivered_pair_check",
  "social_posts_moderated_pair_check", "regular_night_reports_confirmed_pair_check"].map((pair) => `'${pair}'`).join(", ");
let session: PostgresSession | null = null;
function db() { if (!session) throw new Error("No test cluster"); return session; }

function outcome(statement: string): "ok" | "refused" {
  try {
    db().sql(statement);
    return "ok";
  } catch {
    return "refused";
  }
}

function wanted(id: string, status: string, fulfilledAt: string): string {
  return `insert into public.wanteds(id, owner_actor, venue_kind, venue_id, status, fulfilled_at)
    values ('${id}', 'profile:00000000-0000-4000-8000-000000000001', 'curated', 'venue-crown', '${status}', ${fulfilledAt})`;
}

function receipt(id: string, status: string, deliveredAt: string): string {
  return `insert into public.analytics_event_receipts(event_id, token_hash, event_name, status, lease_until, delivered_at)
    values ('${id}', '${id.replace(/-/g, "").padEnd(64, "0").slice(0, 64)}', 'pint_drop', '${status}', now(), ${deliveredAt})`;
}

beforeAll(async () => {
  if (skipReason) return;
  session = await startPostgres({ label: "status-timestamp-pairs-0227", database: "pubmax_status_pairs" });
  try {
    db().applyFile(join(process.cwd(), "scripts/rls/session-fixture.sql"));
    for (const file of readdirSync(directory).filter((entry) => entry.endsWith(".sql") && entry < name).sort()) db().applyFile(join(directory, file));
  } catch (error) { await session.stop(); session = null; throw error; }
}, 180_000);
afterAll(async () => { await session?.stop(); });

describe.skipIf(skipReason !== null)("0227 status and timestamp pairs", () => {
  it("accepts a contradictory pair before the migration, and the migration refuses to validate over it", () => {
    expect(outcome(wanted("11111111-1111-4111-8111-111111111111", "fulfilled", "null"))).toBe("ok");
    expect(() => db().applyFile(join(directory, name))).toThrow();
    // The whole migration rolled back: no constraint was left behind.
    expect(db().sql("select count(*) from pg_constraint where conname = 'wanteds_fulfilled_pair_check'")).toBe("0");
    db().sql("delete from public.wanteds where id = '11111111-1111-4111-8111-111111111111'");
  });

  it("then applies, twice, and refuses every contradictory shape", () => {
    db().applyFile(join(directory, name));
    db().applyFile(join(directory, name));
    expect(db().sql(`select count(*) from pg_constraint where convalidated and conname = any (array[${PAIRS}])`)).toBe("6");

    expect(outcome(wanted("22222222-2222-4222-8222-222222222222", "open", "null"))).toBe("ok");
    expect(outcome(wanted("33333333-3333-4333-8333-333333333333", "fulfilled", "now()"))).toBe("ok");
    expect(outcome(wanted("44444444-4444-4444-8444-444444444444", "fulfilled", "null"))).toBe("refused");
    expect(outcome(wanted("55555555-5555-4555-8555-555555555555", "open", "now()"))).toBe("refused");

    expect(outcome(receipt("66666666-6666-4666-8666-666666666666", "pending", "now()"))).toBe("refused");
    expect(outcome(receipt("77777777-7777-4777-8777-777777777777", "delivered", "null"))).toBe("refused");
  });

  it("keeps the analytics receipt writers working", () => {
    const id = "88888888-8888-4888-8888-888888888888";
    expect(db().sql(`select public.claim_analytics_event_receipt('${id}', '${HASH}', 'pint_drop', now(), now() + interval '1 minute')`)).not.toBe("");
    expect(db().sql(`select public.complete_analytics_event_receipt('${id}', now())`)).toBe("t");
    expect(db().sql(`select status || ':' || (delivered_at is not null) from public.analytics_event_receipts where event_id = '${id}'`))
      .toBe("delivered:true");
  });

  it("lets a hidden regular night keep the confirmation it earned, but never an open one", () => {
    const user = "99999999-9999-4999-8999-999999999999";
    db().sql(`insert into auth.users(id) values ('${user}') on conflict do nothing`);
    const night = (id: string, status: string, confirmed: boolean) => `insert into public.regular_night_reports
      (id, venue_id, kind, weekday, photo_key, reporter_user_id, status, confirmed_by, confirmed_at)
      values ('${id}', 'venue-crown', 'quiz', 2,
        'regular-night-boards/${user}/${id}.jpg', '${user}', '${status}',
        ${confirmed ? "'moderator'" : "null"}, ${confirmed ? "now()" : "null"})`;
    expect(outcome(night("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", "hidden", true))).toBe("ok");
    expect(outcome(night("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2", "hidden", false))).toBe("ok");
    expect(outcome(night("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3", "open", true))).toBe("refused");
    expect(outcome(night("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4", "confirmed", false))).toBe("refused");
  });

  it("rollback drops the pairs and changes no row", () => {
    const before = db().sql("select count(*) from public.wanteds");
    db().applyFile(rollback);
    expect(db().sql("select count(*) from public.wanteds")).toBe(before);
    expect(outcome(wanted("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "fulfilled", "null"))).toBe("ok");
    expect(db().sql(`select count(*) from pg_constraint where conname = any (array[${PAIRS}])`)).toBe("0");
  });
});
