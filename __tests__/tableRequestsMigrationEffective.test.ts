// Migration 0219, proved against a real PostgreSQL replay of every migration:
// the CHECKs that hold a table request to its shape (a crew of 6 to 20, one
// contact of a known kind, the delivery stamp beside its state), the refusal of
// every browser read and write, the erasure when an account is deleted, and a
// rollback that applies cleanly and lets the forward file apply again.

import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  TABLE_REQUEST_DELIVERIES,
  transitionTableRequestDelivery,
  type TableRequestDeliveryEvent,
  type TableRequestDeliveryState,
} from "@/lib/tableRequests";

import {
  asBrowserRole,
  asServiceRole,
  postgresSkipReason,
  startMigratedPostgres,
  type PostgresSession,
} from "./helpers/postgres";

const skipReason = postgresSkipReason();

const MIGRATIONS = join(process.cwd(), "supabase/migrations");
const FORWARD = join(MIGRATIONS, "20261102090000_0219_table_requests.sql");
const ROLLBACK = join(MIGRATIONS, "rollback/20261102090000_0219_table_requests_rollback.sql");
const CLAIM_FORWARD = join(MIGRATIONS, "20261116090000_0241_table_request_terminal_claim.sql");
const CLAIM_ROLLBACK = join(MIGRATIONS, "rollback/20261116090000_0241_table_request_terminal_claim_rollback.sql");

const ALICE_USER = "a1111111-1111-4111-8111-111111111111";
const BOB_USER = "b1111111-1111-4111-8111-111111111111";
const STRANGER_USER = "c1111111-1111-4111-8111-111111111111";
const VENUE = "venue-1f5ygjb";

let session: PostgresSession | null = null;

function db(): PostgresSession {
  if (!session) throw new Error("PostgreSQL table requests session did not start.");
  return session;
}

function insert(
  requester: string,
  fields: {
    party?: number;
    kind?: string;
    value?: string;
    delivery?: string;
    delivered?: boolean;
    name?: string;
  } = {},
): string {
  return `
    insert into public.table_requests
      (requester_user_id, venue_id, requester_name, party_size, requested_date, requested_time,
       note, contact_kind, contact_value, delivery, delivered_at)
    values ('${requester}', '${VENUE}', '${fields.name ?? "Sam"}', ${fields.party ?? 8},
      '2026-11-14', '19:30', null, '${fields.kind ?? "email"}', '${fields.value ?? "sam@example.com"}',
      '${fields.delivery ?? "emailed"}', ${fields.delivered === false ? "null" : "now()"})`;
}

function lastLine(said: string): string {
  return said.split("\n").pop() ?? "";
}

beforeAll(async () => {
  if (skipReason) return;
  session = await startMigratedPostgres({ label: "table-requests-0219", database: "pubmax_table_requests_0219" });
  session.sql(`insert into auth.users (id) values ('${ALICE_USER}'), ('${BOB_USER}'), ('${STRANGER_USER}')`);
}, 300_000);

afterAll(async () => {
  await session?.stop();
});

describe.skipIf(skipReason !== null)("0219 table requests", () => {
  it("takes an emailed request and a pending one from the service role", async () => {
    const emailed = await db().attempt(asServiceRole(insert(ALICE_USER)));
    expect(emailed.ok, emailed.said).toBe(true);
    const pending = await db().attempt(
      asServiceRole(insert(BOB_USER, { delivery: "pending", delivered: false, kind: "phone", value: "+447700900123", name: "Bob" })),
    );
    expect(pending.ok, pending.said).toBe(true);
  });

  it("holds a crew to 6 to 20 people", async () => {
    for (const party of [0, 5, 21, 60]) {
      const answer = await db().attempt(asServiceRole(insert(ALICE_USER, { party })));
      expect(answer.ok, `party ${party}`).toBe(false);
      expect(answer.said).toMatch(/table_requests_party_size_check/);
    }
  });

  it("holds the contact to one known kind, and the stamp to its state", async () => {
    const kind = await db().attempt(asServiceRole(insert(ALICE_USER, { kind: "fax" })));
    expect(kind.ok).toBe(false);
    expect(kind.said).toMatch(/table_requests_contact_kind_check/);

    const empty = await db().attempt(asServiceRole(insert(ALICE_USER, { value: "" })));
    expect(empty.ok).toBe(false);
    expect(empty.said).toMatch(/table_requests_contact_value_check/);

    const unknownState = await db().attempt(asServiceRole(insert(ALICE_USER, { delivery: "paid" })));
    expect(unknownState.ok).toBe(false);
    expect(unknownState.said).toMatch(/table_requests_delivery_check/);

    const emailedUnstamped = await db().attempt(asServiceRole(insert(ALICE_USER, { delivered: false })));
    expect(emailedUnstamped.ok).toBe(false);
    expect(emailedUnstamped.said).toMatch(/table_requests_delivery_stamp_check/);

    const pendingStamped = await db().attempt(asServiceRole(insert(ALICE_USER, { delivery: "pending" })));
    expect(pendingStamped.ok).toBe(false);
    expect(pendingStamped.said).toMatch(/table_requests_delivery_stamp_check/);
  });

  it("has no column for a fee, a deposit or a payment", () => {
    const columns = db().sql(
      "select string_agg(column_name, ',' order by column_name) from information_schema.columns where table_schema = 'public' and table_name = 'table_requests'",
    );
    expect(columns).not.toMatch(/fee|price|amount|payment|deposit|charge|stripe/);
  });

  it("refuses every browser read and write, the requester's own included", async () => {
    for (const [role, sub] of [["anon", null], ["authenticated", ALICE_USER], ["authenticated", STRANGER_USER]] as const) {
      const read = await db().attempt(asBrowserRole(role, sub, "select count(*) from public.table_requests"));
      expect(read.ok, `${role} ${sub} read`).toBe(false);
      expect(read.said).toMatch(/42501|permission denied/);
      const contact = await db().attempt(asBrowserRole(role, sub, "select contact_value from public.table_requests"));
      expect(contact.ok, `${role} ${sub} contact`).toBe(false);
      const write = await db().attempt(asBrowserRole(role, sub, insert(ALICE_USER)));
      expect(write.ok, `${role} ${sub} insert`).toBe(false);
      expect(write.said).toMatch(/42501|permission denied/);
      const update = await db().attempt(asBrowserRole(role, sub, "update public.table_requests set requester_name = 'tampered'"));
      expect(update.ok, `${role} ${sub} update`).toBe(false);
      const remove = await db().attempt(asBrowserRole(role, sub, "delete from public.table_requests"));
      expect(remove.ok, `${role} ${sub} delete`).toBe(false);
    }
    expect(db().sql("select count(*) from public.table_requests where requester_name = 'tampered'")).toBe("0");
    expect(lastLine(db().sql("select count(*) from public.table_requests"))).toBe("2");
  });

  it("leaves with the account: deleting the auth user erases its requests and nobody else's", async () => {
    expect(db().sql(`select count(*) from public.table_requests where requester_user_id = '${BOB_USER}'`)).toBe("1");
    const deleted = await db().attempt(`delete from auth.users where id = '${BOB_USER}'`);
    expect(deleted.ok, deleted.said).toBe(true);
    expect(db().sql(`select count(*) from public.table_requests where requester_user_id = '${BOB_USER}'`)).toBe("0");
    expect(db().sql(`select count(*) from public.table_requests where requester_user_id = '${ALICE_USER}'`)).toBe("1");
  });

  it("0241 admits a durable resolving claim only after the migration", async () => {
    db().applyFile(CLAIM_ROLLBACK);
    const before = await db().attempt(asServiceRole(insert(ALICE_USER, { delivery: "resolving", delivered: false })));
    expect(before.ok).toBe(false);
    expect(before.said).toMatch(/table_requests_delivery_check/);
    db().applyFile(CLAIM_FORWARD);
    const after = await db().attempt(asServiceRole(insert(ALICE_USER, { delivery: "resolving", delivered: false })));
    expect(after.ok, after.said).toBe(true);
  });

  it("0241 holds SQL transitions to the delivery machine, including terminal refusals", () => {
    const now = Date.parse("2026-11-16T12:00:00.000Z");
    const events: TableRequestDeliveryEvent[] = ["begin_send", "confirm_not_sent", "confirm_sent"];
    for (const delivery of TABLE_REQUEST_DELIVERIES) {
      for (const event of events) {
        const deliveredAt = delivery === "emailed" ? new Date(now).toISOString() : null;
        const state: TableRequestDeliveryState = delivery === "emailed"
          ? { delivery, deliveredAt: deliveredAt!, revision: 0 }
          : { delivery, deliveredAt: null, revision: 0 };
        const expected = transitionTableRequestDelivery(state, event, 0, now);
        const id = db().sql(asServiceRole(insert(ALICE_USER, { delivery, delivered: deliveredAt !== null }) + " returning id"));
        const target = { begin_send: "pending", confirm_not_sent: "not_sent", confirm_sent: "emailed" }[event];
        const stamp = event === "confirm_sent" ? `'${new Date(now).toISOString()}'` : "null";
        const result = db().sql(asServiceRole(`select count(*) from public.transition_table_request(
          '${id}', '${ALICE_USER}', '${delivery}', 0, '${target}', ${stamp})`));
        expect(result, `${delivery} ${event}`).toBe(expected === state ? "0" : "1");
        const stored = JSON.parse(db().sql(`select json_build_object('delivery', delivery, 'revision', revision,
          'stamped', delivered_at is not null) from public.table_requests where id = '${id}'`));
        expect(stored).toEqual({ delivery: expected.delivery, revision: expected.revision, stamped: expected.deliveredAt !== null });
      }
    }
  });

  it("0241 gives concurrent positive and negative claims one winner and refuses stale revisions", async () => {
    const id = db().sql(asServiceRole(insert(ALICE_USER, { delivery: "resolving", delivered: false }) + " returning id"));
    const claim = (target: string, requester = ALICE_USER, revision = 0) => asServiceRole(`select count(*) from
      public.transition_table_request('${id}', '${requester}', 'resolving', ${revision}, '${target}', null)`);
    expect(db().sql(claim("pending", STRANGER_USER))).toBe("0");
    expect(db().sql(claim("pending", ALICE_USER, 1))).toBe("0");
    const results = await db().concurrentResults([claim("pending"), claim("not_sent")]);
    expect(results.sort()).toEqual(["0", "1"]);
    expect(db().sql(`select revision from public.table_requests where id = '${id}'`)).toBe("1");
    expect(db().sql(claim("pending"))).toBe("0");
    expect(db().sql(claim("not_sent"))).toBe("0");
  });

  it("0241 refuses browser RPCs and retains account-deletion cleanup", async () => {
    for (const role of ["anon", "authenticated"] as const) {
      const result = await db().attempt(asBrowserRole(role, ALICE_USER, `select * from public.transition_table_request(
        gen_random_uuid(), '${ALICE_USER}', 'resolving', 0, 'pending', null)`));
      expect(result.ok).toBe(false);
      expect(result.said).toMatch(/permission denied/);
    }
    db().sql(`insert into auth.users (id) values ('${BOB_USER}')`);
    db().sql(asServiceRole(insert(BOB_USER, { delivery: "not_sent", delivered: false })));
    db().sql(`delete from auth.users where id = '${BOB_USER}'`);
    expect(db().sql(`select count(*) from public.table_requests where requester_user_id = '${BOB_USER}'`)).toBe("0");
  });

  it("0241 rollback removes unsent claims and preserves pending and emailed requests", () => {
    const kept = db().sql("select count(*) from public.table_requests where delivery in ('pending', 'emailed')");
    db().applyFile(CLAIM_ROLLBACK);
    expect(db().sql("select count(*) from public.table_requests")).toBe(kept);
    expect(db().sql("select to_regprocedure('public.transition_table_request(uuid,uuid,text,integer,text,timestamptz)') is null")).toBe("t");
    db().applyFile(CLAIM_FORWARD);
  });

  it("ROLLBACK drops the table, and the forward file applies again", () => {
    db().applyFile(CLAIM_ROLLBACK);
    db().applyFile(ROLLBACK);
    expect(db().sql("select to_regclass('public.table_requests') is null")).toBe("t");
    db().applyFile(ROLLBACK);
    db().applyFile(FORWARD);
    expect(db().sql("select count(*) from public.table_requests")).toBe("0");
    db().applyFile(FORWARD);
  });
});
