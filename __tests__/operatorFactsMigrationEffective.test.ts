// Migration 0217, proved against a real PostgreSQL replay of every migration:
// the CHECKs that hold a fact to its shape, one fact per proposal, the public
// read of PUBLISHED rows and their public columns only, the refusal of every
// browser write, and a rollback that applies cleanly and lets the forward file
// apply again.

import { randomUUID } from "node:crypto";
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


describe.skipIf(skipReason !== null)("0227 atomic operator moderation", () => {
  const forward = join(MIGRATIONS, "20261110090000_0227_operator_proposal_decisions.sql");
  const rollback = join(MIGRATIONS, "rollback/20261110090000_0227_operator_proposal_decisions_rollback.sql");

  function pending(kind = "correction"): string {
    const id = randomUUID();
    db().sql(asServiceRole(`insert into public.operator_proposals (id, venue_id, account_id, type, payload)
      values ('${id}', '${VENUE}', '${OPERATOR}', '${kind}',
        '{"title":"Quiz","body":"Details","field":"Hours","startsAt":"8pm","onDate":"2026-11-10"}')`));
    return id;
  }

  function decide(id: string, status: string, note = "checked"): string {
    return `select public.decide_operator_proposal('${id}', '${status}', '${note}')->>'outcome'`;
  }

  function state(id: string): string {
    return db().sql(`select p.status || ':' || count(f.id)::text from public.operator_proposals p
      left join public.operator_facts f on f.proposal_id = p.id and f.withdrawn_at is null
      where p.id = '${id}' group by p.status`);
  }

  it("keeps exactly one publication when two accepts overlap", async () => {
    const id = pending();
    const outcomes = await db().concurrentResults([
      asServiceRole(decide(id, "accepted")), asServiceRole(decide(id, "accepted")),
    ]);
    expect(outcomes.sort()).toEqual(["accepted", "conflict"]);
    expect(state(id)).toBe("accepted:1");
    const published = db().sql(`select id::text || ':' || published_at::text from public.operator_facts where proposal_id = '${id}'`);
    expect(db().sql(asServiceRole(decide(id, "accepted")))).toBe("conflict");
    expect(db().sql(`select id::text || ':' || published_at::text from public.operator_facts where proposal_id = '${id}'`)).toBe(published);
  });

  it.each(["accepted", "declined"])("keeps a decline final when %s races with it", async (first) => {
    const id = pending();
    const outcomes = await db().concurrentResults([
      asServiceRole(decide(id, first)),
      asServiceRole(decide(id, first === "accepted" ? "declined" : "accepted")),
    ]);
    expect(outcomes).toContain("declined");
    expect(state(id)).toBe("declined:0");
    expect(db().sql(asServiceRole(decide(id, "accepted")))).toBe("conflict");
    expect(db().sql(asServiceRole(decide(id, "declined")))).toBe("conflict");
  });

  it.each([
    ["correction", "Hours", null, null],
    ["event", null, "8pm", "2026-11-10"],
    ["offer", null, null, "2026-11-10"],
    ["response", null, null, null],
  ] as const)("publishes the stored %s payload with the required field projection", (kind, field, when, onDate) => {
    const id = pending(kind);
    const result = JSON.parse(db().sql(asServiceRole(
      `select public.decide_operator_proposal('${id}', 'accepted', 'checked')`,
    ))) as { outcome: string; fact: Record<string, unknown>; proposal: Record<string, unknown> };
    expect(result.outcome).toBe("accepted");
    expect(result.proposal).toMatchObject({ id, status: "accepted", reviewer_note: "checked" });
    expect(result.fact).toMatchObject({
      proposal_id: id, venue_id: VENUE, account_id: OPERATOR, kind, title: "Quiz", body: "Details",
      field, when_text: when, on_date: onDate, withdrawn_at: null,
    });
    expect(state(id)).toBe("accepted:1");
  });

  it("rolls back publication and withdrawal when the decision stamp fails", async () => {
    const id = pending();
    db().sql("alter table public.operator_proposals add constraint moderation_fault check (reviewer_note is distinct from 'fail')");
    try {
      const failedAccept = await db().attempt(asServiceRole(decide(id, "accepted", "fail")));
      expect(failedAccept.ok).toBe(false);
      expect(state(id)).toBe("pending:0");
      const outcomes = await Promise.all([
        db().attempt(asServiceRole(decide(id, "accepted", "fail"))),
        db().attempt(asServiceRole(decide(id, "accepted"))),
      ]);
      expect(outcomes[1]?.ok).toBe(true);
      expect(state(id)).toBe("accepted:1");
      const failedDecline = await db().attempt(asServiceRole(decide(id, "declined", "fail")));
      expect(failedDecline.ok).toBe(false);
      expect(state(id)).toBe("accepted:1");
    } finally {
      db().sql("alter table public.operator_proposals drop constraint moderation_fault");
    }
  });

  it("leaves a proposal pending when publication fails", async () => {
    const id = pending();
    db().sql("alter table public.operator_facts add constraint publication_fault check (title is distinct from 'blocked')");
    try {
      db().sql(`update public.operator_proposals set payload = '{"title":"blocked"}' where id = '${id}'`);
      expect((await db().attempt(asServiceRole(decide(id, "accepted")))).ok).toBe(false);
      expect(state(id)).toBe("pending:0");
    } finally {
      db().sql("alter table public.operator_facts drop constraint publication_fault");
    }
  });

  it("returns missing for unknown ids and refuses browser decisions", async () => {
    expect(db().sql(asServiceRole(decide(randomUUID(), "accepted")))).toBe("missing");
    expect(db().sql(asServiceRole(decide("nope", "declined")))).toBe("missing");
    const id = pending();
    for (const role of ["anon", "authenticated"] as const) {
      expect((await db().attempt(asBrowserRole(role, OPERATOR, decide(id, "accepted")))).ok).toBe(false);
    }
    expect(state(id)).toBe("pending:0");
  });

  it("rolls back the RPC without losing decisions or publications, then applies again", () => {
    const id = pending();
    db().sql(asServiceRole(decide(id, "accepted")));
    db().applyFile(rollback);
    expect(state(id)).toBe("accepted:1");
    expect(db().sql("select to_regprocedure('public.decide_operator_proposal(text,text,text)') is null")).toBe("t");
    db().applyFile(forward);
    expect(db().sql(asServiceRole(decide(id, "declined")))).toBe("declined");
    expect(state(id)).toBe("declined:0");
  });
});
