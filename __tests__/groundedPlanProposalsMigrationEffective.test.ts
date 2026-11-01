import { readdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { postgresSkipReason, startPostgres, type PostgresSession } from "./helpers/postgres";

const skip = postgresSkipReason();
const migrations = join(process.cwd(), "supabase/migrations");
const name = "20261031170000_0215_grounded_plan_proposals.sql";
let session: PostgresSession | null = null;
function db() { if (!session) throw new Error("PostgreSQL session unavailable"); return session; }
function id(kind: number, suffix: number) { return `${kind}0000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`; }
function token(suffix: number) { return String(suffix).padStart(64, "0"); }
const next = JSON.stringify([{ venueId: "venue-a", venueName: "A", position: 0 }, { venueId: "venue-b", venueName: "B", position: 1 }, { venueId: "venue-d", venueName: "D", position: 2 }]);
function seed(suffix: number, anchored = true) {
  db().sql(`select public.create_plan_idempotent_atomic('${id(1, suffix)}','Friday',now()+interval '2 hours',
    '[{"venueId":"venue-a","venueName":"A"},{"venueId":"venue-b","venueName":"B"},{"venueId":"venue-c","venueName":"C"}]'::jsonb,
    '${id(2, suffix)}','Host','${token(suffix)}',now(),'${String(suffix).padStart(64, "0")}','${String(suffix).padStart(64, "0")}',
    ${anchored ? "'venue-a','near','route'" : 'null,null,null'})`);
  const created = db().sql(`select public.create_plan_grounded_proposal_atomic('${id(1, suffix)}','${id(3, suffix)}','${id(2, suffix)}','${token(suffix)}',1,
    '${next}'::jsonb,'A different last pub','[]'::jsonb,'[]'::jsonb,'proposal-${suffix}',now(),
    'signature-checked-by-service','generation-${suffix}',now()+interval '5 minutes',${anchored ? "'venue-a','near'" : 'null,null'})->>'code'`);
  expect(created).toBe("created");
}
function decisionSql(suffix: number) { return `select public.decide_plan_route_proposal_atomic('${id(1, suffix)}','${id(3, suffix)}','${token(suffix)}','accepted','decision-${suffix}',now())`; }
function revision(suffix: number) { return db().sql(`select route_revision from public.plans where id='${id(1, suffix)}'`); }
function addGuest(suffix: number) {
  db().sql(`insert into public.plan_crew_members(id,plan_id,name,token_hash,status,joined_at,updated_at,can_collaborate)
    values('${id(2, suffix + 100)}','${id(1, suffix)}','Guest','${token(suffix + 100)}','in',now()+interval '1 second',now(),true)`);
}
function guestProposal(suffix: number) {
  return db().sql(`select public.create_plan_grounded_proposal_atomic('${id(1, suffix)}','${id(3, suffix + 100)}','${id(2, suffix + 100)}','${token(suffix + 100)}',1,
    '${next}'::jsonb,'Guest choice','[]'::jsonb,'[]'::jsonb,'guest-proposal-${suffix}',now(),
    'signature-checked-by-service','guest-generation-${suffix}',now()+interval '5 minutes','venue-a','near')->>'code'`);
}

beforeAll(async () => {
  if (skip) return;
  session = await startPostgres({ label: "grounded-proposals-0215", database: "pubmax_grounded_proposals" });
  try {
    db().applyFile(join(process.cwd(), "scripts/rls/session-fixture.sql"));
    for (const entry of readdirSync(migrations).filter((item) => item.endsWith(".sql") && item <= name).sort()) db().applyFile(join(migrations, entry));
  } catch (error) { await session.stop(); session = null; throw error; }
}, 600_000);
afterAll(async () => { await session?.stop(); session = null; });

describe.skipIf(skip !== null)("0215 grounded proposal acceptance", () => {
  it("lets only the service role create verified proposals", () => {
    const signature = "public.create_plan_grounded_proposal_atomic(uuid,uuid,uuid,text,integer,jsonb,text,jsonb,jsonb,text,timestamptz,text,text,timestamptz,text,text)";
    expect(db().sql(`select has_function_privilege('anon','${signature}','execute')::text || ':' || has_function_privilege('authenticated','${signature}','execute')::text || ':' || has_function_privilege('service_role','${signature}','execute')::text`)).toBe("false:false:true");
    const vote = "public.record_plan_member_vote_atomic(uuid,uuid,uuid,text,text,text,uuid,timestamptz)";
    expect(db().sql(`select has_function_privilege('anon','${vote}','execute')::text || ':' || has_function_privilege('authenticated','${vote}','execute')::text || ':' || has_function_privilege('service_role','${vote}','execute')::text`)).toBe("false:false:true");
  });
  it("changes the route once when two host decisions race", async () => {
    seed(1);
    expect(revision(1)).toBe("1");
    expect((await db().concurrentResults([decisionSql(1), decisionSql(1)])).sort()).toEqual(["already_decided", "decided"]);
    expect(revision(1)).toBe("2");
    expect(db().sql(`select venue_id from public.plan_stops where plan_id='${id(1, 1)}' order by position`)).toBe("venue-a\nvenue-b\nvenue-d");
  });
  it("refuses expired checks and a changed anchor", () => {
    seed(2); seed(3);
    db().sql(`update public.plan_route_proposals set grounding_expires_at=now()-interval '1 second' where id='${id(3, 2)}'`);
    expect(db().sql(decisionSql(2))).toBe("expired");
    db().sql(`update public.plan_route_proposals set grounding_anchor_venue_id='venue-other' where id='${id(3, 3)}'`);
    expect(db().sql(decisionSql(3))).toBe("forbidden");
    expect(revision(2)).toBe("1"); expect(revision(3)).toBe("1");
  });
  it("refuses a stale route and a newly completed stop", () => {
    seed(4); seed(5);
    db().sql(`update public.plans set route_revision=2 where id='${id(1, 4)}'`);
    expect(db().sql(decisionSql(4))).toBe("conflict");
    db().sql(`insert into public.plan_actions(id,plan_id,actor_member_id,type,stop_position) values('${id(4, 5)}','${id(1, 5)}','${id(2, 5)}','arrived',2)`);
    expect(db().sql(decisionSql(5))).toBe("conflict"); expect(revision(5)).toBe("1");
  });
  it("keeps a new required need unresolved without proposal-specific sources", () => {
    seed(6);
    db().sql(`insert into public.plan_constraints(id,plan_id,member_id,kind,value,priority,idempotency_key,created_at)
      values('${id(4, 6)}','${id(1, 6)}','${id(2, 6)}','accessibility','Step-free entrance','required','new-need',now())`);
    expect(db().sql(decisionSql(6))).toBe("constraints_unresolved"); expect(revision(6)).toBe("1");
  });
  it("keeps the completed prefix through the direct route editor", () => {
    seed(7);
    db().sql(`insert into public.plan_actions(id,plan_id,actor_member_id,type,stop_position) values('${id(4, 7)}','${id(1, 7)}','${id(2, 7)}','arrived',2)`);
    expect(db().sql(`select public.replace_plan_route_atomic('${id(1, 7)}','${token(7)}',1,'${next}'::jsonb,null,true)`)).toBe("conflict");
    expect(revision(7)).toBe("1");
  });
  it("accepts ordinary one-pub and two-pub route replacements", () => {
    seed(8);
    const one = JSON.stringify([{ venueId: "venue-a", venueName: "A", position: 0 }]);
    const two = JSON.stringify([{ venueId: "venue-a", venueName: "A", position: 0 }, { venueId: "venue-b", venueName: "B", position: 1 }]);
    expect(db().sql(`select public.replace_plan_route_atomic('${id(1, 8)}','${token(8)}',1,'${one}'::jsonb,null,true)`)).toBe("ok");
    expect(db().sql(`select public.replace_plan_route_atomic('${id(1, 8)}','${token(8)}',2,'${two}'::jsonb,null,true)`)).toBe("ok");
    expect(revision(8)).toBe("3");
  });
  it("refuses a revoked member before creating a grounded proposal", () => {
    seed(9); addGuest(9);
    db().sql(`update public.plan_crew_members set membership_revoked_at=now(),token_hash='${token(209)}' where id='${id(2, 109)}'`);
    expect(guestProposal(9)).toBe("forbidden");
    expect(db().sql(`select count(*) from public.plan_route_proposals where id='${id(3, 109)}'`)).toBe("0");
  });
  it("refuses the old token after the same member seat rotates its token", () => {
    seed(10); addGuest(10);
    db().sql(`update public.plan_crew_members set token_hash='${token(210)}' where id='${id(2, 110)}'`);
    expect(guestProposal(10)).toBe("forbidden");
    expect(db().sql(`select count(*) from public.plan_route_proposals where id='${id(3, 110)}'`)).toBe("0");
  });
  it("lets a live guest propose and refuses a guest whose collaboration permission was removed", () => {
    seed(11); addGuest(11);
    expect(guestProposal(11)).toBe("created");
    seed(12); addGuest(12);
    db().sql(`update public.plan_crew_members set can_collaborate=false where id='${id(2, 112)}'`);
    expect(guestProposal(12)).toBe("forbidden");
  });
  it("rechecks the live token and collaboration permission when recording a vote", () => {
    seed(13); addGuest(13);
    const vote = (hash: string, key: string) => JSON.parse(db().sql(`select public.record_plan_member_vote_atomic(
      '${id(1, 13)}','${id(3, 13)}','${id(2, 113)}','${hash}','approve','${key}','${id(5, 13)}',now())`));
    expect(vote(token(113), "live-vote")).toMatchObject({ value: "approve" });
    db().sql(`update public.plan_crew_members set token_hash='${token(213)}' where id='${id(2, 113)}'`);
    expect(vote(token(113), "old-token-vote")).toEqual({ code: "forbidden" });
    expect(vote(token(213), "rotated-live-vote")).toMatchObject({ value: "approve" });
    db().sql(`update public.plan_crew_members set membership_revoked_at=now() where id='${id(2, 113)}'`);
    expect(vote(token(213), "revoked-vote")).toEqual({ code: "forbidden" });
  });
  it("refuses host decisions after revocation or token rotation", () => {
    seed(14); seed(15);
    db().sql(`update public.plan_crew_members set membership_revoked_at=now() where id='${id(2, 14)}'`);
    expect(db().sql(decisionSql(14))).toBe("forbidden");
    db().sql(`update public.plan_crew_members set token_hash='${token(215)}' where id='${id(2, 15)}'`);
    expect(db().sql(decisionSql(15))).toBe("forbidden");
    expect(revision(14)).toBe("1"); expect(revision(15)).toBe("1");
  });
  it("refuses the direct editor when the host membership is revoked", () => {
    seed(16);
    db().sql(`update public.plan_crew_members set membership_revoked_at=now() where id='${id(2, 16)}'`);
    expect(db().sql(`select public.replace_plan_route_atomic('${id(1, 16)}','${token(16)}',1,'${next}'::jsonb,null,true)`)).toBe("forbidden");
    expect(revision(16)).toBe("1");
  });
  it.each(["ordinary", "grounded"] as const)("allows every presence value for live host and guest %s proposals", (kind) => {
    for (const [index, presence] of ["in", "here", "on_the_way", "running_late", "start_without_me"].entries()) {
      const suffix = (kind === "ordinary" ? 50 : 60) + index;
      seed(suffix, kind === "grounded"); addGuest(suffix);
      for (const offset of [0, 100]) {
        const memberSuffix = suffix + offset;
        const proposalId = id(3, suffix + offset + 200);
        db().sql(`update public.plan_crew_members set status='${presence}' where id='${id(2, memberSuffix)}'`);
        const args = `'${id(1, suffix)}','${proposalId}','${id(2, memberSuffix)}'`;
        const payload = `1,'${next}'::jsonb,'Presence choice','[]'::jsonb,'[]'::jsonb,'presence-${memberSuffix}',now()`;
        const query = kind === "grounded"
          ? `select public.create_plan_grounded_proposal_atomic(${args},'${token(memberSuffix)}',${payload},
              'signature-checked-by-service','presence-generation-${memberSuffix}',now()+interval '5 minutes','venue-a','near')->>'code'`
          : `select public.create_plan_route_proposal_atomic(${args},${payload},'${token(memberSuffix)}')->>'code'`;
        expect(db().sql(query)).toBe("created");
        expect(db().sql(query)).toBe("replayed");
        expect(db().sql(`select count(*) from public.plan_route_proposals where id='${proposalId}'`)).toBe("1");
        expect(revision(suffix)).toBe("1");
      }
    }
  });

  it.each(["ordinary", "grounded"] as const)("checks membership changes after lookup before creating a %s proposal", (kind) => {
    for (const [index, change] of ["removed", "rotated", "permission"].entries()) {
      const suffix = (kind === "ordinary" ? 30 : 40) + index;
      seed(suffix, kind === "grounded"); addGuest(suffix);
      const capability = db().sql(`select token_hash from public.plan_crew_members where id='${id(2, suffix + 100)}' and membership_revoked_at is null`);
      const query = () => kind === "grounded" ? guestProposal(suffix) : db().sql(`select public.create_plan_route_proposal_atomic(
        '${id(1, suffix)}','${id(3, suffix + 100)}','${id(2, suffix + 100)}',1,'${next}'::jsonb,
        'Guest choice','[]'::jsonb,'[]'::jsonb,'guest-proposal-${suffix}',now(),'${capability}')->>'code'`);
      const update = change === "removed" ? "membership_revoked_at=now()"
        : change === "rotated" ? `token_hash='${token(suffix + 200)}'` : "can_collaborate=false";
      db().sql(`update public.plan_crew_members set status='here',${update} where id='${id(2, suffix + 100)}'`);
      expect(query()).toBe("forbidden");
      expect(db().sql(`select count(*) from public.plan_route_proposals where id='${id(3, suffix + 100)}'`)).toBe("0");
      db().sql(`update public.plan_crew_members set membership_revoked_at=null,token_hash='${capability}',can_collaborate=true where id='${id(2, suffix + 100)}'`);
      expect(query()).toBe("created");
    }
  });

  it("rolls back without changing saved routes", () => {
    db().applyFile(join(migrations, "rollback", name.replace(".sql", "_rollback.sql")));
    expect(revision(1)).toBe("2");
    expect(db().sql("select count(*) from information_schema.columns where table_schema='public' and table_name='plan_route_proposals' and column_name='grounding_proof'")).toBe("0");
  });
});
