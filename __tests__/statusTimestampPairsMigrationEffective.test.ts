import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { asServiceRole, postgresSkipReason, startPostgres, type PostgresSession } from "./helpers/postgres";

const boundary = vi.hoisted(() => ({ getClient: () => null as unknown }));
vi.mock("@/lib/supabase", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/supabase")>(),
  requireSupabaseAdmin: () => boundary.getClient(),
  isSupabaseConfigured: () => true,
}));
import { venueSubmissionStore } from "@/lib/venueSubmissionStore";
import { wantedStore } from "@/lib/wantedStore";
import { regularNightReportsStore } from "@/lib/regularNightReportsStore";

const skipReason = postgresSkipReason();
const directory = join(process.cwd(), "supabase/migrations");
const name = "20261110080000_0227_status_timestamp_pairs.sql";
const rollback = join(directory, "rollback/20261110080000_0227_status_timestamp_pairs_rollback.sql");
const HASH = "a".repeat(64);
const USER = "00000000-0000-4000-8000-000000000001";
const AUTHOR = "00000000-0000-4000-8000-000000000002";
const REPORTER = "00000000-0000-4000-8000-000000000003";
const MODERATOR = "00000000-0000-4000-8000-000000000004";
const STAFF = "00000000-0000-4000-8000-000000000005";
const PAIRS = ["social_post_videos_review_pair_check", "venue_submissions_review_pair_check",
  "wanteds_fulfilled_pair_check", "analytics_event_receipts_delivered_pair_check",
  "social_posts_moderated_pair_check", "regular_night_reports_confirmed_pair_check"].map((pair) => `'${pair}'`).join(", ");
let session: PostgresSession | null = null;
function db() { if (!session) throw new Error("No test cluster"); return session; }
function sqlText(value: string): string { return `'${value.replaceAll("'", "''")}'`; }
function service(statement: string): string { return db().sql(asServiceRole(statement)); }

async function writeRequest(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(String(input));
  const table = url.pathname.slice("/rest/v1/".length);
  expect(init?.method).toBe("PATCH");
  expect(["venue_submissions", "wanteds", "regular_night_reports"]).toContain(table);
  const patch = JSON.parse(String(init?.body)) as Record<string, unknown>;
  const columns = Object.keys(patch);
  const filters: string[] = [];
  for (const [column, filter] of url.searchParams) {
    if (column === "select") continue;
    expect(column).toMatch(/^[a-z_]+$/);
    if (filter.startsWith("eq.")) filters.push(`${column} = ${sqlText(filter.slice(3))}`);
    else {
      expect(filter).toMatch(/^in\.\([a-z_,]+\)$/);
      filters.push(`${column} in (${filter.slice(4, -1).split(",").map(sqlText).join(",")})`);
    }
  }
  expect(filters.length).toBeGreaterThan(0);
  for (const column of columns) expect(column).toMatch(/^[a-z_]+$/);
  const record = `jsonb_populate_record(null::public.${table}, ${sqlText(JSON.stringify(patch))}::jsonb)`;
  const assignments = columns.map((column) => `${column} = (${record}).${column}`).join(", ");
  const rows = service(`with changed as (
    update public.${table} set ${assignments} where ${filters.join(" and ")} returning *
  ) select coalesce(jsonb_agg(to_jsonb(changed)), '[]'::jsonb) from changed`);
  return Response.json(JSON.parse(rows));
}

function postPair(id: string): string {
  return db().sql(`select moderation_state || ':' || (moderated_at is null)
    from public.social_posts where id = '${id}'`);
}

function moderate(id: string, decision: "approved" | "needs_review"): void {
  const jobs = JSON.parse(service("select coalesce(jsonb_agg(job), '[]') from public.claim_social_post_moderation_jobs(20) job")) as {
    post_id: string; revision: number; lease_token: string;
  }[];
  const job = jobs.find((row) => row.post_id === id);
  expect(job).toBeDefined();
  if (!job) throw new Error("Post was not claimed for moderation");
  expect(service(`select public.complete_social_post_moderation_job(
    '${id}', ${job.revision}, null, '${job.lease_token}', '${decision}')`)).toBe("t");
  expect(postPair(id)).toBe(`${decision}:false`);
}

async function exerciseWriters(): Promise<void> {
  const wantedId = randomUUID();
  db().sql(wanted(wantedId, "open", "null"));
  expect(await wantedStore().fulfilForVenue(`profile:${USER}`, "venue-crown"))
    .toEqual([expect.objectContaining({ id: wantedId, status: "fulfilled", fulfilledAt: expect.any(String) })]);
  expect(db().sql(`select status || ':' || (fulfilled_at is not null) from public.wanteds where id='${wantedId}'`))
    .toBe("fulfilled:true");
  expect(await wantedStore().fulfilForVenue(`profile:${USER}`, "venue-crown")).toEqual([]);

  for (const status of ["accepted", "declined", "duplicate"] as const) {
    const id = randomUUID();
    db().sql(`insert into public.venue_submissions(id, owner_user_id, name, address)
      values ('${id}', '${USER}', 'The Crown', '1 Example Street, London')`);
    const decision = status === "duplicate"
      ? { status, duplicateOfVenueId: "venue-crown", note: "Already listed" }
      : { status, note: "Checked" };
    expect(await venueSubmissionStore().decide(id, decision)).toBe(true);
    expect(db().sql(`select status || ':' || (reviewed_at is not null) from public.venue_submissions where id='${id}'`))
      .toBe(`${status}:true`);
    expect(await venueSubmissionStore().decide(id, decision)).toBe(false);
  }

  for (const transitions of [["confirmed"], ["hidden"], ["confirmed", "hidden"]] as const) {
    const id = randomUUID();
    db().sql(`insert into public.regular_night_reports(id, venue_id, kind, weekday, photo_key, reporter_user_id)
      values ('${id}', 'venue-crown', 'quiz', 2, 'regular-night-boards/${USER}/${id}.jpg', '${USER}')`);
    for (const decision of transitions) {
      expect(await regularNightReportsStore().decide(id, decision, "moderator")).toBe(true);
      expect(db().sql(`select status || ':' || (confirmed_at is not null) from public.regular_night_reports where id='${id}'`))
        .toBe(`${decision}:${transitions[0] === "confirmed"}`);
      expect(await regularNightReportsStore().decide(id, decision, "moderator")).toBe(false);
    }
  }

  const post = service(`select id from public.create_social_post_idempotent(
    '${AUTHOR}', 'author', 'standard', 'public', 'At the Crown', null, null, '{}', 'open',
    null, null, null, null, null, null, null, '{}', '${randomUUID()}', '${HASH}')`);
  expect(postPair(post)).toBe("pending:true");
  moderate(post, "approved");
  expect(service(`select id from public.edit_social_post('${post}', '${AUTHOR}', 0,
    'standard', 'friends', 'At the Crown', null, null, '{}', 'open', null, null, false)`)).toBe(post);
  expect(postPair(post)).toBe("approved:false");
  expect(service(`select id from public.edit_social_post('${post}', '${AUTHOR}', 1,
    'standard', 'public', 'Now at the Harp', null, null, '{}', 'open', null, null, true)`)).toBe(post);
  expect(postPair(post)).toBe("pending:true");
  moderate(post, "needs_review");
  expect(service(`select public.moderate_social_post_admin('${STAFF}', '${post}', null, 1, 'approve')`)).toBe("t");
  expect(postPair(post)).toBe("approved:false");

  const upload = service(`select upload_id from public.create_social_video_upload('${AUTHOR}', 'video/mp4', 100)`);
  expect(service(`select review_state from public.attach_social_post_video('${post}', '${AUTHOR}', '${upload}', 100, 10)`))
    .toBe("held");
  expect(db().sql(`select reviewed_at is null from public.social_post_videos where post_id='${post}'`)).toBe("t");
  for (const decision of ["approved", "rejected"] as const) {
    expect(service(`select public.review_social_post_video('${post}', '${decision}')`)).toBe("t");
    expect(db().sql(`select review_state || ':' || (reviewed_at is not null) from public.social_post_videos where post_id='${post}'`))
      .toBe(`${decision}:true`);
  }

  const receiptId = randomUUID();
  const token = receiptId.replaceAll("-", "").padEnd(64, "0");
  expect(service(`select public.claim_analytics_event_receipt('${receiptId}', '${token}', 'pint_drop', now(), now() + interval '1 minute')`))
    .toBe("claimed");
  expect(db().sql(`select status || ':' || (delivered_at is null) from public.analytics_event_receipts where event_id='${receiptId}'`))
    .toBe("pending:true");
  expect(service(`select public.complete_analytics_event_receipt('${receiptId}', now())`)).toBe("t");
  expect(db().sql(`select status || ':' || (delivered_at is not null) from public.analytics_event_receipts where event_id='${receiptId}'`))
    .toBe("delivered:true");
}

function report(kind: "profile" | "post", id: string, reason: string): string {
  return service(`select id from public.report_social_content('${REPORTER}', '${kind}', '${id}', '${reason}')`);
}

function resolution(id: string): Record<string, unknown> {
  return JSON.parse(db().sql(`select jsonb_build_object('state', state, 'at', resolved_at, 'by', resolved_by_staff_role_id)
    from public.social_content_reports where id='${id}'`)) as Record<string, unknown>;
}

function resolve(id: string): void {
  expect(service(`select public.resolve_social_report_admin('${STAFF}', '${id}')`)).toBe("t");
  expect(resolution(id)).toEqual({ state: "resolved", at: expect.any(String), by: STAFF });
}

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
    db().sql(`insert into auth.users(id) values ('${USER}');
      insert into public.profiles(id, handle) values
        ('${AUTHOR}', 'author'), ('${REPORTER}', 'reporter'), ('${MODERATOR}', 'moderator');
      insert into public.private_social_staff_roles(id, profile_id, display_name, role, active)
        values ('${STAFF}', '${MODERATOR}', 'Moderator', 'moderator', true)`);
    const client = createClient("http://fixture.invalid", "fixture-key", {
      auth: { persistSession: false }, global: { fetch: writeRequest },
    });
    boundary.getClient = () => client;
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

  it("validates the real writers' rows and keeps those writers working under the checks", async () => {
    await exerciseWriters();
    const reopened = ["harassment", "spam", "threat"].map((reason) => {
      const id = report("profile", AUTHOR, reason);
      resolve(id);
      expect(report("profile", AUTHOR, reason)).toBe(id);
      expect(resolution(id)).toEqual({ state: "queued", at: expect.any(String), by: STAFF });
      return id;
    });
    db().sql(`update public.social_content_reports set resolved_at = null where id='${reopened[1]}';
      update public.social_content_reports set resolved_by_staff_role_id = null where id='${reopened[2]}'`);
    const stillResolved = report("profile", AUTHOR, "other");
    resolve(stillResolved);
    const resolvedBefore = resolution(stillResolved);
    db().applyFile(join(directory, name));
    for (const id of reopened) expect(resolution(id)).toEqual({ state: "queued", at: null, by: null });
    expect(resolution(stillResolved)).toEqual(resolvedBefore);
    db().applyFile(join(directory, name));
    expect(db().sql(`select count(*) from pg_constraint where convalidated and conname = any (array[${PAIRS}])`)).toBe("6");
    await exerciseWriters();
  });

  it("clears both resolution fields only when a resolved person report reopens", () => {
    const id = report("profile", AUTHOR, "harassment");
    expect(resolution(id)).toEqual({ state: "queued", at: null, by: null });
    expect(report("profile", AUTHOR, "harassment")).toBe(id);
    db().sql(`update public.social_content_reports set state='reviewing' where id='${id}'`);
    expect(report("profile", AUTHOR, "harassment")).toBe(id);
    expect(resolution(id)).toEqual({ state: "reviewing", at: null, by: null });
    resolve(id);
    expect(report("profile", AUTHOR, "harassment")).toBe(id);
    expect(resolution(id)).toEqual({ state: "queued", at: null, by: null });
    expect(report("profile", AUTHOR, "harassment")).toBe(id);
    expect(resolution(id)).toEqual({ state: "queued", at: null, by: null });

    const post = db().sql(`select id from public.social_posts where visibility='public' and moderation_state='approved' limit 1`);
    const postReport = report("post", post, "spam");
    resolve(postReport);
    const before = resolution(postReport);
    expect(report("post", post, "spam")).toBe(postReport);
    expect(resolution(postReport)).toEqual(before);
  });

  it("refuses contradictory Wanted and analytics pairs", () => {
    expect(outcome(wanted("22222222-2222-4222-8222-222222222222", "open", "null"))).toBe("ok");
    expect(outcome(wanted("33333333-3333-4333-8333-333333333333", "fulfilled", "now()"))).toBe("ok");
    expect(outcome(wanted("44444444-4444-4444-8444-444444444444", "fulfilled", "null"))).toBe("refused");
    expect(outcome(wanted("55555555-5555-4555-8555-555555555555", "open", "now()"))).toBe("refused");

    expect(outcome(receipt("66666666-6666-4666-8666-666666666666", "pending", "now()"))).toBe("refused");
    expect(outcome(receipt("77777777-7777-4777-8777-777777777777", "delivered", "null"))).toBe("refused");
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
