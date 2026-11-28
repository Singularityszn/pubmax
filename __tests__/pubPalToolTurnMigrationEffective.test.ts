import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { postgresSkipReason, startPostgres, type PostgresSession } from "./helpers/postgres";

const skipReason = postgresSkipReason();
let session: PostgresSession | null = null;

function db(): PostgresSession {
  if (!session) throw new Error("The Pal tool-turn proof cluster did not start.");
  return session;
}

beforeAll(async () => {
  if (skipReason) return;
  session = await startPostgres({ label: "pal-tool-turn-owner" });
  db().sql(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema auth;
    create table auth.users (id uuid primary key);
  `);
  db().applyFile(join(process.cwd(), "supabase/migrations/20260927130000_0160_pub_pal_tool_turns.sql"));
  db().sql(`
    insert into public.pub_pal_tool_turns (conversation_id, payload, expires_at) values
      ('conv_oldvalue', '{}', now() - interval '1 hour'),
      ('invalid', '{}', now() + interval '1 hour'),
      ('conv_existing', '{}', now() + interval '1 hour');
  `);
  db().applyFile(join(process.cwd(), "supabase/migrations/20261002120000_0169_pub_pal_tool_turn_owner.sql"));
}, 180_000);

afterAll(async () => { await session?.stop(); });

describe.skipIf(skipReason !== null)("Pal tool-turn ownership migration", () => {
  it("cleans invalid and expired old rows and denies browser roles", () => {
    expect(db().sql("select conversation_id from public.pub_pal_tool_turns order by conversation_id")).toBe("conv_existing");
    expect(db().expectRefusal("set role anon; select * from public.pub_pal_tool_turns")).toContain("permission denied");
    expect(db().expectRefusal("set role authenticated; select * from public.pub_pal_tool_turns")).toContain("permission denied");
    expect(db().expectRefusal("insert into public.pub_pal_tool_turns (conversation_id, payload, expires_at) values ('bad', '{}', now())")).toContain("check constraint");
  });

  it("deletes an owner's rows when their account is deleted and keeps another owner's row", () => {
    db().sql(`
      insert into auth.users (id) values
        ('11111111-1111-1111-1111-111111111111'),
        ('22222222-2222-2222-2222-222222222222');
      insert into public.pub_pal_tool_turns (conversation_id, payload, expires_at, owner_id) values
        ('conv_ownervalue', '{}', now() + interval '1 hour', '11111111-1111-1111-1111-111111111111'),
        ('conv_othervalue', '{}', now() + interval '1 hour', '22222222-2222-2222-2222-222222222222');
      delete from auth.users where id = '11111111-1111-1111-1111-111111111111';
    `);
    expect(db().sql("select conversation_id from public.pub_pal_tool_turns where owner_id is not null")).toBe("conv_othervalue");
  });
});
