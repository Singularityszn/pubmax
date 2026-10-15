import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { listMigrations } from "../scripts/qa/migration-apply-list.mjs";
import { postgresSkipReason, startPostgres, type PostgresSession } from "./helpers/postgres";

const skip = postgresSkipReason();
const root = process.cwd();
const migration = "20261015120000_0178_story_profile_clear_redaction.sql";
const friend = "11111111-1111-4111-8111-111111111111";
const host = "22222222-2222-4222-8222-222222222222";
const stranger = "33333333-3333-4333-8333-333333333333";
const story = (n: number) => `44444444-4444-4444-8444-${String(n).padStart(12, "0")}`;
let session: PostgresSession;

beforeAll(async () => {
  if (skip) return;
  session = await startPostgres({ label: "story-clear", database: "story_clear" });
  session.applyFile(join(root, "scripts/rls/session-fixture.sql"));
  for (const name of listMigrations()) session.applyFile(join(root, "supabase/migrations", name));
});
afterAll(async () => { await session?.stop(); });
beforeEach(() => {
  if (skip) return;
  session.sql(`
    truncate auth.users cascade;
    insert into auth.users (id) values ('${friend}'), ('${host}'), ('${stranger}');
    insert into public.profiles (handle, user_id, display_name, bio)
      values ('jordanx', '${friend}', 'Jordan', 'A bio'), ('host', '${host}', 'Host', null);
    insert into public.night_memories (id, owner_id, title)
      values ('${story(10)}', '${host}', 'Private night');
    insert into public.night_stories (id, memory_id, host_editor_id, title)
      select id::uuid, '${story(10)}', '${host}', 'With Jordan'
      from unnest(array['${story(1)}', '${story(2)}', '${story(3)}', '${story(4)}']) id;
    insert into public.night_story_contributors (story_id, profile_id, role, status, joined_at)
      values ('${story(1)}', '${friend}', 'contributor', 'accepted', now()),
             ('${story(2)}', '${friend}', 'contributor', 'withdrawn', now()),
             ('${story(4)}', '${stranger}', 'contributor', 'accepted', now());
    insert into public.night_moments (id, memory_id, owner_id, kind, caption)
      values ('${story(11)}', '${story(10)}', '${friend}', 'quote', 'Private source');
    insert into public.night_moment_consents (story_id, moment_id, owner_id, status, decided_at)
      values ('${story(3)}', '${story(11)}', '${friend}', 'withdrawn', now());
  `);
});

function clear(caller = friend) {
  return session.sql(`set role service_role;
    select count(*) from public.clear_profile_for_caller('jordanx', '${caller}');`);
}
function clearAsync(caller = friend) {
  return session.sqlAsync(`set role service_role;
    select count(*) from public.clear_profile_for_caller('jordanx', '${caller}');`);
}
async function waitForAdvisoryLock(key: number): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (session.sql(`select not pg_try_advisory_lock(${key})`) === "t") return;
    await sleep(10);
  }
  throw new Error(`Timed out waiting for advisory lock ${key}.`);
}
function state() {
  return session.sql(`select json_build_object(
    'name', (select display_name from public.profiles where handle = 'jordanx'),
    'bio', (select bio from public.profiles where handle = 'jordanx'),
    'status', (select status from public.night_story_contributors where story_id = '${story(1)}'),
    'names', (select count(*) from public.private_story_redaction_names))::text`);
}

describe.skipIf(skip !== null)("profile-clear privacy transaction (0178)", () => {
  it("captures accepted, withdrawn and consent-only names before clearing, scoped to their Stories", () => {
    session.sql(`update public.profiles set
      avatar_object_key = 'avatars/' || id || '/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/image.jpg',
      avatar_generation = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      avatar_moderation_state = 'approved', avatar_report_count = 1, avatar_report_actors = array['reporter'],
      cover_object_key = 'covers/' || id || '/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/cover.jpg',
      cover_generation = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      cover_moderation_state = 'hidden', cover_report_count = 1, cover_report_actors = array['reporter']
      where handle = 'jordanx'`);
    expect(clear()).toBe("1");
    expect(JSON.parse(state())).toEqual({ name: null, bio: null, status: "withdrawn", names: 3 });
    expect(session.sql(`select string_agg(display_name, ',' order by story_id)
      from public.private_story_redaction_names`)).toBe("Jordan,Jordan,Jordan");
    expect(session.sql(`select count(*) from public.private_story_redaction_names where story_id = '${story(4)}'`)).toBe("0");
    expect(session.sql("select caption from public.night_moments")).toBe("Private source");
    expect(session.sql(`select bool_and(avatar_object_key is null and avatar_generation is null
      and avatar_moderation_state is null and avatar_report_count = 0 and cardinality(avatar_report_actors) = 0
      and cover_object_key is null and cover_generation is null and cover_moderation_state is null
      and cover_report_count = 0 and cardinality(cover_report_actors) = 0) from public.profiles`)).toBe("t");
  });

  it.each([false, true])("withdraws consent-only publication and retains its name, prior withdrawal=%s", (withdrawFirst) => {
    session.sql(`update public.night_moment_consents set status = 'approved'
      where story_id = '${story(3)}';
      insert into public.night_story_moments (story_id, moment_id, position)
        values ('${story(3)}', '${story(11)}', 0);`);
    const withdraw = () => session.sql(`set role service_role;
      select public.set_night_moment_publication_consent_atomic(
        '${friend}', '${story(3)}', '${story(11)}', 'withdrawn', now());`);
    if (withdrawFirst) expect(withdraw()).toBe("t");
    expect(clear()).toBe("1");
    expect(session.sql(`select status from public.night_moment_consents
      where story_id = '${story(3)}'`)).toBe("withdrawn");
    expect(session.sql(`select count(*) from public.night_story_moments
      where story_id = '${story(3)}'`)).toBe("0");
    if (!withdrawFirst) expect(withdraw()).toBe("t");
    expect(session.sql(`select display_name from public.private_story_redaction_names
      where story_id = '${story(3)}' and account_id = '${friend}'`)).toBe("Jordan");
    expect(session.sql("select caption from public.night_moments")).toBe("Private source");
  });

  it("refuses another caller and anonymous callers without changing any state", () => {
    const before = state();
    expect(clear(stranger)).toBe("0");
    expect(session.sql("set role service_role; select count(*) from public.clear_profile_for_caller('jordanx', null)")).toBe("0");
    expect(state()).toBe(before);
    expect(session.sql("set role service_role; select count(*) from public.clear_profile_for_caller('absent', null)")).toBe("0");
  });

  it("captures every withdrawn row when an invitation is accepted during name capture", () => {
    session.sql(`
      insert into public.night_story_contributors (story_id, profile_id, role, status)
        values ('${story(4)}', '${friend}', 'contributor', 'invited');
      create function public.accept_during_name_capture() returns trigger language plpgsql as $$
      begin
        update public.night_story_contributors set status = 'accepted', joined_at = now()
          where story_id = '${story(4)}' and profile_id = '${friend}' and status = 'invited';
        return new;
      end $$;
      create trigger accept_during_capture before insert on public.private_story_redaction_names
        for each row execute function public.accept_during_name_capture();
    `);
    try {
      clear();
      expect(session.sql(`select count(*) from public.night_story_contributors c
        where c.profile_id = '${friend}' and c.status = 'withdrawn'
          and not exists (select 1 from public.private_story_redaction_names n
            where n.story_id = c.story_id and n.account_id = c.profile_id
              and n.display_name = 'Jordan')`)).toBe("0");
    } finally {
      session.sql("drop trigger accept_during_capture on public.private_story_redaction_names; drop function public.accept_during_name_capture()");
    }
  });

  it("keeps retained names after post-clear acceptance and approval", () => {
    clear();
    session.sql(`update public.night_story_contributors
      set status = 'invited', joined_at = null
      where story_id = '${story(1)}' and profile_id = '${friend}'`);
    expect(session.sql(`set role service_role;
      select count(*) from public.accept_night_story_contribution_atomic(
        '${friend}', '${story(1)}', now())`)).toBe("1");
    expect(session.sql(`set role service_role;
      select public.set_night_moment_publication_consent_atomic(
        '${friend}', '${story(3)}', '${story(11)}', 'approved', now())`)).toBe("t");
    expect(session.sql(`select status from public.night_story_contributors
      where story_id = '${story(1)}' and profile_id = '${friend}'`)).toBe("accepted");
    expect(session.sql(`select status from public.night_moment_consents
      where story_id = '${story(3)}' and moment_id = '${story(11)}'`)).toBe("approved");
    expect(session.sql(`select count(*) from public.private_story_redaction_names
      where account_id = '${friend}'`)).toBe("3");
  });

  it("serializes acceptance with profile clearing", async () => {
    session.sql(`
      insert into public.night_story_contributors (story_id, profile_id, role, status)
        values ('${story(4)}', '${friend}', 'contributor', 'invited');
      create function public.pause_story_acceptance() returns trigger language plpgsql as $$
      begin
        perform pg_advisory_xact_lock(178001);
        perform pg_sleep(0.4);
        return new;
      end $$;
      create trigger pause_story_acceptance before update on public.night_story_contributors
        for each row when (old.status = 'invited' and new.status = 'accepted')
        execute function public.pause_story_acceptance();
    `);
    try {
      const accepting = session.sqlAsync(`set role service_role;
        select * from public.accept_night_story_contribution_atomic('${friend}', '${story(4)}', now());`);
      await waitForAdvisoryLock(178001);
      await Promise.all([accepting, clearAsync()]);
      expect(session.sql(`select status from public.night_story_contributors
        where story_id = '${story(4)}' and profile_id = '${friend}'`)).toBe("withdrawn");
      expect(session.sql(`select display_name from public.private_story_redaction_names
        where story_id = '${story(4)}' and account_id = '${friend}'`)).toBe("Jordan");
    } finally {
      session.sql("drop trigger pause_story_acceptance on public.night_story_contributors; drop function public.pause_story_acceptance()");
    }
  });

  it("serializes consent withdrawal with profile clearing", async () => {
    session.sql(`
      insert into public.night_moment_consents (story_id, moment_id, owner_id, status, decided_at)
        values ('${story(4)}', '${story(11)}', '${friend}', 'approved', now());
      insert into public.night_story_moments (story_id, moment_id, position)
        values ('${story(4)}', '${story(11)}', 0);
      create function public.pause_consent_withdrawal() returns trigger language plpgsql as $$
      begin
        perform pg_advisory_xact_lock(178002);
        perform pg_sleep(0.4);
        return new;
      end $$;
      create trigger pause_consent_withdrawal before update on public.night_moment_consents
        for each row when (old.status = 'approved' and new.status = 'withdrawn')
        execute function public.pause_consent_withdrawal();
    `);
    try {
      const withdrawing = session.sqlAsync(`set role service_role;
        select public.set_night_moment_publication_consent_atomic(
          '${friend}', '${story(4)}', '${story(11)}', 'withdrawn', now());`);
      await waitForAdvisoryLock(178002);
      await Promise.all([withdrawing, clearAsync()]);
      expect(session.sql(`select status from public.night_moment_consents
        where story_id = '${story(4)}' and moment_id = '${story(11)}'`)).toBe("withdrawn");
      expect(session.sql(`select display_name from public.private_story_redaction_names
        where story_id = '${story(4)}' and account_id = '${friend}'`)).toBe("Jordan");
    } finally {
      session.sql("drop trigger pause_consent_withdrawal on public.night_moment_consents; drop function public.pause_consent_withdrawal()");
    }
  });

  it("retains names through repeated clears and a second display name", () => {
    clear();
    clear();
    expect(session.sql("select count(*) from public.private_story_redaction_names")).toBe("3");
    session.sql("update public.profiles set display_name = 'Jules' where handle = 'jordanx'");
    clear();
    expect(session.sql("select string_agg(distinct display_name, ',' order by display_name) from public.private_story_redaction_names")).toBe("Jordan,Jules");
    expect(session.sql("select count(*) from public.private_story_redaction_names")).toBe("6");
  });

  it("rolls back clear and withdrawal if the private name write fails", () => {
    session.sql(`create function public.reject_redaction_name() returns trigger language plpgsql as $$
      begin raise exception 'name storage unavailable'; end $$;
      create trigger reject_redaction before insert on public.private_story_redaction_names
      for each row execute function public.reject_redaction_name();`);
    const before = state();
    try {
      expect(session.expectRefusal(`select * from public.clear_profile_for_caller('jordanx', '${friend}')`))
        .toContain("name storage unavailable");
      expect(state()).toBe(before);
    } finally {
      session.sql("drop trigger reject_redaction on public.private_story_redaction_names; drop function public.reject_redaction_name()");
    }
  });

  it.each(["anon", "authenticated"])("keeps retained identities and the clear function unavailable to %s", (role) => {
    clear();
    const before = state();
    for (const statement of [
      "select * from public.private_story_redaction_names",
      "delete from public.private_story_redaction_names",
      `select * from public.clear_profile_for_caller('jordanx', '${friend}')`,
      `select * from public.accept_night_story_contribution_atomic('${friend}', '${story(1)}', now())`,
      `select public.set_night_moment_publication_consent_atomic('${friend}', '${story(3)}', '${story(11)}', 'withdrawn', now())`,
    ]) {
      expect(session.expectRefusal(`set role ${role}; ${statement}`)).toMatch(/permission denied/i);
    }
    expect(state()).toBe(before);
  });

  it("removes retained names when the Story or full auth account is deleted", () => {
    clear();
    session.sql(`delete from public.night_stories where id = '${story(1)}'`);
    expect(session.sql("select count(*) from public.private_story_redaction_names")).toBe("2");
    session.sql(`delete from auth.users where id = '${friend}'`);
    expect(session.sql("select count(*) from public.private_story_redaction_names")).toBe("0");
  });

  it("keeps anonymous clearing of unlinked profiles", () => {
    session.sql("insert into public.profiles(handle, display_name) values ('legacy', 'Legacy')");
    expect(session.sql("set role service_role; select count(*) from public.clear_profile_for_caller('legacy', null)")).toBe("1");
    expect(session.sql("select display_name is null from public.profiles where handle = 'legacy'")).toBe("t");
    expect(session.sql("select count(*) from public.private_story_redaction_names")).toBe("0");
  });

  it("supports re-apply, then rollback removes only the new mechanism", () => {
    session.applyFile(join(root, "supabase/migrations", migration));
    clear();
    session.applyFile(join(root, "supabase/migrations/rollback", migration.replace(".sql", "_rollback.sql")));
    expect(session.expectRefusal("select * from public.private_story_redaction_names")).toMatch(/does not exist/);
    expect(session.expectRefusal(`select * from public.clear_profile_for_caller('jordanx', '${friend}')`)).toMatch(/does not exist/);
    expect(session.expectRefusal(`select * from public.accept_night_story_contribution_atomic('${friend}', '${story(1)}', now())`)).toMatch(/does not exist/);
    expect(session.expectRefusal(`select public.set_night_moment_publication_consent_atomic('${friend}', '${story(3)}', '${story(11)}', 'withdrawn', now())`)).toMatch(/does not exist/);
    expect(session.sql("select count(*) from public.profiles where handle = 'jordanx'")).toBe("1");
  });
});
