// Migration 0236 on a real PostgreSQL replay. Before it: a feature request
// flipped to a standard post and back reads 'submitted' against a 'shipped'
// history, a worker whose lease expired resets the live lease of the worker
// that reclaimed the job, and a flagged comment waits in 'needs_review' for a
// review nobody does. After it: each is fixed, and the rollback applies.

import { readdirSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { asServiceRole, postgresSkipReason, startPostgres, type PostgresSession } from "./helpers/postgres";

const skipReason = postgresSkipReason();
const MIGRATIONS = join(process.cwd(), "supabase/migrations");
const NAME = "20261111060000_0236_social_moderation_remainder.sql";
const FORWARD = join(MIGRATIONS, NAME);
const ROLLBACK = join(MIGRATIONS, "rollback/20261111060000_0236_social_moderation_remainder_rollback.sql");

const AUTHOR_USER = "a2360000-0000-4000-8000-000000000001";
const AUTHOR = "a2360000-0000-4000-8000-000000000002";
const MOD_USER = "a2360000-0000-4000-8000-000000000003";
const MOD = "a2360000-0000-4000-8000-000000000004";
const STAFF = "a2360000-0000-4000-8000-000000000005";
const SOURCE = "a2360000-0000-4000-8000-000000000006";
const FEATURE = "a2360000-0000-4000-8000-000000000007";

let session: PostgresSession | null = null;
let keySeed = 0;

function db(): PostgresSession {
  if (!session) throw new Error("PostgreSQL 0236 session did not start.");
  return session;
}

function hex(): string {
  keySeed += 1;
  return keySeed.toString(16).padStart(64, "0");
}

function service(statement: string): string {
  return db().sql(asServiceRole(statement)).split("\n").pop() ?? "";
}

function comment(body: string): string {
  return service(`select id from public.create_social_comment('${MOD}','${SOURCE}','modcarol','${body}','${hex()}','${hex()}')`);
}

function featureUpdate(status: string, response: string): void {
  service(`select id from public.append_social_feature_update('${MOD}','${FEATURE}','${status}','${response}','${hex()}','${hex()}')`);
}

function flipKind(kind: "standard" | "feature_request"): void {
  const version = db().sql(`select mutation_version from public.social_posts where id='${FEATURE}'`);
  service(`select id from public.edit_social_post('${FEATURE}','${AUTHOR}',${version},'${kind}','public','Quiet pubs filter',
    null,null,'{}','open',null,null,true)`);
  db().sql(`update public.social_posts set moderation_state='approved', moderated_at=now() where id='${FEATURE}'`);
}

function feature(): string {
  return db().sql(`select coalesce(feature_status,'') || '|' || coalesce(feature_staff_response,'') from public.social_posts where id='${FEATURE}'`);
}

function expireLease(id: string): void {
  db().sql(`update public.social_interaction_moderation_jobs set lease_until = now() - interval '1 second' where content_id='${id}'`);
}

function job(id: string): string {
  return db().sql(`select state || '|' || attempts from public.social_interaction_moderation_jobs where content_id='${id}'`);
}

function commentState(id: string): string {
  return db().sql(`select status || '|' || moderation_state from public.social_comments where id='${id}'`);
}

beforeAll(async () => {
  if (skipReason) return;
  session = await startPostgres({ label: "social-moderation-0236", database: "social_moderation_0236" });
  try {
    db().applyFile(join(process.cwd(), "scripts/rls/session-fixture.sql"));
    for (const file of readdirSync(MIGRATIONS).filter((entry) => entry.endsWith(".sql") && entry < NAME).sort()) {
      db().applyFile(join(MIGRATIONS, file));
    }
    db().sql(`
      insert into auth.users(id) values ('${AUTHOR_USER}'),('${MOD_USER}');
      insert into public.profiles(id,user_id,handle) values ('${AUTHOR}','${AUTHOR_USER}','author236'),('${MOD}','${MOD_USER}','modcarol');
      insert into public.private_social_staff_roles(id,profile_id,display_name,role,active) values ('${STAFF}','${MOD}','Carol','moderator',true);
      insert into public.social_posts(id,author_profile_id,author_handle,kind,visibility,body,comment_policy,moderation_state,moderated_at)
        values ('${SOURCE}','${AUTHOR}','author236','standard','public','Source post','open','approved',now());
      insert into public.social_posts(id,author_profile_id,author_handle,kind,visibility,body,comment_policy,moderation_state,moderated_at,feature_status)
        values ('${FEATURE}','${AUTHOR}','author236','feature_request','public','Quiet pubs filter','open','approved',now(),'submitted');
    `);
  } catch (error) {
    await session.stop();
    session = null;
    throw error;
  }
}, 600_000);

afterAll(async () => {
  await session?.stop();
  session = null;
});

describe.skipIf(skipReason !== null)("0236 Social moderation remainder", () => {
  it("shows each fault before the migration", () => {
    featureUpdate("shipped", "Live now");
    flipKind("standard");
    flipKind("feature_request");
    expect(feature()).toBe("submitted|");

    const raced = comment("Raced lease");
    service(`select content_id from public.claim_social_interaction_moderation_jobs(20)`);
    expireLease(raced);
    service(`select content_id from public.claim_social_interaction_moderation_jobs(20)`);
    expect(service(`select public.complete_social_interaction_moderation_job('comment','${raced}',null,'stale_worker',now())`)).toBe("t");
    expect(job(raced)).toBe("pending|2");

    const flagged = comment("Flagged words");
    expect(service(`select public.complete_social_interaction_moderation_job('comment','${flagged}','needs_review',null,null)`)).toBe("t");
    expect(commentState(flagged)).toBe("visible|needs_review");
    db().sql(`delete from public.social_interaction_moderation_jobs`);
  });

  it("derives the feature status from history, also for rows written before it", () => {
    db().applyFile(FORWARD);
    expect(feature()).toBe("shipped|Live now");
    flipKind("standard");
    expect(feature()).toBe("|");
    flipKind("feature_request");
    expect(feature()).toBe("shipped|Live now");
    featureUpdate("declined", "Not this year");
    expect(feature()).toBe("declined|Not this year");
    db().sql(`update public.social_posts set feature_status='planned', feature_staff_response='Forged' where id='${FEATURE}'`);
    expect(feature()).toBe("declined|Not this year");
  });

  it("lets only the holder of the live lease finish an interaction job", () => {
    const raced = comment("Lease token");
    const stale = service(`select lease_token from public.claim_social_interaction_moderation_jobs(20) where content_id='${raced}'`);
    expireLease(raced);
    const live = service(`select lease_token from public.claim_social_interaction_moderation_jobs(20) where content_id='${raced}'`);
    expect(live).not.toBe(stale);
    expect(service(`select public.complete_social_interaction_moderation_job('comment','${raced}','${stale}',null,'stale_worker',now())`)).toBe("f");
    expect(service(`select public.complete_social_interaction_moderation_job('comment','${raced}','${stale}','approved',null,null)`)).toBe("f");
    expect(job(raced)).toBe("leased|2");
    expect(commentState(raced)).toBe("visible|pending");
    expect(service(`select public.complete_social_interaction_moderation_job('comment','${raced}','${live}','approved',null,null)`)).toBe("t");
    expect(commentState(raced)).toBe("visible|approved");
    expect(db().sql(`select count(*) from public.social_interaction_moderation_jobs where content_id='${raced}'`)).toBe("0");
    db().expectRefusal(asServiceRole(`select public.complete_social_interaction_moderation('comment','${raced}','approved')`));
  });

  it("hides a flagged comment at once and refuses the needs_review state", () => {
    const flagged = comment("Flagged again");
    const token = service(`select lease_token from public.claim_social_interaction_moderation_jobs(20) where content_id='${flagged}'`);
    expect(service(`select public.complete_social_interaction_moderation_job('comment','${flagged}','${token}','needs_review',null,null)`)).toBe("t");
    expect(commentState(flagged)).toBe("hidden|approved");
    expect(db().sql(`select count(*) from public.social_comments where moderation_state='needs_review'`)).toBe("0");
    db().expectRefusal(`update public.social_comments set moderation_state='needs_review' where id='${flagged}'`);
  });

  it("rolls back and applies again", () => {
    db().applyFile(ROLLBACK);
    const after = comment("After rollback");
    expect(service(`select content_id from public.claim_social_interaction_moderation_jobs(20) where content_id='${after}'`)).toBe(after);
    expect(service(`select public.complete_social_interaction_moderation_job('comment','${after}','approved',null,null)`)).toBe("t");
    expect(feature()).toBe("declined|Not this year");
    db().applyFile(FORWARD);
    expect(feature()).toBe("declined|Not this year");
  });
});
