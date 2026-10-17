// Migration 0180, proved against a real PostgreSQL 16 holding every migration
// before it.
//
// DB-3: the tombstone trigger (0150, last restated by 0156) matched only the
// CURRENT `profiles.handle`. `rename_pubmaxx_handle` never rewrites an authored
// row, so everything an account wrote under an earlier handle was invisible to
// its own deletion: the retired name stayed printed on a Pint Drop, a visit
// report and a weather pick with no stamp, the retention ledger counted only
// the rows under the current handle, a group seat taken under the old handle
// stayed live, and a poll answer given under it stayed in the table.
//
// DB-4: the deletion compared `lower(handle)` on tables with no index for it
// and ORed two identities in one message UPDATE, so it scanned while the auth
// delete held; four auth foreign keys had no covering index for the cascade.
//
//   BEFORE 0180: an account claims a handle, writes under it, renames, writes
//                again and leaves. Every old-handle fault is reproduced, and the
//                deletion's lookups plan as sequential scans.
//   AFTER  0180: a second account does the same. Every lane is stamped, the
//                ledger names every row under both handles, the old seat is
//                closed, the old vote is gone, the old attachment is cleared,
//                a live account is untouched, and the lookups plan on indexes.
//   ROLLBACK:    0156's function comes back byte for byte, the indexes go, a
//                third account leaves the pre-0180 way, and the forward file
//                re-applies.

import { readdirSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  asServiceRole,
  postgresSkipReason,
  startPostgres,
  type PostgresSession,
} from "./helpers/postgres";

const skipReason = postgresSkipReason();

const ROOT = process.cwd();
const MIGRATIONS = join(ROOT, "supabase/migrations");
const FORWARD_NAME = "20261016110000_0180_account_deletion_every_handle.sql";
const FORWARD = join(MIGRATIONS, FORWARD_NAME);
const ROLLBACK = join(
  MIGRATIONS,
  "rollback/20261016110000_0180_account_deletion_every_handle_rollback.sql",
);
const SESSION_FIXTURE = join(ROOT, "scripts/rls/session-fixture.sql");
const PREREQUISITES = readdirSync(MIGRATIONS)
  .filter((name) => name.endsWith(".sql") && name < FORWARD_NAME)
  .sort()
  .map((name) => join(MIGRATIONS, name));

const VENUE = "venue-1vle947";
const STAYER = "d0000000-0000-4000-8000-0000000000d4";
const BUSY_GROUP = "e0000000-0000-4000-8000-0000000000e5";
const BUSY_POLL = "e0000000-0000-4000-8000-0000000000e6";

type Renamed = {
  userId: string;
  oldHandle: string;
  newHandle: string;
  oldDrop: string;
  newDrop: string;
  oldReport: string;
  oldRecommendation: string;
  group: string;
  poll: string;
  oldPhoto: string;
  stayerDrop: string;
};

function account(n: number, oldHandle: string, newHandle: string): Renamed {
  const id = (lane: number) => `${n}${lane}000000-0000-4000-8000-0000000000${n}${lane}`;
  return {
    userId: `${n}0000000-0000-4000-8000-0000000000${n}0`,
    oldHandle,
    newHandle,
    oldDrop: id(1),
    newDrop: id(2),
    oldReport: id(3),
    oldRecommendation: id(4),
    group: id(5),
    poll: id(6),
    oldPhoto: id(7),
    stayerDrop: id(8),
  };
}

/** Leaves before 0180, after 0180, and under the rollback. */
const EARLY = account(1, "carla", "carlb");
const LEAVER = account(2, "dana", "danb");
const LATE = account(3, "erin", "erib");

let database: PostgresSession | null = null;

function db(): PostgresSession {
  if (!database) throw new Error("the 0180 proof cluster is not running");
  return database;
}

function value(statement: string): string {
  return db().sql(statement);
}

function rpc(statement: string): Record<string, unknown> {
  return JSON.parse(db().sql(asServiceRole(statement))) as Record<string, unknown>;
}

/**
 * Claims a handle through the real RPC, writes in every handle-keyed lane under
 * it, renames through the real RPC, and writes one more drop under the new one.
 */
function seedRenamed(a: Renamed): void {
  db().sql(`insert into auth.users (id) values ('${a.userId}');`);
  expect(rpc(`select public.claim_pubmaxx_handle('${a.userId}', '${a.oldHandle}')::text`).ok).toBe(true);
  db().sql(`
    insert into public.pint_drops (id, venue_id, handle, drink, price_gbp, provenance, status, created_at)
      values ('${a.oldDrop}', '${VENUE}', '${a.oldHandle}', 'Lager', 4.50, 'contributor', 'visible', now() - interval '3 days');
    insert into public.structured_visit_reports (id, venue_id, handle, visited_at, busyness, note)
      values ('${a.oldReport}', '${VENUE}', '${a.oldHandle}', date '2026-09-01', 'steady', 'Quiet corner by the window.');
    insert into public.weather_recommendations (id, venue_id, condition, reason, contributor_handle, actor_hash)
      values ('${a.oldRecommendation}', '${VENUE}', 'raining', 'The back room stays dry and the fire is on.', '${a.oldHandle}', 'hash-${a.oldHandle}');
    insert into public.conversations (id, kind, title, created_by_handle)
      values ('${a.group}', 'group', 'Friday session', 'stayer');
    insert into public.conversation_members (conversation_id, handle, role) values
      ('${a.group}', 'stayer', 'owner'),
      ('${a.group}', '${a.oldHandle}', 'member');
    insert into public.messages (id, conversation_id, sender_handle, body, attachment_kind, attachment_poll_question, attachment_poll_options)
      values ('${a.poll}', '${a.group}', 'stayer', '', 'poll', 'Where first?', '["The Blackfriar","The Harp"]'::jsonb);
    insert into public.message_poll_votes (message_id, voter_handle, option_index) values
      ('${a.poll}', '${a.oldHandle}', 1),
      ('${a.poll}', 'stayer', 0);
    insert into public.messages (id, conversation_id, sender_handle, body, attachment_kind, attachment_object_key, attachment_width, attachment_height)
      values ('${a.oldPhoto}', '${a.group}', '${a.oldHandle}', 'before the rename', 'photo', 'messages/${a.group}/${a.oldPhoto}.jpg', 800, 600);
    -- A row the 0151 backfill could not resolve: the handle is the only identity it has.
    update public.messages set sender_profile_id = null where id = '${a.oldPhoto}';
    insert into public.pint_drops (id, venue_id, handle, drink, price_gbp, provenance, status, created_at)
      values ('${a.stayerDrop}', '${VENUE}', 'stayer', 'Stout', 5.10, 'contributor', 'visible', now() - interval '3 days');
  `);
  expect(rpc(`select public.rename_pubmaxx_handle('${a.userId}', '${a.newHandle}')::text`).ok).toBe(true);
  db().sql(`
    insert into public.pint_drops (id, venue_id, handle, drink, price_gbp, provenance, status, created_at)
      values ('${a.newDrop}', '${VENUE}', '${a.newHandle}', 'Lager', 4.60, 'contributor', 'visible', now() - interval '1 day');
  `);
}

function stamped(table: string, id: string): string {
  return value(`select (author_retired_at is not null)::text from public.${table} where id = '${id}'`);
}

function ledger(a: Renamed, column: string): string {
  return value(
    `select array_to_string(${column}, ',') from public.account_retention_ledger where account_user_id = '${a.userId}'`,
  );
}

/** What the old-handle lanes say after the account left. */
function oldHandleFootprint(a: Renamed) {
  return {
    oldDropStamped: stamped("pint_drops", a.oldDrop),
    newDropStamped: stamped("pint_drops", a.newDrop),
    reportStamped: stamped("structured_visit_reports", a.oldReport),
    recommendationStamped: stamped("weather_recommendations", a.oldRecommendation),
    ledgerDrops: ledger(a, "pint_drop_ids"),
    ledgerReports: ledger(a, "visit_report_ids"),
    ledgerRecommendations: ledger(a, "weather_recommendation_ids"),
    seatLive: value(
      `select (left_at is null)::text from public.conversation_members where conversation_id = '${a.group}' and handle = '${a.oldHandle}'`,
    ),
    voteKept: value(
      `select count(*)::text from public.message_poll_votes where message_id = '${a.poll}' and voter_handle = '${a.oldHandle}'`,
    ),
    photoKept: value(
      `select (attachment_object_key is not null)::text from public.messages where id = '${a.oldPhoto}'`,
    ),
  };
}

/** What a live account's rows say: nothing about them may move. */
function stayerUntouched(a: Renamed): void {
  expect(stamped("pint_drops", a.stayerDrop)).toBe("false");
  expect(
    value(
      `select (left_at is null)::text from public.conversation_members where conversation_id = '${a.group}' and handle = 'stayer'`,
    ),
  ).toBe("true");
  expect(
    value(`select count(*)::text from public.message_poll_votes where message_id = '${a.poll}' and voter_handle = 'stayer'`),
  ).toBe("1");
  expect(value(`select attachment_kind from public.messages where id = '${a.poll}'`)).toBe("poll");
}

/** The deletion's own lookups, planned with sequential scans priced out. */
const LOOKUPS = {
  sender: "select id from public.messages where attachment_kind is not null and lower(sender_handle) = any(array['carla','carlb'])",
  voter: "select message_id from public.message_poll_votes where lower(voter_handle) = any(array['carla','carlb'])",
  hostEditor: `select id from public.night_stories where host_editor_id = '${STAYER}'`,
  proposals: `select id from public.night_story_publish_proposals where requested_by = '${STAYER}'`,
  occupancy: `select id from public.venue_occupancy_reports where reporter_user_id = '${STAYER}'`,
  oauth: `select nonce_hash from public.social_oauth_states where owner_id = '${STAYER}'`,
} as const;

function plan(statement: string): string {
  return db().sql(`analyze; set enable_seqscan = off; explain (costs off) ${statement}`);
}

/**
 * Whether the lookup's own predicate is answered BY an index (an Index Cond),
 * rather than filtered row by row out of a scan of the heap or of an unrelated
 * index (with sequential scans priced out, the planner will walk a whole
 * primary key and filter, which is a scan by another name).
 */
function seeks(said: string): boolean {
  return /Index Cond/.test(said);
}

let functionBefore = "";

beforeAll(async () => {
  if (skipReason) return;
  database = await startPostgres({ label: "every-handle-0180", database: "pubmax_every_handle_0180" });
  database.applyFile(SESSION_FIXTURE);
  for (const path of PREREQUISITES) database.applyFile(path);
  db().sql(`insert into auth.users (id) values ('${STAYER}');`);
  expect(rpc(`select public.claim_pubmaxx_handle('${STAYER}', 'stayer')::text`).ok).toBe(true);
  for (const a of [EARLY, LEAVER, LATE]) seedRenamed(a);
  // A busy group and poll, so the planner prices the ballot table as a table rather than
  // as a handful of rows it would rather walk through its primary key.
  db().sql(`
    insert into public.conversations (id, kind, title, created_by_handle)
      values ('${BUSY_GROUP}', 'group', 'Everyone', 'stayer');
    insert into public.messages (id, conversation_id, sender_handle, body, attachment_kind, attachment_poll_question, attachment_poll_options)
      values ('${BUSY_POLL}', '${BUSY_GROUP}', 'stayer', '', 'poll', 'Which night?', '["Friday","Saturday"]'::jsonb);
    insert into public.message_poll_votes (message_id, voter_handle, option_index)
      select '${BUSY_POLL}', 'voter' || g, g % 2 from generate_series(1, 5000) g;
    insert into public.conversation_members (conversation_id, handle, role)
      select '${BUSY_GROUP}', 'voter' || g, 'member' from generate_series(1, 5000) g;
  `);
}, 300_000);

afterAll(async () => {
  await database?.stop();
}, 180_000);

describe.skipIf(skipReason !== null)("0180: an account's deletion reaches every handle it held", () => {
  it("BEFORE: the rename leaves every old-handle row behind when the account leaves", async ({ skip }) => {
    if (skipReason) skip(skipReason);
    functionBefore = value(
      "select pg_get_functiondef('public.stamp_profile_tombstone_on_auth_user_delete()'::regprocedure)",
    );
    const left = await db().attempt(`delete from auth.users where id = '${EARLY.userId}'`);
    expect(left.ok, left.said).toBe(true);

    expect(oldHandleFootprint(EARLY)).toEqual({
      // The current handle's drop is stamped; the old one keeps the retired name printed.
      oldDropStamped: "false",
      newDropStamped: "true",
      reportStamped: "false",
      recommendationStamped: "false",
      // The ledger remembers ONE drop of two, and nothing in the other lanes.
      ledgerDrops: EARLY.newDrop,
      ledgerReports: "",
      ledgerRecommendations: "",
      seatLive: "true",
      voteKept: "1",
      photoKept: "true",
    });
    stayerUntouched(EARLY);
  });

  it("BEFORE: the deletion's lookups have no index to read", async ({ skip }) => {
    if (skipReason) skip(skipReason);
    for (const [name, statement] of Object.entries(LOOKUPS)) {
      const said = plan(statement);
      // `venue_occupancy_reports_retake_idx` is (venue_id, reporter_user_id,
      // reported_at): PostgreSQL will put the account in an Index Cond on its
      // SECOND column, which walks the whole index rather than seeking it.
      const walk = name === "occupancy" && said.includes("venue_occupancy_reports_retake_idx");
      expect(seeks(said) && !walk, `${name}: ${said}`).toBe(false);
    }
    // The old seat predicate folds the column, so 0155's partial index on the
    // raw handle cannot serve it.
    expect(
      seeks(plan("select 1 from public.conversation_members where lower(handle) = lower('carla')")),
    ).toBe(false);
  });

  it("AFTER: every lane is stamped and the ledger names the rows under both handles", async ({ skip }) => {
    if (skipReason) skip(skipReason);
    db().applyFile(FORWARD);
    const left = await db().attempt(`delete from auth.users where id = '${LEAVER.userId}'`);
    expect(left.ok, left.said).toBe(true);

    expect(oldHandleFootprint(LEAVER)).toEqual({
      oldDropStamped: "true",
      newDropStamped: "true",
      reportStamped: "true",
      recommendationStamped: "true",
      ledgerDrops: [LEAVER.oldDrop, LEAVER.newDrop].sort().join(","),
      ledgerReports: LEAVER.oldReport,
      ledgerRecommendations: LEAVER.oldRecommendation,
      seatLive: "false",
      voteKept: "0",
      photoKept: "false",
    });
    // The row keeps its words and its handle; only the attachment and the name went.
    expect(value(`select body || ':' || sender_handle from public.messages where id = '${LEAVER.oldPhoto}'`)).toBe(
      "before the rename:dana",
    );
    expect(value(`select price_gbp::text from public.pint_drops where id = '${LEAVER.oldDrop}'`)).toBe("4.50");
    expect(value(`select retired_handle from public.account_retention_ledger where account_user_id = '${LEAVER.userId}'`)).toBe(
      "danb",
    );
    stayerUntouched(LEAVER);
    // A live account's own rows under its own handle were not touched by somebody else leaving.
    expect(stamped("pint_drops", LATE.oldDrop)).toBe("false");
    expect(
      value(`select (left_at is null)::text from public.conversation_members where conversation_id = '${LATE.group}' and handle = 'erin'`),
    ).toBe("true");
  });

  it("AFTER: the function keeps security definer and its search_path", async ({ skip }) => {
    if (skipReason) skip(skipReason);
    expect(
      value(
        "select prosecdef::text || ':' || array_to_string(proconfig, ',') from pg_proc where oid = 'public.stamp_profile_tombstone_on_auth_user_delete()'::regprocedure",
      ),
    ).toBe("true:search_path=public");
  });

  it("AFTER: the deletion's lookups plan on indexes", async ({ skip }) => {
    if (skipReason) skip(skipReason);
    const expected: Record<keyof typeof LOOKUPS, string> = {
      sender: "messages_sender_handle_lower_attachment_idx",
      voter: "message_poll_votes_voter_handle_lower_idx",
      hostEditor: "night_stories_host_editor_idx",
      proposals: "night_story_publish_proposals_requested_by_idx",
      occupancy: "venue_occupancy_reports_reporter_user_idx",
      oauth: "social_oauth_states_owner_idx",
    };
    for (const [name, statement] of Object.entries(LOOKUPS)) {
      const said = plan(statement);
      expect(said, name).toContain(expected[name as keyof typeof LOOKUPS]);
      expect(seeks(said), `${name}: ${said}`).toBe(true);
    }
    // The new seat predicate reads 0155's partial index.
    const seat = plan(
      "select 1 from public.conversation_members where handle = any(array['carla','carlb']) and left_at is null",
    );
    expect(seat).toContain("conversation_members_handle_idx");
    expect(seeks(seat), seat).toBe(true);
  });

  it("ROLLBACK restores 0156's function exactly, drops the indexes, and the forward file re-applies", async ({ skip }) => {
    if (skipReason) skip(skipReason);
    db().applyFile(ROLLBACK);
    expect(
      value("select pg_get_functiondef('public.stamp_profile_tombstone_on_auth_user_delete()'::regprocedure)"),
    ).toBe(functionBefore);
    expect(
      value(`select count(*)::text from pg_indexes where indexname in (
        'messages_sender_handle_lower_attachment_idx', 'message_poll_votes_voter_handle_lower_idx',
        'night_stories_host_editor_idx', 'night_story_publish_proposals_requested_by_idx',
        'venue_occupancy_reports_reporter_user_idx', 'social_oauth_states_owner_idx')`),
    ).toBe("0");

    // Under the rollback an account leaves the pre-0180 way again.
    const left = await db().attempt(`delete from auth.users where id = '${LATE.userId}'`);
    expect(left.ok, left.said).toBe(true);
    expect(stamped("pint_drops", LATE.oldDrop)).toBe("false");
    expect(ledger(LATE, "pint_drop_ids")).toBe(LATE.newDrop);
    // What 0180 already wrote is not reverted.
    expect(stamped("pint_drops", LEAVER.oldDrop)).toBe("true");

    db().applyFile(FORWARD);
    expect(
      value("select pg_get_functiondef('public.stamp_profile_tombstone_on_auth_user_delete()'::regprocedure)"),
    ).not.toBe(functionBefore);
    expect(plan(LOOKUPS.voter)).toContain("message_poll_votes_voter_handle_lower_idx");
  });
});
