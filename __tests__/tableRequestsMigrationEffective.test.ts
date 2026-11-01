// Migration 0219, proved against a real PostgreSQL replay of every migration:
// the CHECKs that hold a table request to its shape (a crew of 6 to 20, one
// contact of a known kind, the delivery stamp beside its state), the refusal of
// every browser read and write, the erasure when an account is deleted, and a
// rollback that applies cleanly and lets the forward file apply again.

import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

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

  it("ROLLBACK drops the table, and the forward file applies again", () => {
    db().applyFile(ROLLBACK);
    expect(db().sql("select to_regclass('public.table_requests') is null")).toBe("t");
    db().applyFile(ROLLBACK);
    db().applyFile(FORWARD);
    expect(db().sql("select count(*) from public.table_requests")).toBe("0");
    db().applyFile(FORWARD);
  });
});
