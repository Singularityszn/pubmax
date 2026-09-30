import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { postgresSkipReason, startPostgres, type PostgresSession } from "./helpers/postgres";

const migration = join(process.cwd(), "supabase/migrations/20260930120000_0175_friend_locations.sql");
const rollback = join(process.cwd(), "supabase/migrations/rollback/20260930120000_0175_friend_locations_rollback.sql");
const ids = [1, 2, 3].map((n) => `10000000-0000-4000-8000-00000000000${n}`);
let pg: PostgresSession;
const call = (actor: string, action: string, input: Record<string, unknown> = {}) => {
  if (action === "start" && !Object.hasOwn(input, "expectedGeneration")) {
    const current = JSON.parse(pg.sql(`select public.friend_location_operation('${actor}','read','{}'::jsonb)`));
    input = { ...input, expectedGeneration: current.generation };
  }
  return JSON.parse(pg.sql(`select public.friend_location_operation('${actor}','${action}','${JSON.stringify(input)}'::jsonb)`));
};
const point = { latitude: 51.5, longitude: -0.1, accuracy: 12 };
beforeAll(async () => {
  pg = await startPostgres({ label: "friend-locations", database: "friend_locations" });
  pg.sql(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key, banned_until timestamptz, deleted_at timestamptz);
    create table public.profiles(id uuid primary key, user_id uuid, handle text, tombstoned_at timestamptz);
    create table public.private_social_accounts(id uuid primary key, profile_id uuid, supabase_user_id uuid, ownership_state text);
    create table public.private_account_identities(user_id uuid, date_of_birth date);
    create table public.adult_self_assertions(user_id uuid, asserted_at timestamptz);
    create table public.follows(follower_id uuid, followee_id uuid);
    create table public.social_blocks(blocker_profile_id uuid, blocked_profile_id uuid);`);
  const source = readFileSync(join(process.cwd(), "supabase/migrations/20260806235944_0075_social_crews.sql"), "utf8");
  pg.sql(source.slice(source.indexOf("create function public.social_relationship_between_profiles("), source.indexOf("create function public._social_crew_begin_write(")));
  for (const [i, id] of ids.entries()) pg.sql(`insert into auth.users(id) values('${id}'); insert into profiles values('${id}','${id}','mate${i}',null); insert into private_social_accounts values('${id}','${id}','${id}','active'); insert into adult_self_assertions values('${id}',now());`);
  pg.sql(`insert into follows values('${ids[0]}','${ids[1]}'),('${ids[1]}','${ids[0]}');`);
  pg.applyFile(migration);
}, 30_000);
afterAll(async () => { if (pg) await pg.stop(); });

describe.skipIf(Boolean(postgresSkipReason()))("private friend location SQL", () => {
  it("shows only explicitly selected mutuals; strangers and forged actors fail closed", () => {
    expect(call(ids[1], "read").friends).toEqual([]);
    const share = call(ids[0], "start", { ...point, recipients: [ids[1]] });
    expect(share.ok).toBe(true);
    expect(call(ids[1], "read").friends[0].latitude).toBe(51.5);
    expect(call(ids[2], "read").friends).toEqual([]);
    expect(call("90000000-0000-4000-8000-000000000000", "read").ok).toBe(false);
    expect(call(ids[0], "start", { ...point, recipients: [ids[2]] }).code).toBe("recipient_refused");
  });
  it("checks current block, mutual, live account and adult state on every read", () => {
    pg.sql(`insert into social_blocks values('${ids[1]}','${ids[0]}')`);
    expect(call(ids[1], "read").friends).toEqual([]);
    pg.sql("delete from social_blocks");
    pg.sql(`delete from follows where follower_id='${ids[1]}'`);
    expect(call(ids[1], "read").friends).toEqual([]);
    pg.sql(`insert into follows values('${ids[1]}','${ids[0]}'); update private_social_accounts set ownership_state='suspended' where id='${ids[0]}'`);
    expect(call(ids[1], "read").friends).toEqual([]);
    pg.sql(`update private_social_accounts set ownership_state='active'; delete from adult_self_assertions where user_id='${ids[0]}'`);
    expect(call(ids[1], "read").friends).toEqual([]);
    pg.sql(`insert into adult_self_assertions values('${ids[0]}',now()); update auth.users set banned_until=now()+interval '1 hour' where id='${ids[0]}'`);
    expect(call(ids[1], "read").friends).toEqual([]);
    pg.sql("update auth.users set banned_until=null");
  });
  it("bounds lifetime and rechecks stored identity bindings and deletion", () => {
    const share = call(ids[0], "start", { ...point, recipients: [ids[1]] }).own;
    expect(pg.expectRefusal("update private_friend_location_sessions set expires_at=started_at+interval '2 hours'")).toContain("check constraint");
    pg.sql(`update private_friend_location_sessions set owner_profile_id='${ids[2]}'`);
    expect(call(ids[1], "read").friends).toEqual([]);
    pg.sql(`update private_friend_location_sessions set owner_profile_id='${ids[0]}'; update private_friend_location_grants set recipient_user_id='${ids[2]}'`);
    expect(call(ids[1], "read").friends).toEqual([]);
    pg.sql(`update private_friend_location_grants set recipient_user_id='${ids[1]}'`);
    expect(call(ids[0], "update", { ...point, sessionId: share.sessionId, revision: null }).ok).toBe(false);
    expect(call(ids[0], "start", { ...point, recipients: Array(21).fill(ids[1]) }).code).toBe("invalid");
    pg.sql(`delete from auth.users where id='${ids[1]}'`);
    expect(pg.sql("select count(*) from private_friend_location_grants")).toBe("0");
    pg.sql(`insert into auth.users(id) values('${ids[1]}')`);
  });
  it("rejects stale updates, never extends expiry and removes coordinates during revoke", async () => {
    const share = call(ids[0], "start", { ...point, recipients: [ids[1]] }).own;
    const update = { ...point, sessionId: share.sessionId, revision: share.revision };
    const statements = ["update", "revoke"].map((action) => `select public.friend_location_operation('${ids[0]}','${action}','${JSON.stringify(update)}')`);
    await pg.concurrentResults(statements);
    const current = call(ids[0], "read").own;
    if (current) expect(call(ids[0], "revoke", { sessionId: current.sessionId, revision: current.revision }).ok).toBe(true);
    expect(call(ids[0], "update", update).ok).toBe(false);
    expect(call(ids[1], "read").friends).toEqual([]);
    expect(pg.sql("select count(*) from private_friend_location_sessions where latitude is not null")).toBe("0");
  });
  it("refuses an old start generation after a newer start wins the actor lock", () => {
    const generation = call(ids[0], "read").generation ?? 0;
    const oldInput = { ...point, recipients: [ids[1]], expectedGeneration: generation };
    const newer = call(ids[0], "start", { ...oldInput, latitude: 51.512 }).own;
    expect(call(ids[0], "start", oldInput).code).toBe("conflict");
    expect(call(ids[0], "read").own.sessionId).toBe(newer.sessionId);
    expect(call(ids[1], "read").friends[0].latitude).toBe(51.512);
  });
  it("atomically fences a not-yet-arrived start and retains its generation through revoke and purge", () => {
    const prior = call(ids[0], "read");
    if (prior.own) call(ids[0], "revoke", { sessionId: prior.own.sessionId, revision: prior.own.revision });
    const generation = call(ids[0], "read").generation ?? 0;
    const reconciled = call(ids[0], "reconcile", { expectedGeneration: generation });
    expect(reconciled.ok).toBe(true);
    expect(reconciled.own).toBeNull();
    expect(reconciled.generation).toBe(generation + 1);
    const input = { ...point, recipients: [ids[1]], expectedGeneration: generation };
    expect(call(ids[0], "start", input).code).toBe("conflict");
    const newer = call(ids[0], "start", { ...input, expectedGeneration: reconciled.generation });
    expect(newer.ok).toBe(true);
    expect(call(ids[0], "revoke", { sessionId: newer.own.sessionId, revision: newer.own.revision }).ok).toBe(true);
    pg.sql("select purge_friend_locations()");
    const absent = call(ids[0], "read");
    expect(absent.own).toBeNull();
    expect(absent.generation).toBeGreaterThan(generation);
    expect(call(ids[0], "start", input).code).toBe("conflict");
  });
  it("returns the accepted share when its start wins before uncertain reconciliation", () => {
    const generation = call(ids[0], "read").generation ?? 0;
    const accepted = call(ids[0], "start", { ...point, recipients: [ids[1]], expectedGeneration: generation });
    expect(accepted.ok).toBe(true);
    const reconciled = call(ids[0], "reconcile", { expectedGeneration: generation });
    expect(reconciled.ok).toBe(true);
    expect(reconciled.own.sessionId).toBe(accepted.own.sessionId);
    expect(reconciled.generation).toBe(accepted.generation);
    expect(call(ids[0], "start", { ...point, recipients: [ids[1]], expectedGeneration: generation }).code).toBe("conflict");
  });
  it("advances the account generation on Stop so an earlier submitted replacement cannot recreate sharing", () => {
    const prior = call(ids[0], "read");
    if (prior.own) call(ids[0], "revoke", { sessionId: prior.own.sessionId, revision: prior.own.revision });
    const generation = call(ids[0], "read").generation ?? 0;
    const share = call(ids[0], "start", { ...point, recipients: [ids[1]], expectedGeneration: generation });
    const pendingReplacement = { ...point, recipients: [ids[1]], expectedGeneration: share.generation ?? generation };
    const stopped = call(ids[0], "revoke", { sessionId: share.own.sessionId, revision: share.own.revision });
    expect(stopped.ok).toBe(true);
    expect(stopped.generation).toBeGreaterThan(pendingReplacement.expectedGeneration);
    pg.sql("select purge_friend_locations()");
    expect(call(ids[0], "start", pendingReplacement).code).toBe("conflict");
    expect(call(ids[0], "read").own).toBeNull();
    expect(call(ids[1], "read").friends).toEqual([]);
  });
  it("returns confirmed accuracy to the owner without returning the owner's coordinates", () => {
    const share = call(ids[0], "start", { ...point, accuracy: 5270.4, recipients: [ids[1]] }).own;
    expect(share.accuracy).toBe(5270.4);
    expect(share).not.toHaveProperty("latitude");
    expect(share).not.toHaveProperty("longitude");
    expect(call(ids[0], "read").own.accuracy).toBe(5270.4);
    const update = call(ids[0], "update", { ...point, accuracy: 280.2, sessionId: share.sessionId, revision: share.revision }).own;
    expect(update.accuracy).toBe(280.2);
    expect(update).not.toHaveProperty("latitude");
    expect(update).not.toHaveProperty("longitude");
    expect(call(ids[0], "read").own.accuracy).toBe(280.2);
  });
  it("advances generation on an already-revoked Retry Stop so a later pending start is fenced", () => {
    const share = call(ids[0], "start", { ...point, recipients: [ids[1]] });
    const stop = { sessionId: share.own.sessionId, revision: share.own.revision };
    const first = call(ids[0], "revoke", stop);
    expect(first.ok).toBe(true);
    const pending = { ...point, recipients: [ids[1]], expectedGeneration: first.generation };
    const retried = call(ids[0], "revoke", stop);
    expect(retried.ok).toBe(true);
    expect(retried.own).toBeNull();
    expect(retried.generation).toBeGreaterThan(first.generation);
    expect(call(ids[0], "start", pending).code).toBe("conflict");
    expect(call(ids[1], "read").friends).toEqual([]);
    expect(pg.sql("select count(*) from private_friend_location_sessions where latitude is not null")).toBe("0");
  });
  it("expires stale points, purges expired sessions and refuses direct client access", () => {
    call(ids[0], "start", { ...point, recipients: [ids[1]] });
    pg.sql("update private_friend_location_sessions set updated_at=now()-interval '3 minutes'");
    expect(call(ids[1], "read").friends).toEqual([]);
    for (const role of ["anon", "authenticated"]) {
      expect(pg.expectRefusal(`set role ${role}; select * from private_friend_location_sessions`)).toContain("permission denied");
      expect(pg.expectRefusal(`set role ${role}; select friend_location_operation('${ids[0]}','read','{}')`)).toContain("permission denied");
    }
    pg.sql("update private_friend_location_sessions set started_at=now()-interval '2 hours', expires_at=now()-interval '1 hour'");
    expect(pg.sql("select purge_friend_locations()")).toBe("1");
    pg.applyFile(rollback);
    expect(pg.sql("select to_regclass('public.private_friend_location_sessions') is null")).toBe("t");
    expect(pg.sql("select to_regclass('public.private_friend_location_generations') is null")).toBe("t");
  });
});
