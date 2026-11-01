// Migration 0217, proved against a real PostgreSQL replay of every migration:
// the CHECKs that hold a fact to its shape, one fact per proposal, the public
// read of PUBLISHED rows and their public columns only, the refusal of every
// browser write, and a rollback that applies cleanly and lets the forward file
// apply again.

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
const FORWARD = join(MIGRATIONS, "20261101090000_0217_operator_facts.sql");
const ROLLBACK = join(MIGRATIONS, "rollback/20261101090000_0217_operator_facts_rollback.sql");

const OPERATOR = "a1111111-1111-4111-8111-111111111111";
const STRANGER = "c1111111-1111-4111-8111-111111111111";
const PUBLISHED_PROPOSAL = "11111111-1111-4111-8111-111111111111";
const WITHDRAWN_PROPOSAL = "22222222-2222-4222-8222-222222222222";
const SPARE_PROPOSAL = "33333333-3333-4333-8333-333333333333";
const VENUE = "venue-1f5ygjb";

let session: PostgresSession | null = null;

function db(): PostgresSession {
  if (!session) throw new Error("PostgreSQL operator facts session did not start.");
  return session;
}

function proposalRows(): string {
  return `
    insert into public.operator_proposals (id, venue_id, account_id, type, payload, status) values
      ('${PUBLISHED_PROPOSAL}', '${VENUE}', '${OPERATOR}', 'event', '{"title":"Quiz night"}', 'accepted'),
      ('${WITHDRAWN_PROPOSAL}', '${VENUE}', '${OPERATOR}', 'offer', '{"title":"Two for one"}', 'declined'),
      ('${SPARE_PROPOSAL}', '${VENUE}', '${OPERATOR}', 'response', '{"body":"Thanks"}', 'pending')
    on conflict (id) do nothing`;
}

function insertFact(
  proposalId: string,
  fields: { kind?: string; onDate?: string | null; withdrawn?: boolean; title?: string } = {},
): string {
  const onDate = fields.onDate === undefined ? "null" : fields.onDate === null ? "null" : `'${fields.onDate}'`;
  return `
    insert into public.operator_facts (proposal_id, venue_id, account_id, kind, title, on_date, withdrawn_at)
    values ('${proposalId}', '${VENUE}', '${OPERATOR}', '${fields.kind ?? "event"}',
      '${fields.title ?? "Quiz night"}', ${onDate}, ${fields.withdrawn ? "now()" : "null"})`;
}

function lastLine(said: string): string {
  return said.split("\n").pop() ?? "";
}

beforeAll(async () => {
  if (skipReason) return;
  session = await startMigratedPostgres({ label: "operator-facts-0217", database: "pubmax_operator_facts_0217" });
  session.sql(proposalRows());
}, 300_000);

afterAll(async () => {
  await session?.stop();
});

describe.skipIf(skipReason !== null)("0217 operator facts", () => {
  it("takes a published fact and a withdrawn one from the service role", async () => {
    const published = await db().attempt(asServiceRole(insertFact(PUBLISHED_PROPOSAL, { onDate: "2026-11-07" })));
    expect(published.ok, published.said).toBe(true);
    const withdrawn = await db().attempt(
      asServiceRole(insertFact(WITHDRAWN_PROPOSAL, { kind: "offer", withdrawn: true, title: "Two for one" })),
    );
    expect(withdrawn.ok, withdrawn.said).toBe(true);
  });

  it("holds one fact per proposal, and only a proposal that exists", async () => {
    const twin = await db().attempt(asServiceRole(insertFact(PUBLISHED_PROPOSAL)));
    expect(twin.ok).toBe(false);
    expect(twin.said).toMatch(/operator_facts_proposal_unique/);
    const orphan = await db().attempt(asServiceRole(insertFact("44444444-4444-4444-8444-444444444444")));
    expect(orphan.ok).toBe(false);
    expect(orphan.said).toMatch(/foreign key|operator_facts_proposal_id_fkey/);
  });

  it("refuses a kind off the list and a date on a correction or a response", async () => {
    const kind = await db().attempt(asServiceRole(insertFact(SPARE_PROPOSAL, { kind: "advert" })));
    expect(kind.ok).toBe(false);
    expect(kind.said).toMatch(/operator_facts_kind_check/);
    for (const dated of ["response", "correction"]) {
      const answer = await db().attempt(asServiceRole(insertFact(SPARE_PROPOSAL, { kind: dated, onDate: "2026-11-07" })));
      expect(answer.ok, dated).toBe(false);
      expect(answer.said).toMatch(/operator_facts_on_date_kind_check/);
    }
  });

  it("lets anon and a signed-in stranger read published rows only", () => {
    expect(db().sql("select count(*) from public.operator_facts")).toBe("2");
    for (const [role, sub] of [["anon", null], ["authenticated", STRANGER], ["authenticated", OPERATOR]] as const) {
      const seen = db().sql(asBrowserRole(role, sub, "select title from public.operator_facts order by title"));
      expect(lastLine(seen), `${role} ${sub}`).toBe("Quiz night");
      const count = db().sql(asBrowserRole(role, sub, "select count(*) from public.operator_facts"));
      expect(lastLine(count), `${role} ${sub}`).toBe("1");
    }
  });

  it("keeps the operator, the proposal and the withdrawal stamp off every browser read", async () => {
    for (const [role, sub] of [["anon", null], ["authenticated", STRANGER]] as const) {
      for (const column of ["account_id", "proposal_id", "withdrawn_at"]) {
        const read = await db().attempt(asBrowserRole(role, sub, `select ${column} from public.operator_facts`));
        expect(read.ok, `${role} ${column}`).toBe(false);
        expect(read.said).toMatch(/42501|permission denied/);
      }
      const star = await db().attempt(asBrowserRole(role, sub, "select * from public.operator_facts"));
      expect(star.ok, `${role} select *`).toBe(false);
    }
  });

  it("refuses every browser write, the operator's own included", async () => {
    for (const [role, sub] of [["anon", null], ["authenticated", OPERATOR], ["authenticated", STRANGER]] as const) {
      const insert = await db().attempt(asBrowserRole(role, sub, insertFact(SPARE_PROPOSAL, { kind: "response" })));
      expect(insert.ok, `${role} insert`).toBe(false);
      expect(insert.said).toMatch(/42501|permission denied/);
      const update = await db().attempt(asBrowserRole(role, sub, "update public.operator_facts set title = 'tampered'"));
      expect(update.ok, `${role} update`).toBe(false);
      expect(update.said).toMatch(/42501|permission denied/);
      const remove = await db().attempt(asBrowserRole(role, sub, "delete from public.operator_facts"));
      expect(remove.ok, `${role} delete`).toBe(false);
      expect(remove.said).toMatch(/42501|permission denied/);
    }
    expect(db().sql("select count(*) from public.operator_facts where title = 'tampered'")).toBe("0");
    expect(db().sql("select count(*) from public.operator_facts")).toBe("2");
  });

  it("ROLLBACK drops the table and keeps the proposals, and the forward file applies again", () => {
    db().applyFile(ROLLBACK);
    expect(db().sql("select to_regclass('public.operator_facts') is null")).toBe("t");
    expect(db().sql("select count(*) from public.operator_proposals")).toBe("3");
    db().applyFile(ROLLBACK);
    db().applyFile(FORWARD);
    expect(db().sql("select count(*) from public.operator_facts")).toBe("0");
    db().applyFile(FORWARD);
  });
});
