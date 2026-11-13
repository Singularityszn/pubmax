// Migration 0239, proved against a real PostgreSQL replay of every migration:
// a league is made with its owner inside it in one write, a code joins once,
// the two limits hold, the CHECKs hold a name and a code to their shape, no
// browser role reads, writes or calls anything, deleting an account takes its
// memberships and its leagues with it, and the rollback applies cleanly and
// lets the forward file apply again.

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
const FORWARD = join(MIGRATIONS, "20261113090000_0239_leagues.sql");
const ROLLBACK = join(MIGRATIONS, "rollback/20261113090000_0239_leagues_rollback.sql");

/** Person n's auth user id and profile id. Person 1 owns the first league. */
const user = (n: number) => `a0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const profile = (n: number) => `b0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

let session: PostgresSession | null = null;

function db(): PostgresSession {
  if (!session) throw new Error("PostgreSQL leagues session did not start.");
  return session;
}

function lastLine(said: string): string {
  return said.split("\n").pop() ?? "";
}

function create(n: number, name: string, code: string): string {
  return lastLine(
    db().sql(asServiceRole(
      `select public.create_league('${user(n)}', '${profile(n)}', '${name}', '${code}')::text`,
    )),
  );
}

function join_(n: number, code: string): string {
  return lastLine(
    db().sql(asServiceRole(`select public.join_league('${user(n)}', '${profile(n)}', '${code}')::text`)),
  );
}

function members(code: string): string {
  return lastLine(db().sql(
    `select count(*) from public.league_members m join public.leagues l on l.id = m.league_id where l.invite_code = '${code}'`,
  ));
}

beforeAll(async () => {
  if (skipReason) return;
  session = await startMigratedPostgres({ label: "leagues-0239", database: "pubmax_leagues_0239" });
  session.sql(`insert into auth.users (id) select ('a0000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid from generate_series(1, 40) n`);
  session.sql(`insert into public.profiles (id, user_id, handle)
    select ('b0000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
           ('a0000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
           'drinker' || n
    from generate_series(1, 40) n`);
}, 300_000);

afterAll(async () => {
  await session?.stop();
});

describe.skipIf(skipReason !== null)("0239 leagues", () => {
  it("makes a league with its owner already in it", () => {
    expect(create(1, "The Regulars", "ABCDEFGH")).toMatch(/"code": "created"/);
    expect(members("ABCDEFGH")).toBe("1");
    expect(lastLine(db().sql(
      `select owner_user_id from public.leagues where invite_code = 'ABCDEFGH'`,
    ))).toBe(user(1));
  });

  it("joins a code once, and says so the second time", () => {
    expect(join_(2, "ABCDEFGH")).toMatch(/"code": "joined"/);
    expect(join_(2, "ABCDEFGH")).toMatch(/"code": "already"/);
    expect(join_(2, "ZZZZZZZZ")).toMatch(/"code": "not_found"/);
    expect(members("ABCDEFGH")).toBe("2");
  });

  it("refuses a code another league holds", () => {
    expect(create(3, "Copycats", "ABCDEFGH")).toMatch(/"code": "code_taken"/);
    expect(lastLine(db().sql(`select count(*) from public.leagues where owner_user_id = '${user(3)}'`))).toBe("0");
  });

  it("holds a name and a code to their shape", async () => {
    for (const [name, code, check] of [
      ["", "BCDEFGHJ", "leagues_name_check"],
      [" Padded", "BCDEFGHJ", "leagues_name_check"],
      ["x".repeat(41), "BCDEFGHJ", "leagues_name_check"],
      ["Fine", "ABCDEFG0", "leagues_invite_code_check"],
      ["Fine", "abcdefgh", "leagues_invite_code_check"],
      ["Fine", "ABCDEFG", "leagues_invite_code_check"],
    ] as const) {
      const answer = await db().attempt(asServiceRole(
        `insert into public.leagues (name, owner_user_id, invite_code) values ('${name}', '${user(4)}', '${code}')`,
      ));
      expect(answer.ok, `${name} ${code}`).toBe(false);
      expect(answer.said).toMatch(new RegExp(check));
    }
  });

  it("holds a league to 20 members, even when the last two join at once", async () => {
    for (let n = 3; n <= 19; n += 1) expect(join_(n, "ABCDEFGH")).toMatch(/"code": "joined"/);
    expect(members("ABCDEFGH")).toBe("19");
    const answers = await db().concurrentResults([20, 21].map((n) => asServiceRole(
      `select public.join_league('${user(n)}', '${profile(n)}', 'ABCDEFGH')::text`,
    )));
    expect(answers.map((said) => /"code": "(\w+)"/.exec(said)?.[1]).sort()).toEqual(["full", "joined"]);
    expect(members("ABCDEFGH")).toBe("20");
    expect(join_(22, "ABCDEFGH")).toMatch(/"code": "full"/);
  });

  it("holds one person to 10 leagues, made or joined", () => {
    const codes = ["CCCCCCC2", "CCCCCCC3", "CCCCCCC4", "CCCCCCC5", "CCCCCCC6", "CCCCCCC7", "CCCCCCC8", "CCCCCCC9", "CCCCCCCA"];
    for (const code of codes) expect(create(30, "Mine", code)).toMatch(/"code": "created"/);
    expect(join_(30, "ABCDEFGH")).toMatch(/"code": "full"/);
    expect(create(31, "Open", "DDDDDDDD")).toMatch(/"code": "created"/);
    expect(join_(30, "DDDDDDDD")).toMatch(/"code": "joined"/);
    expect(create(30, "One too many", "EEEEEEEE")).toMatch(/"code": "limit"/);
    expect(create(32, "Another", "FFFFFFFF")).toMatch(/"code": "created"/);
    expect(join_(30, "FFFFFFFF")).toMatch(/"code": "limit"/);
    expect(lastLine(db().sql(`select count(*) from public.league_members where user_id = '${user(30)}'`))).toBe("10");
  });

  it("refuses every browser read, write and call, a member's own included", async () => {
    for (const [role, sub] of [["anon", null], ["authenticated", user(1)], ["authenticated", user(39)]] as const) {
      for (const table of ["leagues", "league_members"]) {
        const read = await db().attempt(asBrowserRole(role, sub, `select count(*) from public.${table}`));
        expect(read.ok, `${role} ${sub} read ${table}`).toBe(false);
        expect(read.said).toMatch(/42501|permission denied/);
        const remove = await db().attempt(asBrowserRole(role, sub, `delete from public.${table}`));
        expect(remove.ok, `${role} ${sub} delete ${table}`).toBe(false);
      }
      const write = await db().attempt(asBrowserRole(role, sub,
        `insert into public.league_members (league_id, user_id, profile_id) select id, '${user(39)}', '${profile(39)}' from public.leagues limit 1`,
      ));
      expect(write.ok, `${role} ${sub} insert`).toBe(false);
      const rename = await db().attempt(asBrowserRole(role, sub, "update public.leagues set name = 'tampered'"));
      expect(rename.ok, `${role} ${sub} update`).toBe(false);
      const join = await db().attempt(asBrowserRole(role, sub,
        `select public.join_league('${user(39)}', '${profile(39)}', 'ABCDEFGH')`,
      ));
      expect(join.ok, `${role} ${sub} join`).toBe(false);
      expect(join.said).toMatch(/42501|permission denied/);
      const make = await db().attempt(asBrowserRole(role, sub,
        `select public.create_league('${user(39)}', '${profile(39)}', 'Sneaky', 'GGGGGGGG')`,
      ));
      expect(make.ok, `${role} ${sub} create`).toBe(false);
    }
    expect(db().sql("select count(*) from public.leagues where name = 'tampered' or name = 'Sneaky'")).toBe("0");
    expect(lastLine(db().sql(`select count(*) from public.league_members where user_id = '${user(39)}'`))).toBe("0");
  });

  it("leaves with the account: a member's rows go, and an owner's league goes with its members", async () => {
    expect(join_(33, "DDDDDDDD")).toMatch(/"code": "joined"/);
    const member = await db().attempt(`delete from auth.users where id = '${user(2)}'`);
    expect(member.ok, member.said).toBe(true);
    expect(lastLine(db().sql(`select count(*) from public.league_members where user_id = '${user(2)}'`))).toBe("0");
    expect(members("ABCDEFGH")).toBe("19");

    const owner = await db().attempt(`delete from auth.users where id = '${user(31)}'`);
    expect(owner.ok, owner.said).toBe(true);
    expect(lastLine(db().sql("select count(*) from public.leagues where invite_code = 'DDDDDDDD'"))).toBe("0");
    expect(lastLine(db().sql(`select count(*) from public.league_members where user_id = '${user(33)}'`))).toBe("0");
    expect(members("ABCDEFGH")).toBe("19");
  });

  it("ROLLBACK drops both tables and both functions, and the forward file applies again", () => {
    db().applyFile(ROLLBACK);
    expect(lastLine(db().sql("select to_regclass('public.leagues') is null and to_regclass('public.league_members') is null"))).toBe("t");
    expect(lastLine(db().sql("select count(*) from pg_proc where proname in ('create_league', 'join_league')"))).toBe("0");
    db().applyFile(ROLLBACK);
    db().applyFile(FORWARD);
    expect(lastLine(db().sql("select count(*) from public.leagues"))).toBe("0");
    db().applyFile(FORWARD);
  });
});
