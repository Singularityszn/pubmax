// Migration 0263 on a real PostgreSQL replay: the writers that 0262 left open. The
// deletion trigger already ends these rows (it deletes venue photos, cover photos and
// poll votes, clears message attachments, ends group seats, and takes the handle off
// Pint Drops, visit reports and weather picks). Before, a write that landed after the
// deletion committed kept its row in the state the deletion had ended. After, each
// writer takes its author's auth row first, through 0262's _lock_live_author.

import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { postgresPoll } from "./helpers/postgresPoll";
import { asBrowserRole, postgresSkipReason } from "./helpers/postgres";
import {
  MIGRATOR, type Person, bootCrewAdmissionDatabase, db, deleteAccount, hold, outcome, person,
  stopCrewAdmissionDatabase, waitsOnLockHeldBy,
} from "./helpers/crewAdmissionHarness";

const directory = join(process.cwd(), "supabase/migrations");
const forward = "20261122170000_0263_account_deletion_late_writers.sql";
const rollback = `rollback/${forward.replace(/\.sql$/, "_rollback.sql")}`;
const skipReason = postgresSkipReason();
const REFUSED = /P0262|author_account_deleted/;

function apply(file: string) {
  execFileSync(db().psql, [...db().databaseArgs, "-X", "-q", "-c", `set role ${MIGRATOR}`, "-f", join(directory, file)],
    { stdio: ["ignore", "pipe", "pipe"] });
}

beforeAll(async () => {
  if (skipReason) return;
  await bootCrewAdmissionDatabase("account-deletion-late-writers-0263", "after");
  const after0246 = "20261117140000_0246_crew_departure_release.sql";
  for (const file of readdirSync(directory).filter((entry) => entry.endsWith(".sql") && entry > after0246 && entry < forward).sort()) {
    apply(file);
  }
}, 600_000);
afterAll(async () => { await stopCrewAdmissionDatabase(); });

let serial = 0;
const next = () => ++serial;
const uuid = (n: number) => `a2633300-0000-4000-8000-${String(n).padStart(12, "0")}`;
const covers = new Map<string, number>();
/** The next free slot in the person's cover rotation, so two writes in flight never share one. */
const coverPosition = (who: Person) => { const position = (covers.get(who.profile) ?? 0) + 1; covers.set(who.profile, position); return position; };

/** A DM between the person and a peer, and a poll the peer posted in it. */
function poll(who: Person, peer: Person) {
  const [a, b] = [who.handle, peer.handle].sort();
  const conversation = db().sql(`insert into public.conversations(handle_a,handle_b) values ('${a}','${b}')
    on conflict (handle_a,handle_b) do update set handle_a=excluded.handle_a returning id`);
  const message = db().sql(`insert into public.messages(conversation_id,sender_handle,body,attachment_kind,attachment_poll_question,attachment_poll_options)
    values ('${conversation}','${peer.handle}','','poll','Which pub?','["The Crown","The Swan"]') returning id`);
  return { conversation, message };
}
function group(peer: Person) {
  return db().sql(`insert into public.conversations(kind,title,created_by_handle) values ('group','Night ${next()}','${peer.handle}') returning id`);
}

/**
 * One writer. `write` prepares what the write reads, before any deletion, and answers
 * the one statement the app's store sends. `count` answers how many rows it holds for
 * the person. `ended` answers 't' when every such row is in the state the deletion
 * leaves it: gone, detached or emptied.
 */
type Writer = {
  name: string;
  write(who: Person, peer: Person): string;
  count(who: Person): string;
  ended(who: Person): string;
};
const WRITERS: Writer[] = [
  { name: "venuePhotoStore (venue_photos)",
    write: (who) => { const id = uuid(next()); return `insert into public.venue_photos(id,author_actor,author_profile_id,venue_id,object_key,width,height)
      values ('${id}','profile:${who.profile}','${who.profile}','venue-1','venue-photos/venue-1/${id}.jpg',800,600) returning id`; },
    count: (who) => `select count(*) from public.venue_photos where author_profile_id='${who.profile}'`,
    ended: (who) => `select count(*)=0 from public.venue_photos where author_profile_id='${who.profile}'` },
  { name: "profileCoverPhotoStore (profile_cover_photos)",
    write: (who) => { const generation = uuid(next()); return `insert into public.profile_cover_photos(id,profile_id,position,generation,object_key)
      values ('${uuid(next())}','${who.profile}',${coverPosition(who)},'${generation}','covers/${who.profile}/${generation}/cover.jpg') returning id`; },
    count: (who) => `select count(*) from public.profile_cover_photos where profile_id='${who.profile}'`,
    ended: (who) => `select count(*)=0 from public.profile_cover_photos where profile_id='${who.profile}'` },
  { name: "pintDropsStore (pint_drops, a Pint Drop)",
    write: (who) => `insert into public.pint_drops(venue_id,handle,drink,measure,price_gbp)
      values ('venue-${next()}','${who.handle}','Lager','pint',5.80) returning id`,
    count: (who) => `select count(*) from public.pint_drops where handle='${who.handle}'`,
    ended: (who) => `select count(*) filter (where author_retired_at is null)=0 from public.pint_drops where handle='${who.handle}'` },
  { name: "visitReportsStore (structured_visit_reports)",
    write: (who) => `insert into public.structured_visit_reports(venue_id,handle,visited_at)
      values ('venue-${next()}','${who.handle}',current_date) returning id`,
    count: (who) => `select count(*) from public.structured_visit_reports where handle='${who.handle}'`,
    ended: (who) => `select count(*) filter (where author_retired_at is null)=0 from public.structured_visit_reports where handle='${who.handle}'` },
  { name: "weatherRecommendationStore (weather_recommendations)",
    write: (who) => `insert into public.weather_recommendations(venue_id,condition,reason,contributor_handle,actor_hash)
      values ('venue-${next()}','warm','A sunny beer garden','${who.handle}','actor-${who.handle}') returning id`,
    count: (who) => `select count(*) from public.weather_recommendations where contributor_handle='${who.handle}'`,
    ended: (who) => `select count(*) filter (where author_retired_at is null)=0 from public.weather_recommendations where contributor_handle='${who.handle}'` },
  { name: "messagesStore votePoll (message_poll_votes)",
    write: (who, peer) => { const { message } = poll(who, peer); return `insert into public.message_poll_votes(message_id,voter_handle,option_index)
      values ('${message}','${who.handle}',1) on conflict (message_id,voter_handle) do update set option_index=excluded.option_index returning message_id`; },
    count: (who) => `select count(*) from public.message_poll_votes where voter_handle='${who.handle}'`,
    ended: (who) => `select count(*)=0 from public.message_poll_votes where voter_handle='${who.handle}'` },
  { name: "messagesStore send with an attachment (messages)",
    write: (who, peer) => `insert into public.messages(conversation_id,sender_handle,body,attachment_kind,attachment_venue_id)
      values ('${group(peer)}','${who.handle}','Here?','venue','venue-${next()}') returning id`,
    count: (who) => `select count(*) from public.messages where sender_handle='${who.handle}'`,
    ended: (who) => `select count(*) filter (where attachment_kind is not null)=0 from public.messages where sender_handle='${who.handle}'` },
  { name: "messagesStore createGroup (conversation_members)",
    write: (who, peer) => `insert into public.conversation_members(conversation_id,handle,role)
      values ('${group(peer)}','${who.handle}','member') returning conversation_id`,
    count: (who) => `select count(*) from public.conversation_members where handle='${who.handle}'`,
    ended: (who) => `select count(*) filter (where left_at is null)=0 from public.conversation_members where handle='${who.handle}'` },
];

const stored = (writer: Writer, who: Person) => Number(db().sql(writer.count(who)));
const ended = (writer: Writer, who: Person) => db().sql(writer.ended(who));
const tombstoned = (who: Person) => db().sql(`select tombstoned_at is not null from public.profiles where id='${who.profile}'`);

/** The person and a live peer, with the count taken before the race. */
function race(writer: Writer) {
  const who = person(), peer = person();
  const write = writer.write(who, peer);
  return { who, peer, write, before: stored(writer, who) };
}

/** The issue's schedule: the write passed its check, the deletion commits, then the write lands. */
async function lateWrite(writer: Writer) {
  const r = race(writer);
  db().sql(deleteAccount(r.who));
  expect(tombstoned(r.who)).toBe("t");
  const landed = await outcome(`late_write_${next()}`, r.write);
  return { ...r, landed, after: stored(writer, r.who) };
}

describe.skipIf(skipReason !== null)("before 0263", () => {
  it.each(WRITERS)("$name keeps a row the deletion had ended when it lands after the deletion", async (writer) => {
    const { who, landed, before, after } = await lateWrite(writer);
    expect(landed.ok, landed.said).toBe(true);
    expect(after).toBe(before + 1);
    expect(ended(writer, who)).toBe("f");
  });
});

describe.skipIf(skipReason !== null)("after 0263", () => {
  beforeAll(() => { if (!skipReason) apply(forward); });

  it.each(WRITERS)("$name is refused after its author's deletion committed, and stores nothing", async (writer) => {
    const { who, landed, before, after } = await lateWrite(writer);
    expect(landed.ok).toBe(false);
    expect(landed.said).toMatch(REFUSED);
    expect(after).toBe(before);
    expect(ended(writer, who)).toBe("t");
  });

  it.each(WRITERS)("$name waits for a deletion in flight, then is refused", async (writer) => {
    const r = race(writer);
    const deletion = `race_delete_${next()}`, writing = `race_write_${next()}`;
    const deleting = await hold(`set local application_name='${deletion}'; ${deleteAccount(r.who)}`, "postgres");
    let landed: ReturnType<typeof outcome> | null = null;
    try {
      landed = outcome(writing, r.write);
      await postgresPoll(() => waitsOnLockHeldBy(writing, deletion)).toBe("t");
    } finally {
      await deleting.finish();
    }
    const answer = await landed;
    expect(answer.ok).toBe(false);
    expect(answer.said).toMatch(REFUSED);
    expect(stored(writer, r.who)).toBe(r.before);
    expect(tombstoned(r.who)).toBe("t");
  });

  it.each(WRITERS)("a deletion waits for $name in flight, then ends its row too", async (writer) => {
    const r = race(writer);
    const deletion = `race_delete_${next()}`, writing = `race_write_${next()}`;
    const held = await hold(`set local application_name='${writing}'; ${r.write}`);
    let deleted: ReturnType<typeof outcome> | null = null;
    try {
      deleted = outcome(deletion, deleteAccount(r.who), "postgres");
      await postgresPoll(() => waitsOnLockHeldBy(deletion, writing)).toBe("t");
      expect(tombstoned(r.who)).toBe("f");
    } finally {
      await held.finish();
    }
    const answer = await deleted;
    expect(answer.ok, answer.said).toBe(true);
    expect(tombstoned(r.who)).toBe("t");
    expect(ended(writer, r.who)).toBe("t");
  });

  it.each(WRITERS)("two of one live author's $name writes run at once without waiting", async (writer) => {
    const who = person(), peer = person();
    const first = writer.write(who, peer), second = writer.write(who, peer);
    const before = stored(writer, who);
    const held = await hold(first);
    try {
      const answer = await outcome(`live_write_${next()}`, second);
      expect(answer.ok, answer.said).toBe(true);
    } finally {
      await held.finish();
    }
    expect(stored(writer, who)).toBe(before + 2);
  });

  it("keeps a Pint Drop logged under a handle that names no profile", async () => {
    const n = next();
    const answer = await outcome(`guest_${n}`, `insert into public.pint_drops(venue_id,handle,drink,measure,price_gbp)
      values ('venue-${n}','guest_${n}','Lager','pint',5.80) returning id`);
    expect(answer.ok, answer.said).toBe(true);
  });

  it("refuses a Pint Drop under a deleted account's earlier handle, and keeps the earlier drop detached", async () => {
    const who = person();
    const old = `${who.handle}_old`;
    db().sql(`insert into public.profile_handle_aliases(profile_id,handle) values ('${who.profile}','${old}');
      insert into public.pint_drops(venue_id,handle,drink,measure,price_gbp) values ('venue-${next()}','${old}','Lager','pint',5.80)`);
    db().sql(deleteAccount(who));
    const answer = await outcome(`alias_${next()}`, `insert into public.pint_drops(venue_id,handle,drink,measure,price_gbp)
      values ('venue-${next()}','${old}','Lager','pint',5.80) returning id`);
    expect(answer.said).toMatch(REFUSED);
    expect(db().sql(`select count(*)||'|'||count(author_retired_at) from public.pint_drops where handle='${old}'`)).toBe("1|1");
  });

  it("keeps the handle guard out of every API role", async () => {
    const who = person();
    for (const role of ["anon", "authenticated"] as const) {
      const attempt = await db().attempt(asBrowserRole(role, who.user, "select public._refuse_deleted_handle_write()"));
      expect(attempt.ok).toBe(false);
      expect(attempt.said).toContain("permission denied");
    }
    const service = await outcome(`service_${next()}`, "select public._refuse_deleted_handle_write()");
    expect(service.ok).toBe(false);
    expect(service.said).toContain("permission denied");
  });

  it("rollback lets a late write land again, and reapplying refuses it again", async () => {
    const writer = WRITERS.find((candidate) => candidate.name.startsWith("pintDropsStore"))!;
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
