// The shared harness for the 0243 crew admission proofs. Each proof file gets its
// own module instance, so its own cluster and its own counters. A person's auth
// user, profile and Social account IDs come from separate ranges.

import { execFile, execFileSync, spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { expect } from "vitest";
import { asServiceRole, startPostgres, type PostgresSession } from "./postgres";

const directory = join(process.cwd(), "supabase/migrations");
const name = "20261117090000_0243_crew_admission_safety_locks.sql";
const rollback = "rollback/20261117090000_0243_crew_admission_safety_locks_rollback.sql";

export const DIGEST = "a".repeat(64);
export const NOT_FOUND = { ok: false, code: "not_found" };
export const NO_CREW = "a2439999-0000-4000-8000-000000000099";
export const STAFF_ROLE = "a2438888-0000-4000-8000-000000000041";

let session: PostgresSession | null = null;
export function db() { if (!session) throw new Error("The test database is not running."); return session; }
export const json = (value: string) => JSON.parse(value) as Record<string, unknown>;

export type Stage = "before" | "after";
let stage: Stage = "before";
/**
 * A synthetic copy of the production permissions that 0243 runs under. On Supabase,
 * supabase_auth_admin owns auth.users. The migration role is not a superuser, owns the
 * application objects and holds only SELECT, UPDATE, TRIGGER and REFERENCES on
 * auth.users, so it cannot drop a trigger there. Only this cluster changes.
 */
function replicateSupabaseOwnership() {
  db().sql(`create role supabase_auth_admin nologin;
    create role ${MIGRATOR} nologin nosuperuser;
    grant usage, create on schema public to ${MIGRATOR};
    grant usage on schema auth, pubmax_private, extensions to ${MIGRATOR};
    alter schema auth owner to supabase_auth_admin;
    alter table auth.users owner to supabase_auth_admin;
    grant select, update, trigger, references on auth.users to ${MIGRATOR};
    do $$
    declare item record;
    begin
      for item in select c.oid::regclass as name, c.relkind from pg_class c join pg_namespace n on n.oid=c.relnamespace
        where n.nspname in ('public','pubmax_private') and c.relkind in ('r','p','v','m') loop
        execute format('alter %s %s owner to ${MIGRATOR}',
          case item.relkind when 'v' then 'view' when 'm' then 'materialized view' else 'table' end, item.name);
      end loop;
      for item in select c.oid::regclass as name from pg_class c join pg_namespace n on n.oid=c.relnamespace
        where n.nspname in ('public','pubmax_private') and c.relkind='S'
          and not exists (select 1 from pg_depend d where d.objid=c.oid and d.deptype in ('a','i')) loop
        execute format('alter sequence %s owner to ${MIGRATOR}', item.name);
      end loop;
      for item in select p.oid::regprocedure as name, p.prokind from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname in ('public','pubmax_private') and p.prokind in ('f','p')
          and not exists (select 1 from pg_depend d where d.objid=p.oid and d.deptype='e') loop
        execute format('alter %s %s owner to ${MIGRATOR}', case item.prokind when 'p' then 'procedure' else 'function' end, item.name);
      end loop;
    end;
    $$;
    alter default privileges for role ${MIGRATOR} in schema public grant execute on functions to anon, authenticated, service_role;`);
}
export const MIGRATOR = "pubmax_migrator";

/** Applies one 0243 file the way production does: as the migration role, not a superuser. */
function applyAsMigrator(file: string) {
  execFileSync(db().psql, [...db().databaseArgs, "-X", "-q", "-c", `set role ${MIGRATOR}`, "-f", join(directory, file)],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

/** Moves the one database to a stage: the forward file applies 0243, the rollback file removes it. */
export function stageTo(next: Stage) {
  if (stage === next) return;
  applyAsMigrator(next === "after" ? name : rollback);
  stage = next;
}

let keys = 0;
export const key = () => `admission-key-0243-${String(++keys).padStart(8, "0")}`;
export const rpc = (call: string) => `select public.${call}::text`;
export const call = (statement: string) => json(db().sql(asServiceRole(rpc(statement))));

export type Person = { user: string; profile: string; account: string; handle: string };
let people = 0;
/** A signed-up person. The three IDs come from different ranges and never coincide. */
export function person({ account = true } = {}): Person {
  const n = String(++people).padStart(12, "0");
  const who = { user: `a2431100-0000-4000-8000-${n}`, profile: `a2432200-0000-4000-8000-${n}`,
    account: `a2433300-0000-4000-8000-${n}`, handle: `p0243_${people}` };
  db().sql(`insert into auth.users(id) values ('${who.user}');
    insert into public.profiles(id,user_id,handle) values ('${who.profile}','${who.user}','${who.handle}');`);
  if (account) {
    db().sql(`insert into public.private_social_accounts(id,clerk_user_id,supabase_user_id,profile_id)
      values ('${who.account}','clerk-${who.handle}','${who.user}','${who.profile}');`);
  }
  return who;
}
/** The account bound to this person's auth user, whatever created it. */
export const accountOf = (who: Person) =>
  db().sql(`select coalesce((select id::text||'|'||ownership_state||'|'||(supabase_user_id is null)
    from public.private_social_accounts where profile_id='${who.profile}'),'none')`);
export const makeCohost = (crew: string, who: Person) =>
  db().sql(`update public.social_crew_members set role='cohost' where crew_id='${crew}' and social_account_id='${who.account}'`);
export const corrections = (crew: string) =>
  db().sql(`select count(*) from public.social_crew_removal_corrections where crew_id='${crew}'`);
/** The forward file as the migration role, answering whether the database took it and what it said. */
export function forwardOutcome() {
  try {
    applyAsMigrator(name);
    stage = "after";
    return { ok: true, said: "" };
  } catch (error) {
    return { ok: false, said: String((error as { stderr?: unknown }).stderr ?? error) };
  }
}
export const revision = (crew: string) => db().sql(`select authority_revision from public.social_crews where id='${crew}'`);
export const mutual = (a: Person, b: Person) => db().sql(`insert into public.follows(follower_id,followee_id)
  values ('${a.profile}','${b.profile}'),('${b.profile}','${a.profile}') on conflict do nothing`);

export const requestCall = (who: Person, crew: string, action = "pending") =>
  `request_social_crew_join_atomic('${who.account}','${crew}','${action}','${key()}','${DIGEST}')`;
export const decideCall = (host: Person, crew: string, request: string, idempotencyKey = key()) =>
  `decide_social_crew_join_request_atomic('${host.account}','${crew}','${request}','accepted','${idempotencyKey}','${DIGEST}')`;
export const blockCall = (blocker: Person, blocked: Person) => `set_social_block('${blocker.profile}','${blocked.profile}',true)`;
export const suspendCall = (who: Person) =>
  `set_social_account_suspension_admin('${STAFF_ROLE}','${who.profile}','suspend','Safety review',null)`;
export const inviteCall = (host: Person, crew: string, who: Person) =>
  `invite_social_crew_member_atomic('${host.account}','${crew}','${who.profile}','${key()}','${DIGEST}')`;
export const queueCall = (host: Person, crew: string) =>
  `read_social_crew_join_requests('${host.account}','${host.profile}','${crew}')`;
export const deleteAccount = (who: Person) => `delete from auth.users where id='${who.user}'`;

export const request = (who: Person, crew: string) => call(requestCall(who, crew));
export const cancel = (who: Person, crew: string) => call(requestCall(who, crew, "cancelled"));
export const decide = (host: Person, crew: string, request: string, idempotencyKey?: string) =>
  call(decideCall(host, crew, request, idempotencyKey));
export const block = (blocker: Person, blocked: Person) => call(blockCall(blocker, blocked));
export const invite = (host: Person, crew: string, who: Person) => call(inviteCall(host, crew, who));
export const answerInvitation = (who: Person, crew: string, invitation: string, action: "accepted" | "declined") =>
  call(`accept_social_crew_invitation_atomic('${who.account}','${crew}','${invitation}','${action}','${key()}','${DIGEST}')`);
export const memberId = (crew: string, who: Person) =>
  db().sql(`select id from public.social_crew_members where crew_id='${crew}' and social_account_id='${who.account}'`);
export const remove = (host: Person, crew: string, who: Person) =>
  call(`remove_social_crew_member_atomic('${host.account}','${crew}','${memberId(crew, who)}','${key()}','${DIGEST}')`);
export const leave = (crew: string, who: Person) => call(`leave_social_crew_atomic('${who.account}','${crew}','${key()}','${DIGEST}')`);
export const state = (crew: string, who: Person) =>
  db().sql(`select coalesce((select state from public.social_crew_members where crew_id='${crew}' and social_account_id='${who.account}'),'none')`);
export const requestState = (request: string) => db().sql(`select state from public.social_crew_join_requests where id='${request}'`);
export const ownership = (who: Person) => db().sql(`select ownership_state from public.private_social_accounts where id='${who.account}'`);
export const seats = (crew: string, who: Person) => db().sql(`select
  (select count(*) from public.social_crew_members where crew_id='${crew}' and social_account_id='${who.account}')||'|'||
  (select count(*) from public.plan_crew_members seat join public.social_crews crew on crew.plan_id=seat.plan_id
    where crew.id='${crew}' and seat.social_account_id='${who.account}')`);
export const correctCall = (crew: string, member: string, staffRole = STAFF_ROLE, reason = "Removed by mistake") =>
  `correct_social_crew_removal_admin('${staffRole}','${crew}','${member}','${reason}')`;
export const correct = (crew: string, member: string, staffRole?: string, reason?: string) => call(correctCall(crew, member, staffRole, reason));
export const queued = (host: Person, crew: string) =>
  (call(queueCall(host, crew)).items as { requesterHandle: string }[]).map((item) => item.requesterHandle);

export function admit(host: Person, crew: string, who: Person) {
  const asked = request(who, crew);
  expect(asked).toMatchObject({ ok: true, code: "requested" });
  expect(decide(host, crew, asked.request_id as string)).toMatchObject({ ok: true, code: "accepted" });
}

let crews = 0;
/** An open crew hosted by `host` whose accepted guests are `guests`. */
export function crewWith(host: Person, guests: Person[] = []): string {
  const n = ++crews;
  const plan = `a2434400-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const hash = String(n).padStart(64, "c");
  db().sql(`insert into public.plans(id,title,start_time,status,owner_user_id) values ('${plan}','Crew night ${n}',now()+interval '1 day','ready','${host.user}');
    insert into public.plan_stops(plan_id,venue_id,venue_name,position) values ('${plan}','venue-one','Venue One',0);
    insert into public.plan_crew_members(plan_id,name,token_hash,status,joined_at,updated_at,can_collaborate,user_id)
      values ('${plan}','Host','${hash}','in',now()-interval '1 minute',now(),true,'${host.user}');`);
  const created = call(`create_social_crew_atomic('${host.account}','${plan}','${hash}','open','${key()}','${DIGEST}')`);
  const crew = created.crew_id as string;
  if (!crew) throw new Error(`The crew was not created: ${JSON.stringify(created)}`);
  for (const guest of guests) admit(host, crew, guest);
  return crew;
}

export type Held = { said: string; finish(): Promise<void> };
/** One real transaction that has run its statement and stays open until finish(). */
export async function hold(statement: string, role: "service_role" | "postgres" = "service_role"): Promise<Held> {
  const child = spawn(db().psql, [...db().databaseArgs, "-X", "-qAt"], { stdio: ["pipe", "pipe", "pipe"] });
  let output = "";
  let errors = "";
  child.stderr.on("data", (chunk) => { errors += String(chunk); });
  const exited = new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve() : reject(new Error(`The held transaction failed: ${errors}`)));
  });
  void exited.catch(() => {});
  const ready = new Promise<string>((resolve, reject) => {
    child.stdout.on("data", (chunk) => {
      output += String(chunk);
      const lines = output.split(/\r?\n/);
      const marker = lines.indexOf("HELD");
      if (marker >= 0) resolve(lines.slice(0, marker).join("\n").trim());
    });
    child.once("close", () => reject(new Error(`The held transaction ended before its barrier: ${errors}`)));
  });
  const asRole = role === "service_role" ? "set local role service_role; " : "";
  child.stdin.write(`begin; ${asRole}${statement};\n\\echo HELD\n`);
  const said = await ready;
  let finished = false;
  const finish = async () => {
    if (finished) return;
    finished = true;
    child.stdin.end("commit;\n");
    await exited;
  };
  return { said, finish };
}
export const holdRpc = async (statement: string) => {
  const held = await hold(rpc(statement));
  return { ...held, result: json(held.said) };
};

/** A statement on its own connection that answers its output or the database's refusal. */
export function outcome(application: string, statement: string, role: "service_role" | "postgres" = "service_role") {
  const asRole = role === "service_role" ? "set role service_role; " : "";
  return db().sqlAsync(`set application_name='${application}'; ${asRole}${statement}`).then(
    (said) => ({ ok: true, said }),
    (error: unknown) => ({ ok: false, said: String((error as { stderr?: unknown })?.stderr ?? error) }),
  );
}
export const REFUSED_BY_LOCKS = /40P01|deadlock|23503|foreign key/;

/** A statement on its own connection, named so a probe can see what it waits on. */
export function waiting(application: string, statement: string, role: "service_role" | "postgres" = "service_role") {
  const asRole = role === "service_role" ? "set role service_role; " : "";
  const pending = db().attempt(`set application_name='${application}'; ${asRole}${statement}`);
  void pending.catch(() => {});
  return pending;
}
export const waitingRpc = (application: string, statement: string) =>
  waiting(application, rpc(statement)).then((answer) => {
    if (!answer.ok) throw new Error(answer.said);
    return answer;
  });
export function waitingRpcResult(application: string, statement: string) {
  const asRole = "set role service_role; ";
  const pending = db().sqlAsync(`set application_name='${application}'; ${asRole}${rpc(statement)}`).then(json);
  void pending.catch(() => {});
  return pending;
}

/** True only while that connection waits on a participant-account advisory lock. */
export const waitsOnAccountLock = (application: string) => db().sqlAsync(`select exists(select 1 from pg_stat_activity
  where application_name='${application}' and wait_event_type='Lock' and wait_event='advisory'
    and cardinality(pg_blocking_pids(pid)) > 0)`);
/** True while that connection waits on any heavyweight lock held by another session. */
export const waitsOnAnyLock = (application: string) => db().sqlAsync(`select exists(select 1 from pg_stat_activity
  where application_name='${application}' and wait_event_type='Lock'
    and cardinality(pg_blocking_pids(pid)) > 0)`);

/** Boots one cluster with every migration before 0243, the session fixture and one moderator. */
export async function bootCrewAdmissionDatabase(label: string, start: Stage) {
  session = await startPostgres({ label, database: label.replaceAll("-", "_") });
  try {
    db().applyFile(join(process.cwd(), "scripts/rls/session-fixture.sql"));
    for (const file of readdirSync(directory).filter((entry) => entry.endsWith(".sql") && entry < name).sort()) db().applyFile(join(directory, file));
    // Supabase grants EXECUTE on every new public function to these roles. The shared
    // fixture does not, so this cluster does, before 0243 creates its helpers.
    db().sql("alter default privileges in schema public grant execute on functions to anon, authenticated, service_role");
    replicateSupabaseOwnership();
    const staff = person();
    db().sql(`insert into public.private_social_staff_roles(id,profile_id,display_name,role) values ('${STAFF_ROLE}','${staff.profile}','Moderator','moderator');`);
    stage = "before";
    stageTo(start);
    return staff;
  } catch (error) { await session.stop(); session = null; throw error; }
}
export async function stopCrewAdmissionDatabase() { await session?.stop(); session = null; }
export const running = () => session !== null;

/**
 * The rollback file on its own named connection, with the ledger export count set
 * first when one is given. It answers whether the database took it and what it said.
 */
export function rollbackOutcome(application: string, exportedRows?: string) {
  const args = [...db().databaseArgs, "-X", "-q", "-c", `set application_name = '${application}'`, "-c", `set role ${MIGRATOR}`];
  if (exportedRows !== undefined) args.push("-c", `set pubmax.crew_removal_corrections_exported = '${exportedRows}'`);
  args.push("-f", join(directory, rollback));
  return new Promise<{ ok: boolean; said: string }>((resolve) => {
    execFile(db().psql, args, { encoding: "utf8" }, (error, _stdout, stderr) => {
      if (!error) stage = "before";
      resolve({ ok: !error, said: String(stderr ?? "") });
    });
  });
}
