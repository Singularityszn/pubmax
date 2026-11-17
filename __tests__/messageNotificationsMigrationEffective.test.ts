import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startPostgres, type PostgresSession } from "./helpers/postgres";

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
  it("adds durable consent and claims without granting browser access, then rolls back", () => {
    expect(database.sql("select to_regclass('public.message_push_subscriptions') is null")).toBe("t");
    database.applyFile(join(process.cwd(), "supabase/migrations/20261116220000_0242_message_notifications.sql"));
    database.sql(`set role service_role;
      insert into public.message_notification_preferences(user_id) values ('${OWNER}');
      insert into public.message_notification_mutes(user_id, conversation_id) values ('${OWNER}', '${THREAD}');
      insert into public.message_push_subscriptions(endpoint_hash, user_id, session_id, token) values ('hash', '${OWNER}', '${SESSION}', 'private-token');
      insert into public.message_notification_claims(user_id, message_id) values ('${OWNER}', '${MESSAGE}'); reset role;`);
    expect(database.sql(`select token from public.message_notification_targets('${OWNER}', '${THREAD}')`)).toBe("private-token");
    database.sql(`update public.message_push_subscriptions set active_conversation_id='${THREAD}',last_seen=now()`);
    expect(database.sql(`select token from public.message_notification_targets('${OWNER}', '${THREAD}')`)).toBe("");
    const version = database.sql("select xmin::text from public.message_push_subscriptions where endpoint_hash='hash'");
    expect(database.sql(`set role service_role; select public.message_notification_bind('${OWNER}', '${SESSION}', 'hash', 'private-token');`)).toBe("t");
    database.sql("reset role;");
    expect(database.sql(`select token from public.message_notification_targets('${OWNER}', '${THREAD}')`)).toBe("");
    expect(database.sql("select xmin::text from public.message_push_subscriptions where endpoint_hash='hash'")).toBe(version);
    expect(database.sql(`select public.message_notification_bind('${OWNER}', '${SESSION}', 'hash', 'wrong-secret')`)).toBe("f");
    expect(database.sql(`select public.message_notification_bind('${OWNER}', 'd0000000-0000-4000-8000-000000000002', 'hash', 'private-token')`)).toBe("t");
    expect(database.sql("select active_conversation_id is null and last_seen is null from public.message_push_subscriptions where endpoint_hash='hash'")).toBe("t");
    expect(database.sql(`select public.message_notification_bind('${OWNER}', '${SESSION}', 'hash', 'private-token')`)).toBe("t");
    database.sql(`update public.message_push_subscriptions set active_conversation_id='${THREAD}',last_seen=now()`);
    database.sql("update public.message_push_subscriptions set last_seen=now()-interval '31 seconds'");
    expect(database.sql(`select token from public.message_notification_targets('${OWNER}', '${THREAD}')`)).toBe("private-token");
    expect(database.sql(`select enabled, preview from public.message_notification_preferences where user_id='${OWNER}'`)).toBe("f|f");
    for (const table of ["message_notification_preferences", "message_notification_mutes", "message_push_subscriptions", "message_notification_claims"]) {
      for (const role of ["anon", "authenticated"]) {
        expect(database.sql(`select has_table_privilege('${role}', 'public.${table}', 'SELECT,INSERT,UPDATE,DELETE')`)).toBe("f");
      }
    }
    expect(database.sql(`with claimed as (insert into public.message_notification_claims(user_id,message_id) values ('${OWNER}','${MESSAGE}') on conflict do nothing returning *) select count(*) from claimed`)).toBe("0");
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
    database.sql(`delete from auth.users where id='${OWNER}'`);
    expect(database.sql("select count(*) from public.message_push_subscriptions")).toBe("0");
    expect(database.sql("select count(*) from public.message_notification_claims")).toBe("0");
    database.applyFile(join(process.cwd(), "supabase/migrations/rollback/20261116220000_0242_message_notifications_rollback.sql"));
    expect(database.sql("select to_regclass('public.message_push_subscriptions') is null")).toBe("t");
  });
});
