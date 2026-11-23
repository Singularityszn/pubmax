// Migration 0262 on a real PostgreSQL replay: a write by an account that is being
// deleted. Before, a write that passed its app-level check and landed after the
// deletion trigger committed stored its row under the tombstone. After, every guarded
// writer takes the author's auth row first: it waits for a deletion in flight and is
// refused, and a deletion waits for a write in flight, so it sees the new row.

import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asBrowserRole, postgresSkipReason } from "./helpers/postgres";
import {
  MIGRATOR, type Person, bootCrewAdmissionDatabase, db, deleteAccount, hold, outcome, person,
  stopCrewAdmissionDatabase, waitsOnLockHeldBy,
} from "./helpers/crewAdmissionHarness";

const directory = join(process.cwd(), "supabase/migrations");
const forward = "20261122160000_0262_account_deletion_write_race.sql";
const rollback = `rollback/${forward.replace(/\.sql$/, "_rollback.sql")}`;
const skipReason = postgresSkipReason();
const REFUSED = /P0262|author_account_deleted/;

function apply(file: string) {
  execFileSync(db().psql, [...db().databaseArgs, "-X", "-q", "-c", `set role ${MIGRATOR}`, "-f", join(directory, file)],
    { stdio: ["ignore", "pipe", "pipe"] });
}

beforeAll(async () => {
  if (skipReason) return;
  await bootCrewAdmissionDatabase("account-deletion-write-race-0262", "after");
  const after0246 = "20261117140000_0246_crew_departure_release.sql";
  for (const file of readdirSync(directory).filter((entry) => entry.endsWith(".sql") && entry > after0246 && entry < forward).sort()) {
    apply(file);
  }
}, 600_000);
afterAll(async () => { await stopCrewAdmissionDatabase(); });

let serial = 0;
const next = () => ++serial;
const hex = (n: number, salt: string) => `${salt}${n.toString(16)}`.padStart(64, "0");
const requestKey = (n: number) => `race-key-0262-${String(n).padStart(8, "0")}`;
const select = (call: string) => `select (${call})::text`;

function post(who: Person) {
  const n = next();
  const id = db().sql(`select (public.create_social_post_idempotent('${who.profile}','${who.handle}','standard','public','Pint ${n}',
    null,null,'{}','open',null,null,null,null,null,null,null,'{}','${requestKey(n)}','${hex(n, "d")}')).id`);
  db().sql(`update public.social_posts set moderation_state='approved',moderated_at=now() where id='${id}'`);
  return id;
}
function wanted(who: Person, venue: string) {
  return db().sql(`insert into public.wanteds(owner_actor,venue_kind,venue_id,venue_name)
    values ('profile:${who.profile}','curated','${venue}','The Crown') returning id`);
}

/**
 * One guarded writer. `write` prepares anything the write reads, before any deletion,
 * and answers the one statement the app's store sends. `count` answers how many rows
 * that writer has stored for the person. `locks` selects the row the writer locks before
 * it inserts, which a deletion with 0264 also writes.
 */
type Writer = {
  name: string;
  write(who: Person, peer: Person): string;
  count(who: Person, peer: Person): string;
  locks?(who: Person): string;
};
const postArgs = (who: Person, n: number) => `'${who.profile}','${who.handle}','standard','public','Pint ${n}',
  null,null,'{}','open',null,null,null,null,null,null,null,'{}'`;
const WRITERS: Writer[] = [
  { name: "create_social_post",
    write: (who) => select(`(public.create_social_post(${postArgs(who, next())})).id`),
    count: (who) => `select count(*) from public.social_posts where author_profile_id='${who.profile}'` },
  { name: "create_social_post_idempotent",
    write: (who) => { const n = next(); return select(`(public.create_social_post_idempotent(${postArgs(who, n)},'${requestKey(n)}','${hex(n, "d")}')).id`); },
    count: (who) => `select count(*) from public.social_posts where author_profile_id='${who.profile}'` },
  { name: "create_social_post_hidden_name",
    write: (who) => { const n = next(); return select(`(public.create_social_post_hidden_name(${postArgs(who, n)},'${requestKey(n)}','${hex(n, "d")}')).id`); },
    count: (who) => `select count(*) from public.social_posts where author_profile_id='${who.profile}'` },
  { name: "create_social_comment on the author's own post",
    write: (who) => { const id = post(who), n = next(); return select(`(public.create_social_comment('${who.profile}','${id}','${who.handle}','Cheers ${n}','${hex(n, "c")}','${hex(n, "e")}')).id`); },
    count: (who) => `select count(*) from public.social_comments where author_profile_id='${who.profile}'`,
    locks: (who) => `select 1 from public.social_posts where author_profile_id='${who.profile}'` },
  { name: "create_social_quote of the author's own post",
    write: (who) => { const id = post(who), n = next(); return select(`(public.create_social_quote('${who.profile}','${id}','${who.handle}','Seconded ${n}','public','${hex(n, "c")}','${hex(n, "e")}')).id`); },
    count: (who) => `select count(*) from public.social_quotes where author_profile_id='${who.profile}'`,
    locks: (who) => `select 1 from public.social_posts where author_profile_id='${who.profile}'` },
  { name: "create_social_video_upload",
    write: (who) => `select upload_id::text from public.create_social_video_upload('${who.profile}','video/mp4',1000)`,
    count: (who) => `select count(*) from public.social_video_uploads where owner_profile_id='${who.profile}'` },
  { name: "savedPubsStore toggleSaved and ensureSaved (saved_pubs)",
    write: (who) => `insert into public.saved_pubs(profile_id,venue_id,list_type) values ('${who.profile}','venue-${next()}','saved')
      on conflict (profile_id,venue_id,list_type) do update set note=excluded.note returning id`,
    count: (who) => `select count(*) from public.saved_pubs where profile_id='${who.profile}'` },
  { name: "promote_wanted_to_saved_list (saved_pubs)",
    write: (who) => { const venue = `venue-${next()}`; const id = wanted(who, venue);
      return `select outcome from public.promote_wanted_to_saved_list('profile:${who.profile}','${who.profile}','${id}','${venue}','saved')`; },
    count: (who) => `select count(*) from public.saved_pubs where profile_id='${who.profile}'`,
    locks: (who) => `select 1 from public.wanteds where owner_actor='profile:${who.profile}'` },
  { name: "savedPubsStore createList (saved_lists)",
    write: (who) => `insert into public.saved_lists(profile_id,name) values ('${who.profile}','Night ${next()}') returning id`,
    count: (who) => `select count(*) from public.saved_lists where profile_id='${who.profile}'` },
  { name: "savedPubsStore followList by the deleted follower (saved_list_follows)",
    write: (who, peer) => `insert into public.saved_list_follows(follower_profile_id,list_owner_profile_id,list_name)
      values ('${who.profile}','${peer.profile}','List ${next()}') returning id`,
    count: (who) => `select count(*) from public.saved_list_follows where follower_profile_id='${who.profile}'` },
  { name: "savedPubsStore followList of the deleted owner's list (saved_list_follows)",
    write: (who, peer) => `insert into public.saved_list_follows(follower_profile_id,list_owner_profile_id,list_name)
      values ('${peer.profile}','${who.profile}','List ${next()}') returning id`,
    count: (who) => `select count(*) from public.saved_list_follows where list_owner_profile_id='${who.profile}'` },
  { name: "checkInStore create (check_ins)",
    write: (who) => `insert into public.check_ins(author_id,handle,area_slug,note,visibility,expires_at)
      values ('${who.profile}','${who.handle}','soho','Round ${next()}','friends',now()+interval '2 hours') returning id`,
    count: (who) => `select count(*) from public.check_ins where author_id='${who.profile}'` },
  { name: "wantedStore create (wanteds, the Pubs to try list)",
    write: (who) => `insert into public.wanteds(owner_actor,venue_kind,venue_name)
      values ('profile:${who.profile}','pending','The Swan ${next()}') returning id`,
    count: (who) => `select count(*) from public.wanteds where owner_actor='profile:${who.profile}'` },
];

const stored = (writer: Writer, who: Person, peer: Person) => Number(db().sql(writer.count(who, peer)));
const tombstoned = (who: Person) => db().sql(`select tombstoned_at is not null from public.profiles where id='${who.profile}'`);

/** The person and a live peer, with the counts taken before the race. */
function race(writer: Writer) {
  const who = person(), peer = person();
  const write = writer.write(who, peer);
  return { who, peer, write, before: stored(writer, who, peer) };
}

/** The issue's schedule: the write passed its check, the deletion commits, then the write lands. */
async function lateWrite(writer: Writer) {
  const r = race(writer);
  db().sql(deleteAccount(r.who));
  expect(tombstoned(r.who)).toBe("t");
  const landed = await outcome(`late_write_${next()}`, r.write);
  return { ...r, landed, after: stored(writer, r.who, r.peer) };
}

describe.skipIf(skipReason !== null)("before 0262", () => {
  it.each(WRITERS)("$name stores a row after its author's deletion committed", async (writer) => {
    const { landed, before, after } = await lateWrite(writer);
    expect(landed.ok, landed.said).toBe(true);
    expect(after).toBe(before + 1);
  });
});

describe.skipIf(skipReason !== null)("after 0262", () => {
  beforeAll(() => { if (!skipReason) apply(forward); });

  it.each(WRITERS)("$name is refused after its author's deletion committed, and stores nothing", async (writer) => {
    const { landed, before, after } = await lateWrite(writer);
    expect(landed.ok).toBe(false);
    expect(landed.said).toMatch(REFUSED);
    expect(after).toBe(before);
  });

  it.each(WRITERS)("$name waits for a deletion in flight before it locks a row, then is refused", async (writer) => {
    const r = race(writer);
    const deletion = `race_delete_${next()}`, writing = `race_write_${next()}`;
    const deleting = await hold(`set local application_name='${deletion}'; ${deleteAccount(r.who)}`, "postgres");
    let landed: ReturnType<typeof outcome> | null = null;
    try {
      landed = outcome(writing, r.write);
      await expect.poll(() => waitsOnLockHeldBy(writing, deletion)).toBe("t");
      if (writer.locks) {
        const rowFree = await db().attempt(`${writer.locks(r.who)} for update nowait`);
        expect(rowFree.ok, rowFree.said).toBe(true);
      }
    } finally {
      await deleting.finish();
    }
    const answer = await landed;
    expect(answer.ok).toBe(false);
    expect(answer.said).toMatch(REFUSED);
    expect(stored(writer, r.who, r.peer)).toBe(r.before);
    expect(tombstoned(r.who)).toBe("t");
  });

  it.each(WRITERS)("a deletion waits for $name in flight, then completes", async (writer) => {
    const r = race(writer);
    const deletion = `race_delete_${next()}`, writing = `race_write_${next()}`;
    const held = await hold(`set local application_name='${writing}'; ${r.write}`);
    let deleted: ReturnType<typeof outcome> | null = null;
    try {
      deleted = outcome(deletion, deleteAccount(r.who), "postgres");
      await expect.poll(() => waitsOnLockHeldBy(deletion, writing)).toBe("t");
      expect(tombstoned(r.who)).toBe("f");
    } finally {
      await held.finish();
    }
    const answer = await deleted;
    expect(answer.ok, answer.said).toBe(true);
    expect(tombstoned(r.who)).toBe("t");
  });

  it.each(WRITERS)("two of one live author's $name writes run at once without waiting", async (writer) => {
    const who = person(), peer = person();
    const first = writer.write(who, peer), second = writer.write(who, peer);
    const before = stored(writer, who, peer);
    const held = await hold(first);
    try {
      const answer = await outcome(`live_write_${next()}`, second);
      expect(answer.ok, answer.said).toBe(true);
    } finally {
      await held.finish();
    }
    expect(stored(writer, who, peer)).toBe(before + 2);
  });

  it("keeps a live profile with no auth user writing", async () => {
    const n = next();
    const profile = `a2622200-0000-4000-8000-${String(n).padStart(12, "0")}`;
    db().sql(`insert into public.profiles(id,handle) values ('${profile}','unbound_${n}')`);
    const answer = await outcome(`unbound_${n}`, `insert into public.saved_pubs(profile_id,venue_id) values ('${profile}','venue-${n}') returning id`);
    expect(answer.ok, answer.said).toBe(true);
  });

  it("keeps the helpers out of every API role", async () => {
    const who = person();
    for (const role of ["anon", "authenticated"] as const) {
      const attempt = await db().attempt(asBrowserRole(role, who.user, `select public._lock_live_author('${who.profile}')`));
      expect(attempt.ok).toBe(false);
      expect(attempt.said).toContain("permission denied");
    }
    const service = await outcome(`service_${next()}`, `select public._lock_live_author('${who.profile}')`);
    expect(service.ok).toBe(false);
    expect(service.said).toContain("permission denied");
  });

  it("rollback lets a late write land again, and reapplying refuses it again", async () => {
    const writer = WRITERS.find((candidate) => candidate.name.startsWith("create_social_comment"))!;
    apply(rollback);
    try {
      const old = await lateWrite(writer);
      expect(old.landed.ok, old.landed.said).toBe(true);
      expect(old.after).toBe(old.before + 1);
    } finally { apply(forward); }
    const fixed = await lateWrite(writer);
    expect(fixed.landed.said).toMatch(REFUSED);
    expect(fixed.after).toBe(fixed.before);
  });
});
