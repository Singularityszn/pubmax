import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startPostgres, type PostgresSession } from "./helpers/postgres";

import { exerciseBindingOrdering, FAST_CLOCK_BASE, type BindingVectorStore } from "./helpers/messageBindingVectors";
import { exercisePresenceOrdering } from "./helpers/messagePresenceVectors";

let database: PostgresSession;
const OWNER = "a0000000-0000-4000-8000-000000000001";
const SESSION = "d0000000-0000-4000-8000-000000000001";
const THREAD = "b0000000-0000-4000-8000-000000000001";
const MESSAGE = "c0000000-0000-4000-8000-000000000001";

beforeAll(async () => {
  database = await startPostgres({ label: "message-notifications" });
  database.applyFile(join(process.cwd(), "scripts/rls/session-fixture.sql"));
  database.sql(`create table auth.sessions (id uuid primary key, user_id uuid not null references auth.users(id), not_after timestamptz);
    create table public.conversations (id uuid primary key); create table public.messages (id uuid primary key);
    insert into auth.users(id) values ('${OWNER}'); insert into auth.sessions(id,user_id) values ('${SESSION}','${OWNER}');
    insert into public.conversations values ('${THREAD}'); insert into public.messages values ('${MESSAGE}');`);
});
afterAll(async () => { await database?.stop(); });

describe("message notification privacy migration", () => {
  it("adds durable consent and claims without granting browser access, then rolls back", async () => {
    expect(database.sql("select to_regclass('public.message_push_subscriptions') is null")).toBe("t");
    database.applyFile(join(process.cwd(), "supabase/migrations/20261116220000_0242_message_notifications.sql"));
    expect(database.sql("select to_regprocedure('public.message_notification_presence(uuid,uuid,text,text,uuid,bigint,bigint)') is null")).toBe("t");
    database.sql(`set role service_role;
      insert into public.message_notification_preferences(user_id) values ('${OWNER}');
      insert into public.message_notification_mutes(user_id, conversation_id) values ('${OWNER}', '${THREAD}');
      insert into public.message_push_subscriptions(endpoint_hash, user_id, session_id, token) values ('hash', '${OWNER}', '${SESSION}', 'private-token');
      insert into public.message_notification_claims(user_id, message_id) values ('${OWNER}', '${MESSAGE}'); reset role;`);
    expect(database.sql(`select enabled, preview from public.message_notification_preferences where user_id='${OWNER}'`)).toBe("f|f");
    database.sql(`update public.message_notification_preferences set enabled=true, preview=true where user_id='${OWNER}';
      update public.message_push_subscriptions set active_conversation_id='${THREAD}', last_seen=now() where endpoint_hash='hash';`);
    expect(database.sql(`select token from public.message_notification_targets('${OWNER}', '${THREAD}')`)).toBe("");
    database.applyFile(join(process.cwd(), "supabase/migrations/20261117100000_0243_message_notification_presence_order.sql"));
    expect(database.sql("select token, presence_activity_id, presence_revision from public.message_push_subscriptions where endpoint_hash='hash'")).toBe("private-token|0|0");
    expect(database.sql(`select token from public.message_notification_targets('${OWNER}', '${THREAD}')`)).toBe("");
    expect(database.sql(`select enabled, preview from public.message_notification_preferences where user_id='${OWNER}'`)).toBe("t|t");
    const presence = (conversation: string | null, activity: number, revision: number, session = SESSION) => database.sql(`set role service_role; select public.message_notification_presence('${OWNER}', '${session}', 'hash', 'private-token', ${conversation ? `'${conversation}'` : "null"}, ${activity}, ${revision}); reset role;`);
    await exercisePresenceOrdering({
      start: async scope => {
        const result = await database.sqlAsync(`set role service_role; select public.message_notification_presence_start(
          '${scope === "other-user" ? "a0000000-0000-4000-8000-000000000002" : OWNER}',
          '${scope === "other-session" ? "d0000000-0000-4000-8000-000000000002" : SESSION}',
          '${scope === "other-device" ? "other-hash" : "hash"}', '${scope === "wrong-secret" ? "wrong-token" : "private-token"}'); reset role;`);
        return result ? Number(result) : null;
      },
      write: async (thread, activity, revision, scope) => {
        return database.sql(`set role service_role; select public.message_notification_presence(
          '${scope === "other-user" ? "a0000000-0000-4000-8000-000000000002" : OWNER}',
          '${scope === "other-session" ? "d0000000-0000-4000-8000-000000000002" : SESSION}',
          '${scope === "other-device" ? "other-hash" : "hash"}', '${scope === "wrong-secret" ? "wrong-token" : "private-token"}',
          ${thread ? `'${thread}'` : "null"}, ${activity}, ${revision}); reset role;`) === "t";
      },
      suppressed: async () => database.sql(`select token from public.message_notification_targets('${OWNER}', '${THREAD}')`) === "",
    });
    database.sql(`update public.message_push_subscriptions set presence_activity_id=0, presence_revision=0, presence_generation=0`);
    const start = () => database.sql(`set role service_role; select public.message_notification_presence_start('${OWNER}', '${SESSION}', 'hash', 'private-token'); reset role;`);
    start();
    const otherThread = "b0000000-0000-4000-8000-000000000002";
    const activityA = 1;
    const activityB = 2;
    database.sql(`insert into public.conversations values ('${otherThread}')`);
    presence(THREAD, activityA, 1);
    start();
    presence(otherThread, activityB, 3);
    presence(null, activityA, 4);
    presence(THREAD, activityA, 2);
    expect(database.sql(`select token from public.message_notification_targets('${OWNER}', '${otherThread}')`)).toBe("");
    expect(database.sql(`select token from public.message_notification_targets('${OWNER}', '${THREAD}')`)).toBe("private-token");
    presence(null, activityB, 6);
    presence(otherThread, activityB, 5);
    expect(database.sql(`select token from public.message_notification_targets('${OWNER}', '${otherThread}')`)).toBe("private-token");
    presence(THREAD, activityA, 7, "d0000000-0000-4000-8000-000000000002");
    expect(database.sql(`select token from public.message_notification_targets('${OWNER}', '${THREAD}')`)).toBe("private-token");
    presence(THREAD, activityB, 7);
    expect(database.sql(`select token from public.message_notification_targets('${OWNER}', '${THREAD}')`)).toBe("");
    presence(null, activityB, 20);
    start();
    presence(THREAD, 3, 1);
    expect(database.sql(`select token from public.message_notification_targets('${OWNER}', '${THREAD}')`)).toBe("");
    database.sql(`update public.message_push_subscriptions set active_conversation_id='${THREAD}',last_seen=now()`);
    expect(database.sql(`select token from public.message_notification_targets('${OWNER}', '${THREAD}')`)).toBe("");
    const version = database.sql("select xmin::text from public.message_push_subscriptions where endpoint_hash='hash'");
    expect(database.sql(`set role service_role; select public.message_notification_bind('${OWNER}', '${SESSION}', 'hash', 'private-token');`)).toBe("t");
    database.sql("reset role;");
    expect(database.sql(`select token from public.message_notification_targets('${OWNER}', '${THREAD}')`)).toBe("");
    expect(database.sql("select xmin::text from public.message_push_subscriptions where endpoint_hash='hash'")).toBe(version);
    expect(database.sql(`select public.message_notification_bind('${OWNER}', '${SESSION}', 'hash', 'wrong-secret')`)).toBe("f");
    expect(database.sql(`select public.message_notification_bind('${OWNER}', 'd0000000-0000-4000-8000-000000000002', 'hash', 'private-token')`)).toBe("t");
    expect(database.sql("select active_conversation_id is null and last_seen is null and presence_activity_id = 0 and presence_revision = 0 from public.message_push_subscriptions where endpoint_hash='hash'")).toBe("t");
    expect(database.sql(`select public.message_notification_bind('${OWNER}', '${SESSION}', 'hash', 'private-token')`)).toBe("t");
    database.sql(`update public.message_push_subscriptions set active_conversation_id='${THREAD}',last_seen=now()`);
    database.sql("update public.message_push_subscriptions set last_seen=now()-interval '31 seconds'");
    expect(database.sql(`select token from public.message_notification_targets('${OWNER}', '${THREAD}')`)).toBe("private-token");
    expect(database.sql(`select enabled, preview from public.message_notification_preferences where user_id='${OWNER}'`)).toBe("t|t");
    for (const table of ["message_notification_preferences", "message_notification_mutes", "message_push_subscriptions", "message_notification_claims"]) {
      for (const role of ["anon", "authenticated"]) {
        expect(database.sql(`select has_table_privilege('${role}', 'public.${table}', 'SELECT,INSERT,UPDATE,DELETE')`)).toBe("f");
      }
    }
    expect(database.sql(`with claimed as (insert into public.message_notification_claims(user_id,message_id) values ('${OWNER}','${MESSAGE}') on conflict do nothing returning *) select count(*) from claimed`)).toBe("0");
    database.applyFile(join(process.cwd(), "supabase/migrations/rollback/20261117100000_0243_message_notification_presence_order_rollback.sql"));
    expect(database.sql("select to_regprocedure('public.message_notification_presence(uuid,uuid,text,text,uuid,bigint,bigint)') is null")).toBe("t");
    expect(database.sql(`select token from public.message_notification_targets('${OWNER}', '${THREAD}')`)).toBe("private-token");
    expect(database.sql(`select enabled, preview from public.message_notification_preferences where user_id='${OWNER}'`)).toBe("t|t");
    expect(database.sql("select count(*) from public.message_notification_mutes")).toBe("1");
    expect(database.sql("select count(*) from public.message_notification_claims")).toBe("1");
    expect(database.sql(`set role service_role; select public.message_notification_bind('${OWNER}', 'd0000000-0000-4000-8000-000000000002', 'hash', 'private-token'); reset role;`)).toBe("t");
    expect(database.sql("select active_conversation_id is null and last_seen is null from public.message_push_subscriptions where endpoint_hash='hash'")).toBe("t");
    database.applyFile(join(process.cwd(), "supabase/migrations/20261117100000_0243_message_notification_presence_order.sql"));
    expect(database.sql(`set role service_role; select public.message_notification_bind('${OWNER}', '${SESSION}', 'hash', 'private-token'); reset role;`)).toBe("t");
    start();
    presence(THREAD, 1, 1);
    expect(database.sql(`select token from public.message_notification_targets('${OWNER}', '${THREAD}')`)).toBe("");
    expect(database.sql("select has_function_privilege('service_role', 'public.message_notification_presence(uuid,uuid,text,text,uuid,bigint,bigint)', 'EXECUTE')")).toBe("t");
    expect(database.sql(`set role service_role; select public.message_notification_session_active('${OWNER}', '${SESSION}');`)).toBe("t");
    database.sql("reset role;");
    expect(database.sql(`select public.message_notification_session_active('a0000000-0000-4000-8000-000000000002', '${SESSION}')`)).toBe("f");
    database.sql(`update auth.sessions set not_after=now()-interval '1 second' where id='${SESSION}'`);
    expect(database.sql(`select public.message_notification_session_active('${OWNER}', '${SESSION}')`)).toBe("f");
    database.sql(`delete from auth.sessions where id='${SESSION}'`);
    expect(database.sql(`select public.message_notification_session_active('${OWNER}', '${SESSION}')`)).toBe("f");
    expect(database.sql("select count(*) from public.message_push_subscriptions")).toBe("1");
    expect(database.sql(`select token from public.message_notification_targets('${OWNER}', '${THREAD}')`)).toBe("");
    expect(database.sql("select count(*) from public.message_push_subscriptions")).toBe("0");
    database.sql("drop table auth.sessions");
    expect(database.sql(`select public.message_notification_session_active('${OWNER}', '${SESSION}')`)).toBe("f");
    for (const role of ["anon", "authenticated"]) expect(database.sql(`select has_function_privilege('${role}', 'public.message_notification_session_active(uuid,uuid)', 'EXECUTE')`)).toBe("f");
    for (const role of ["anon", "authenticated"]) expect(database.sql(`select has_function_privilege('${role}', 'public.message_notification_targets(uuid,uuid)', 'EXECUTE')`)).toBe("f");
    for (const role of ["anon", "authenticated"]) expect(database.sql(`select has_function_privilege('${role}', 'public.message_notification_bind(uuid,uuid,text,text)', 'EXECUTE')`)).toBe("f");
    for (const role of ["anon", "authenticated"]) expect(database.sql(`select has_function_privilege('${role}', 'public.message_notification_presence_start(uuid,uuid,text,text)', 'EXECUTE')`)).toBe("f");
    for (const role of ["anon", "authenticated"]) expect(database.sql(`select has_function_privilege('${role}', 'public.message_notification_presence(uuid,uuid,text,text,uuid,bigint,bigint)', 'EXECUTE')`)).toBe("f");
    database.sql(`delete from auth.users where id='${OWNER}'`);
    expect(database.sql("select count(*) from public.message_push_subscriptions")).toBe("0");
    expect(database.sql("select count(*) from public.message_notification_claims")).toBe("0");
    database.applyFile(join(process.cwd(), "supabase/migrations/rollback/20261117100000_0243_message_notification_presence_order_rollback.sql"));
    database.applyFile(join(process.cwd(), "supabase/migrations/rollback/20261116220000_0242_message_notifications_rollback.sql"));
    expect(database.sql("select to_regclass('public.message_push_subscriptions') is null")).toBe("t");
  });

  it("lets the device's last-issued binding write win over a delayed one, then rolls back", async () => {
    const other = "a0000000-0000-4000-8000-000000000002";
    const otherSession = "d0000000-0000-4000-8000-000000000002";
    const scope = { A: [OWNER, SESSION], B: [other, otherSession] } as const;
    database.sql(`create table auth.sessions (id uuid primary key, user_id uuid not null references auth.users(id), not_after timestamptz);
      insert into auth.users(id) values ('${OWNER}'), ('${other}');
      insert into auth.sessions(id,user_id) values ('${SESSION}','${OWNER}'), ('${otherSession}','${other}');`);
    database.applyFile(join(process.cwd(), "supabase/migrations/20261116220000_0242_message_notifications.sql"));
    database.applyFile(join(process.cwd(), "supabase/migrations/20261117100000_0243_message_notification_presence_order.sql"));
    database.sql(`insert into public.message_push_subscriptions(endpoint_hash, user_id, session_id, token) values ('legacy', '${OWNER}', '${SESSION}', 'legacy-token')`);
    database.applyFile(join(process.cwd(), "supabase/migrations/20261125090000_0267_message_push_binding_order.sql"));
    expect(database.sql("select bind_sequence from public.message_push_subscriptions where endpoint_hash='legacy'")).toBe("0");
    const call = (statement: string) => database.sql(`set role service_role; ${statement}; reset role;`);
    const release = (sequence: number, session: string | null) => call(`select public.message_notification_release('hash', 'private-token', ${sequence}, ${session ? `'${session}'` : "null"})`);
    const adapter: BindingVectorStore = {
      bind: async (owner, sequence) => call(`select public.message_notification_bind_ordered('${scope[owner][0]}', '${scope[owner][1]}', 'hash', 'private-token', ${sequence})`) === "t",
      release: async (owner, sequence) => { release(sequence, scope[owner][1]); },
      unbind: async sequence => { release(sequence, null); },
      owner: async () => {
        const owner = database.sql("select user_id from public.message_push_subscriptions where endpoint_hash='hash'");
        return owner === OWNER ? "A" : owner === other ? "B" : owner ? (() => { throw new Error(owner); })() : null;
      },
    };
    await exerciseBindingOrdering(adapter);
    await exerciseBindingOrdering(adapter, FAST_CLOCK_BASE());
    call(`select public.message_notification_release('legacy', 'legacy-token', 1, '${SESSION}')`);
    expect(database.sql("select count(*) from public.message_push_subscriptions where endpoint_hash='legacy'")).toBe("0");
    expect(call(`select public.message_notification_bind_ordered('${OWNER}', '${SESSION}', 'hash', 'private-token', 19)`)).toBe("t");
    expect(call(`select public.message_notification_bind_ordered('${OWNER}', '${SESSION}', 'hash', 'wrong-token', 20)`)).toBe("f");
    database.sql(`update public.message_push_subscriptions set active_conversation_id='${THREAD}', last_seen=now(), presence_generation=1, presence_activity_id=1, presence_revision=1`);
    expect(call(`select public.message_notification_bind_ordered('${OWNER}', '${SESSION}', 'hash', 'private-token', 21)`)).toBe("t");
    expect(database.sql(`select token from public.message_notification_targets('${OWNER}', '${THREAD}')`)).toBe("");
    expect(call(`select public.message_notification_bind_ordered('${other}', '${otherSession}', 'hash', 'private-token', 22)`)).toBe("t");
    expect(database.sql("select active_conversation_id is null and last_seen is null and presence_generation + presence_activity_id + presence_revision = 0 from public.message_push_subscriptions where endpoint_hash='hash'")).toBe("t");
    for (const role of ["anon", "authenticated"]) {
      expect(database.sql(`select has_function_privilege('${role}', 'public.message_notification_bind_ordered(uuid,uuid,text,text,bigint)', 'EXECUTE')`)).toBe("f");
      expect(database.sql(`select has_function_privilege('${role}', 'public.message_notification_release(text,text,bigint,uuid)', 'EXECUTE')`)).toBe("f");
    }
    database.applyFile(join(process.cwd(), "supabase/migrations/rollback/20261125090000_0267_message_push_binding_order_rollback.sql"));
    expect(database.sql("select to_regprocedure('public.message_notification_bind_ordered(uuid,uuid,text,text,bigint)') is null and to_regprocedure('public.message_notification_release(text,text,bigint,uuid)') is null")).toBe("t");
    expect(database.sql(`select user_id from public.message_push_subscriptions where endpoint_hash='hash'`)).toBe(other);
    expect(call(`select public.message_notification_bind('${OWNER}', '${SESSION}', 'hash', 'private-token')`)).toBe("t");
    database.applyFile(join(process.cwd(), "supabase/migrations/rollback/20261117100000_0243_message_notification_presence_order_rollback.sql"));
    database.applyFile(join(process.cwd(), "supabase/migrations/rollback/20261116220000_0242_message_notifications_rollback.sql"));
  });
});
