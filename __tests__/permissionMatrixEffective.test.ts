// The permission matrix, proved rather than probed.
//
// The live audit (2026-09-05, section 11) and the core-loop battle test (section
// 5) read the authorization surface with read-only probes. This file is the
// EFFECTIVE half: a throwaway PostgreSQL 16 cluster holding every migration in
// production order, PostgREST in front of it with real `anon` and
// `authenticated` roles, and the route handlers imported and called as three
// actors. Nothing here reaches a live Supabase project.
//
// THREE ACTORS AND TWO DOORS. The actors are anonymous, user A (alice, who owns
// everything private here) and user B (bob, an unrelated signed-in account).
// The two doors are the API route, which the app serves through its
// SERVICE-ROLE client and gates in code, and the table, which a browser holding
// a Supabase JWT could read through PostgREST and which RLS gates. A cell is
// asserted at both doors because the design says RLS is the second line and the
// route is the first, and a hole in either is a hole.
//
// WHAT IS DOUBLED, AND WHY. A keyless cluster has no GoTrue, so the bearer
// verification (`lib/authServer.ts`, a JWKS signature check) is the one seam
// replaced: a fixed bearer string names user A or user B and everything else is
// anonymous, which is the shape every route test in this tree uses. The
// moderator credential is NOT doubled: `ADMIN_TOKEN` is set for the process and
// the real `isModerator` gate decides. Account deletion's GoTrue admin call is
// stood in for by the SQL statement GoTrue itself runs (delete the auth.users
// row), so the `0078` trigger and the cascades are the real ones.
//
// The expected/observed table this file encodes is written down once in
// docs/security/PERMISSION_MATRIX.md; the two must move together.

import { readdirSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { billFixtureFile } from "./helpers/billFixture";
import { defined } from "@/__tests__/helpers/defined";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));
vi.mock("@/lib/pintDrops", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pintDrops")>();
  return { ...actual, isLimited: async () => false };
});

// The one doubled seam: who a bearer names. Two fixed strings stand in for the
// two accounts' Supabase access tokens; any other bearer (a Plan member token,
// an invite token, garbage) is anonymous to the identity layer, exactly as an
// unverifiable JWT is. Nothing else about identity is replaced.
const ACTORS = vi.hoisted(() => ({
  ALICE: "a0000000-0000-4000-8000-000000000001",
  BOB: "b0000000-0000-4000-8000-000000000002",
  CAROL: "c5000000-0000-4000-8000-000000000009",
  DAVE: "d5000000-0000-4000-8000-00000000000a",
  BEARER_ALICE: "pm-bearer-alice",
  BEARER_BOB: "pm-bearer-bob",
  BEARER_CAROL: "pm-bearer-carol",
  BEARER_DAVE: "pm-bearer-dave",
}));
vi.mock("@/lib/authServer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authServer")>();
  const identityFor = (request: Request) => {
    const token = actual.bearerToken(request);
    if (token === ACTORS.BEARER_ALICE) return { id: ACTORS.ALICE, email: null, createdAt: null };
    if (token === ACTORS.BEARER_BOB) return { id: ACTORS.BOB, email: null, createdAt: null };
    if (token === ACTORS.BEARER_CAROL) return { id: ACTORS.CAROL, email: null, createdAt: null };
    if (token === ACTORS.BEARER_DAVE) return { id: ACTORS.DAVE, email: null, createdAt: null };
    return null;
  };
  return {
    ...actual,
    callerUserId: async (request: Request) => identityFor(request)?.id ?? null,
    callerAuthIdentity: async (request: Request) => identityFor(request),
    verifyCallerAuth: async (request: Request) => {
      const token = actual.bearerToken(request);
      if (!token) return { status: "absent" as const };
      const identity = identityFor(request);
      return identity
        ? { status: "verified" as const, identity }
        : { status: "invalid" as const };
    },
  };
});

// GoTrue's admin delete is a DELETE of the auth.users row; the cluster has no
// GoTrue, so the store seam runs that statement itself. What the test then
// proves is the real 0078 trigger and the real cascades, and that the route
// hands this seam the CALLER's id and never one from the body.
const deletion = vi.hoisted(() => ({
  run: null as null | ((userId: string) => "deleted" | "unavailable"),
  calls: [] as string[],
}));
vi.mock("@/lib/accountDeletion.server", () => ({
  deleteOwnAccount: async (userId: string) => {
    deletion.calls.push(userId);
    return deletion.run ? deletion.run(userId) : "unavailable";
  },
}));

const ROOT = process.cwd();
const MIGRATIONS = join(ROOT, "supabase/migrations");
const V1_RELEASE_NAME = "20260806035204_0070_v1_release_security.sql";

const { ALICE, BOB, CAROL, DAVE, BEARER_ALICE, BEARER_BOB, BEARER_CAROL, BEARER_DAVE } =
  ACTORS;
const ALICE_PROFILE = "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1";
const BOB_PROFILE = "b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2";
const CAROL_PROFILE = "c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3";
const DAVE_PROFILE = "d4d4d4d4-d4d4-4d4d-8d4d-d4d4d4d4d4d4";
/**
 * Social product accounts. `provision_social_product_account` mints one on
 * demand, but the Crew RPCs take an ACCOUNT id and the block table takes a
 * PROFILE id, so the two are seeded together and named here rather than read
 * back per cell.
 */
const ALICE_ACCOUNT = "a6a6a6a6-a6a6-4a6a-8a6a-a6a6a6a6a6a6";
const BOB_ACCOUNT = "b6b6b6b6-b6b6-4b6b-8b6b-b6b6b6b6b6b6";
const CAROL_ACCOUNT = "c6c6c6c6-c6c6-4c6c-8c6c-c6c6c6c6c6c6";
const DAVE_ACCOUNT = "d6d6d6d6-d6d6-4d6d-8d6d-d6d6d6d6d6d6";
/**
 * The Crew's own Plan, separate from `PLAN_ID` on purpose: creating a Crew
 * CONSUMES a Plan (it stamps `social_owner_account_id`, rotates every seat
 * token and revokes the open invites), so binding the matrix's private Plan to
 * a Crew would rewrite the state the Plan cells above are asserted against.
 */
const CREW_PLAN_ID = "c7000000-0000-4000-8000-00000000000b";
// The Plan's own host capability. It is never an account token: the client
// sends the two in separate headers.
const CREW_HOST_CAPABILITY = "pm-crew-plan-host-capability-alice";
const CREW_HOST_HEADER = "x-plan-host-capability";
const CREW_HOST_MEMBER_ID = "c7100000-0000-4000-8000-00000000000c";
/** A conversation between Alice and Bob; Carol and Dave are outside it. */
const CONVERSATION_ID = "f0000000-0000-4000-8000-00000000000d";
const ALICE_MESSAGE = "f1000000-0000-4000-8000-00000000000e";
const BOB_MESSAGE = "f2000000-0000-4000-8000-00000000000f";
const MESSAGE_PHOTO_OBJECT = `messages/${CONVERSATION_ID}/${ALICE_MESSAGE}.jpg`;
/** An id of the right SHAPE that names nothing: the wrong-resource cell. */
const UNKNOWN_ID = "00000000-0000-4000-8000-0000000000ff";
/**
 * A device RSVP: a Plan seat with a capability token and NO account behind it,
 * which is how somebody joins a night from a phone without signing up.
 */
const GUEST_MEMBER_ID = "c2000000-0000-4000-8000-000000000010";
const GUEST_TOKEN = "pm-guest-device-token";
const PLAN_ID = "c0000000-0000-4000-8000-000000000003";
const HOST_MEMBER_ID = "c1000000-0000-4000-8000-000000000004";
const HOST_TOKEN = "pm-host-member-token";
const ALICE_MEMORY = "d0000000-0000-4000-8000-000000000005";
const ALICE_MOMENT = "d1000000-0000-4000-8000-000000000006";
const ALICE_MOMENT_OBJECT = `night-moments/${ALICE}/${ALICE_MEMORY}/venue.jpg`;
const HIDDEN_DROP = "e0000000-0000-4000-8000-000000000007";
const HIDDEN_PRICE = "e1000000-0000-4000-8000-000000000008";
const ANON_DROP = "e2000000-0000-4000-8000-000000000009";
const VISIBLE_PRICE = "e3000000-0000-4000-8000-00000000000a";
const VISIT_REPORT = "e4000000-0000-4000-8000-00000000000b";
const MODERATOR_TOKEN = "pm-moderator-token-for-this-process-only";
const ROUTE = [
  { venueId: "venue-1f5ygjb" },
  { venueId: "venue-xjf3n0" },
  { venueId: "venue-3h52h" },
];
const REORDERED_ROUTE = [ROUTE[1], ROUTE[0], ROUTE[2]];
/** Pubs the price lanes write against; both are pub kinds in the shipped index. */
const PRICE_VENUE = "venue-xjf3n0";
const SECOND_PRICE_VENUE = "venue-1f5ygjb";
/** A third pub only A reports at, so the drop the moderator cell confirms is unconfirmed by construction. */
const MODERATOR_VENUE = "venue-3h52h";
/** The table-door rows live alone, so no price lane counts the seeded anonymous drop as a second reporter. */
const DOOR_VENUE = "venue-door-0171";

type Session = {
  sqlFile(path: string): void;
  sql(
    statement: string,
    opts?: { asRole?: string | null; sub?: string | null },
  ): { ok: boolean; out: string; err: string };
  rest(
    path: string,
    opts?: { method?: string; sub?: string | null; headers?: Record<string, string> },
  ): Promise<{ status: number; body: unknown; text: string }>;
  reloadPostgrestSchema(): Promise<void>;
  stop(): Promise<void>;
  restBaseUrl: string;
  serviceRoleKey: string;
};
type Handler = (
  request: Request,
  context: { params: Promise<Record<string, string>> },
) => Promise<Response>;

let session: Session | null = null;
let skipReason: string | null = null;
const previousEnv: Record<string, string | undefined> = {};
let handlers: Record<string, Handler> = {};
let hashPlanMemberToken: (token: string) => string = () => "";
const nativeFetch = globalThis.fetch;

const context = (values: Record<string, string>) => ({ params: Promise.resolve(values) });

function request(
  path: string,
  options: {
    bearer?: string;
    key?: string;
    body?: Record<string, unknown>;
    /** A multipart body, for the doors that carry a photo. Sets no content-type:
     *  the runtime writes it with the boundary. */
    form?: FormData;
    method?: string;
    headers?: Record<string, string>;
  } = {},
): Request {
  const headers = new Headers(
    options.form
      ? { ...(options.headers ?? {}) }
      : { "content-type": "application/json", ...(options.headers ?? {}) },
  );
  if (options.bearer) headers.set("authorization", `Bearer ${options.bearer}`);
  if (options.key) headers.set("idempotency-key", options.key);
  return new Request(`http://localhost${path}`, {
    method: options.method ?? (options.body || options.form ? "POST" : "GET"),
    headers,
    ...(options.form ? { body: options.form } : {}),
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });
}

function requireSession(): Session {
  if (!session) throw new Error("permission matrix session not started");
  return session;
}

/** A scalar SQL read as the table owner (bypasses RLS): the ground truth a cell is checked against. */
function truth(statement: string): string {
  const result = requireSession().sql(statement);
  if (!result.ok) throw new Error(`truth read failed: ${result.err}`);
  return result.out;
}

/**
 * A row count read as a browser role through RLS. A role with no SELECT grant
 * at all is refused by Postgres before any policy runs; that is the strongest
 * denial there is, so it reads as zero rows rather than as a harness fault.
 */
function visibleRows(role: "anon" | "authenticated", sub: string | null, statement: string): number {
  const result = requireSession().sql(statement, { asRole: role, sub });
  if (!result.ok) {
    if (/permission denied/i.test(result.err)) return 0;
    throw new Error(`role read failed: ${result.err}`);
  }
  return Number(result.out);
}

/** A write attempted as a browser role: refused outright, or allowed through to zero rows. */
function attemptAsRole(
  role: "anon" | "authenticated",
  sub: string | null,
  statement: string,
): { ok: boolean; err: string } {
  return requireSession().sql(statement, { asRole: role, sub });
}

async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

beforeAll(async () => {
  // @ts-expect-error Session harness is an executable MJS helper without declarations.
  const mod = await import("../scripts/rls/session-harness.mjs") as {
    missingPostgresReason(): string | null;
    startRlsSession(): Promise<Session>;
  };
  const missing = mod.missingPostgresReason();
  if (missing) {
    skipReason = missing;
    console.error(
      [
        "",
        "══════════════════════════════════════════════════════════════",
        "SKIPPING permission matrix (not a pass)",
        `Reason: ${missing}`,
        "npm run test:rls runs this suite where PostgreSQL 16 and PostgREST are installed.",
        "══════════════════════════════════════════════════════════════",
        "",
      ].join("\n"),
    );
    return;
  }
  session = await mod.startRlsSession();
  for (const name of readdirSync(MIGRATIONS)
    .filter((candidate) => candidate.endsWith(".sql") && candidate > V1_RELEASE_NAME)
    .sort()) {
    session.sqlFile(join(MIGRATIONS, name));
  }
  await session.reloadPostgrestSchema();

  for (const name of [
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_STORAGE_BUCKET",
    "PLAN_MEMBER_TOKEN_SALT",
    "PLAN_INVITE_TOKEN_SALT",
    "PLAN_IDEMPOTENCY_SECRET",
    "RATE_LIMIT_SALT",
    "ADMIN_TOKEN",
  ]) previousEnv[name] = process.env[name];
  process.env.SUPABASE_URL = session.restBaseUrl;
  process.env.SUPABASE_SERVICE_ROLE_KEY = session.serviceRoleKey;
  process.env.SUPABASE_STORAGE_BUCKET = "pint-drops";
  process.env.PLAN_MEMBER_TOKEN_SALT = "matrix-proof-plan-member-salt";
  process.env.PLAN_INVITE_TOKEN_SALT = "matrix-proof-plan-invite-salt";
  process.env.PLAN_IDEMPOTENCY_SECRET = "matrix-proof-idempotency-secret-32-bytes";
  process.env.RATE_LIMIT_SALT = "matrix-proof-rate-limit-secret-32-bytes";
  // The REAL moderator gate decides every moderator cell. Left unset, the gate
  // opens for everybody under NODE_ENV=test, which would make those cells
  // meaningless rather than green.
  process.env.ADMIN_TOKEN = MODERATOR_TOKEN;

  globalThis.fetch = (input, init) => {
    const rawUrl = input instanceof Request ? input.url : String(input);
    const rewrittenUrl = rawUrl.replace(`${session!.restBaseUrl}/rest/v1`, session!.restBaseUrl);
    const rewrittenInput = input instanceof Request ? new Request(rewrittenUrl, input) : rewrittenUrl;
    return nativeFetch(rewrittenInput, init);
  };

  const [
    planRoute,
    getinRoute,
    recapRoute,
    inviteRoute,
    joinRoute,
    rotateRoute,
    presenceRoute,
    planCard,
    memoriesRoute,
    momentsRoute,
    altTextRoute,
    pintDropsRoute,
    priceSubmitRoute,
    adminPricesRoute,
    accountRoute,
    accountExportRoute,
    crewsRoute,
    crewRoute,
    crewInvitationsRoute,
    crewInvitationRoute,
    crewMembersRoute,
    messagesRoute,
    messageThreadRoute,
    messagePhotoRoute,
    wantedRoute,
    diaryRoute,
    savedPubsRoute,
    tagsRoute,
    profileRoute,
    planStore,
  ] = await Promise.all([
    import("@/app/api/plans/[id]/route"),
    import("@/app/api/plans/[id]/getin/route"),
    import("@/app/api/plans/[id]/recap/route"),
    import("@/app/api/plans/[id]/invites/route"),
    import("@/app/api/plans/[id]/join/route"),
    import("@/app/api/plans/[id]/invite-rotate/route"),
    import("@/app/api/plans/[id]/presence/route"),
    import("@/app/api/plan-card/route"),
    import("@/app/api/night-memories/route"),
    import("@/app/api/night-memories/[id]/moments/route"),
    import("@/app/api/night-moments/[id]/alt-text/route"),
    import("@/app/api/pint-drops/route"),
    import("@/app/api/price-submit/route"),
    import("@/app/api/admin/community-prices/route"),
    import("@/app/api/account/route"),
    import("@/app/api/account/export/route"),
    import("@/app/api/social/crews/route"),
    import("@/app/api/social/crews/[crewId]/route"),
    import("@/app/api/social/crews/[crewId]/invitations/route"),
    import("@/app/api/social/crews/[crewId]/invitations/[invitationId]/route"),
    import("@/app/api/social/crews/[crewId]/members/[memberId]/route"),
    import("@/app/api/messages/route"),
    import("@/app/api/messages/[id]/route"),
    import("@/app/api/messages/[id]/photo/[messageId]/route"),
    import("@/app/api/wanted/route"),
    import("@/app/api/diary/route"),
    import("@/app/api/saved-pubs/route"),
    import("@/app/api/social/tags/route"),
    import("@/app/api/profiles/[handle]/route"),
    import("@/lib/planStore"),
  ]);
  handlers = {
    readPlan: planRoute.GET as Handler,
    updatePlan: planRoute.PATCH as Handler,
    getin: getinRoute.GET as Handler,
    recap: recapRoute.GET as Handler,
    createInvite: inviteRoute.POST as Handler,
    join: joinRoute.POST as Handler,
    rotateInvite: rotateRoute.POST as Handler,
    presence: presenceRoute.POST as Handler,
    planCard: planCard.GET as unknown as Handler,
    listMemories: memoriesRoute.GET as unknown as Handler,
    createMemory: memoriesRoute.POST as unknown as Handler,
    listMoments: momentsRoute.GET as Handler,
    addMoment: momentsRoute.POST as Handler,
    altText: altTextRoute.PATCH as Handler,
    pintDrops: pintDropsRoute.POST as unknown as Handler,
    pintDropsRead: pintDropsRoute.GET as unknown as Handler,
    priceSubmit: priceSubmitRoute.POST as unknown as Handler,
    adminPrices: adminPricesRoute.POST as unknown as Handler,
    deleteAccount: accountRoute.DELETE as unknown as Handler,
    exportAccount: accountExportRoute.GET as unknown as Handler,
    createCrew: crewsRoute.POST as unknown as Handler,
    listCrews: crewsRoute.GET as unknown as Handler,
    readCrew: crewRoute.GET as Handler,
    updateCrew: crewRoute.PATCH as Handler,
    inviteToCrew: crewInvitationsRoute.POST as Handler,
    decideInvitation: crewInvitationRoute.PATCH as Handler,
    revokeInvitation: crewInvitationRoute.DELETE as Handler,
    removeCrewMember: crewMembersRoute.DELETE as Handler,
    inbox: messagesRoute.GET as unknown as Handler,
    startConversation: messagesRoute.POST as unknown as Handler,
    readThread: messageThreadRoute.GET as Handler,
    writeThread: messageThreadRoute.POST as Handler,
    messagePhoto: messagePhotoRoute.GET as Handler,
    listWanted: wantedRoute.GET as unknown as Handler,
    writeWanted: wantedRoute.POST as unknown as Handler,
    listDiary: diaryRoute.GET as unknown as Handler,
    writeDiary: diaryRoute.POST as unknown as Handler,
    listSavedPubs: savedPubsRoute.GET as unknown as Handler,
    writeSavedPub: savedPubsRoute.POST as unknown as Handler,
    tagInbox: tagsRoute.GET as unknown as Handler,
    readProfile: profileRoute.GET as Handler,
    writeProfile: profileRoute.PATCH as Handler,
  };
  hashPlanMemberToken = planStore.hashPlanMemberToken;

  deletion.run = (userId) => {
    const result = session!.sql(`delete from auth.users where id = '${userId}'`);
    return result.ok ? "deleted" : "unavailable";
  };

  const seeded = session.sql(`
    insert into auth.users (id) values
      ('${ALICE}'), ('${BOB}'), ('${CAROL}'), ('${DAVE}');

    insert into public.profiles (id, user_id, handle) values
      ('${ALICE_PROFILE}', '${ALICE}', 'alicepm'),
      ('${BOB_PROFILE}', '${BOB}', 'bobpm'),
      ('${CAROL_PROFILE}', '${CAROL}', 'carolpm'),
      ('${DAVE_PROFILE}', '${DAVE}', 'davepm');

    -- Every account is an adult on file, so a price lane's onboarding gate and
    -- the Social 18+ gate are never what refuses a cell below.
    insert into public.private_account_identities (user_id, date_of_birth) values
      ('${ALICE}', '1990-01-01'),
      ('${BOB}', '1991-02-02'),
      ('${CAROL}', '1992-03-03'),
      ('${DAVE}', '1993-04-04');

    -- The Social product account each Crew and tag cell acts as.
    insert into public.private_social_accounts (id, clerk_user_id, supabase_user_id, profile_id) values
      ('${ALICE_ACCOUNT}', 'pm-clerk-alice', '${ALICE}', '${ALICE_PROFILE}'),
      ('${BOB_ACCOUNT}', 'pm-clerk-bob', '${BOB}', '${BOB_PROFILE}'),
      ('${CAROL_ACCOUNT}', 'pm-clerk-carol', '${CAROL}', '${CAROL_PROFILE}'),
      ('${DAVE_ACCOUNT}', 'pm-clerk-dave', '${DAVE}', '${DAVE_PROFILE}');

    -- A Crew seat needs a MUTUAL follow with the owner, so Bob and Carol both
    -- have one and Dave has none. Carol's block is then the ONLY thing that
    -- differs between her and Bob, which is what makes the blocked cell a
    -- measurement of the block rather than of a missing follow.
    insert into public.follows (follower_id, followee_id) values
      ('${ALICE_PROFILE}', '${BOB_PROFILE}'), ('${BOB_PROFILE}', '${ALICE_PROFILE}'),
      ('${ALICE_PROFILE}', '${CAROL_PROFILE}'), ('${CAROL_PROFILE}', '${ALICE_PROFILE}');
    insert into public.social_blocks (blocker_profile_id, blocked_profile_id) values
      ('${ALICE_PROFILE}', '${CAROL_PROFILE}');

    -- Alice's private Plan: she owns the row AND holds the host seat.
    insert into public.plans (id, title, start_time, status, route_revision, owner_user_id)
      values ('${PLAN_ID}', 'Alice private night', now() + interval '4 hours', 'ready', 1, '${ALICE}');
    insert into public.plan_stops (plan_id, venue_id, venue_name, position) values
      ('${PLAN_ID}', 'venue-1f5ygjb', 'Venue One', 0),
      ('${PLAN_ID}', 'venue-xjf3n0', 'Venue Two', 1),
      ('${PLAN_ID}', 'venue-3h52h', 'Venue Three', 2);
    insert into public.plan_crew_members (
      id, plan_id, name, token_hash, user_id, status, joined_at, updated_at, can_collaborate
    ) values (
      '${HOST_MEMBER_ID}', '${PLAN_ID}', 'Alice', '${hashPlanMemberToken(HOST_TOKEN)}',
      '${ALICE}', 'in', now(), now(), true
    );

    -- Alice's private Night Memory, one photo Moment, and the object it points at.
    insert into public.night_memories (id, owner_id, title)
      values ('${ALICE_MEMORY}', '${ALICE}', 'Alice night');
    insert into public.night_moments (id, memory_id, owner_id, kind, caption, media_object_key)
      values ('${ALICE_MOMENT}', '${ALICE_MEMORY}', '${ALICE}', 'photo', 'private photo', '${ALICE_MOMENT_OBJECT}');
    insert into storage.objects (bucket_id, name, owner_id, metadata)
      values ('pint-drops', '${ALICE_MOMENT_OBJECT}', '${ALICE}', '{"mimetype":"image/jpeg"}');

    -- A device RSVP on the matrix Plan: a seat, a token, and no account.
    insert into public.plan_crew_members (
      id, plan_id, name, token_hash, user_id, status, joined_at, updated_at, can_collaborate
    ) values (
      '${GUEST_MEMBER_ID}', '${PLAN_ID}', 'Guest phone', '${hashPlanMemberToken(GUEST_TOKEN)}',
      null, 'in', now(), now(), false
    );

    -- The Crew's own Plan. Its host seat token IS Alice's bearer, because the
    -- Crew create route reads ONE Authorization header for both the identity
    -- and the host capability; a browser sends the seat token there and names
    -- itself through the resume cookie.
    insert into public.plans (id, title, start_time, status, route_revision, owner_user_id)
      values ('${CREW_PLAN_ID}', 'Alice crew night', now() + interval '4 hours', 'ready', 1, '${ALICE}');
    insert into public.plan_stops (plan_id, venue_id, venue_name, position) values
      ('${CREW_PLAN_ID}', 'venue-1f5ygjb', 'Venue One', 0);
    insert into public.plan_crew_members (
      id, plan_id, name, token_hash, user_id, status, joined_at, updated_at, can_collaborate
    ) values (
      '${CREW_HOST_MEMBER_ID}', '${CREW_PLAN_ID}', 'Alice', '${hashPlanMemberToken(CREW_HOST_CAPABILITY)}',
      '${ALICE}', 'in', now(), now(), true
    );

    -- A private conversation between Alice and Bob, one message each way, and
    -- the object one of them points at. The conversations and messages tables
    -- are the RLS-enabled-no-policy pair: the route is the whole gate, so the
    -- route is where every cell below is asserted.
    insert into public.conversations (id, handle_a, handle_b, user_id_a, user_id_b)
      values ('${CONVERSATION_ID}', 'alicepm', 'bobpm', '${ALICE}', '${BOB}');
    insert into public.messages (
      id, conversation_id, sender_handle, sender_user_id, body, created_at,
      attachment_kind, attachment_object_key, attachment_width, attachment_height
    ) values
        ('${ALICE_MESSAGE}', '${CONVERSATION_ID}', 'alicepm', '${ALICE}', 'Alice private line',
          now() - interval '2 minutes', 'photo', '${MESSAGE_PHOTO_OBJECT}', 800, 1000),
        ('${BOB_MESSAGE}', '${CONVERSATION_ID}', 'bobpm', '${BOB}', 'Bob private line',
          now() - interval '1 minute', null, null, null, null);
    insert into storage.objects (bucket_id, name, owner_id, metadata)
      values ('pint-drops', '${MESSAGE_PHOTO_OBJECT}', '${ALICE}', '{"mimetype":"image/jpeg"}');

    -- A hidden Pint Drop and a hidden community price: moderation state a
    -- browser role may never read back.
    insert into public.pint_drops (id, venue_id, handle, price_gbp, status, visibility)
      values ('${HIDDEN_DROP}', '${PRICE_VENUE}', 'alicepm', 3.10, 'hidden', 'public');
    insert into public.community_prices (id, venue_id, drink_category, price_pennies, actor, contributor_handle, hidden_at)
      values ('${HIDDEN_PRICE}', '${PRICE_VENUE}', 'beer', 310, 'profile:${ALICE_PROFILE}', 'alicepm', now());
    insert into public.pint_drops (
      id, venue_id, handle, price_gbp, status, visibility, moderator_note, report_reason, receipt_photo_key
    ) values (
      '${ANON_DROP}', '${DOOR_VENUE}', 'secret_author', 4.20, 'visible', 'anonymous',
      'staff-only-note', 'reported-in-private', 'receipts/secret_author/bill.jpg'
    );
    insert into public.community_prices (
      id, venue_id, drink_category, price_pennies, actor, contributor_handle
    ) values (
      '${VISIBLE_PRICE}', '${DOOR_VENUE}', 'wine', 450, 'profile:${BOB_PROFILE}', 'secret_author'
    );
    insert into public.structured_visit_reports (
      id, venue_id, handle, visited_at, note, status, moderator_note
    ) values (
      '${VISIT_REPORT}', '${DOOR_VENUE}', 'secret_author', '2026-09-01', 'how the night felt', 'visible', 'staff-only-note'
    );
  `);
  if (!seeded.ok) throw new Error(`Could not seed the permission matrix: ${seeded.err}`);
}, 180_000);

afterAll(async () => {
  globalThis.fetch = nativeFetch;
  for (const [name, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  await session?.stop();
}, 30_000);

beforeEach((ctx) => {
  if (skipReason) ctx.skip(true, skipReason);
});

type PreviewBody = {
  visibility?: string;
  stops?: unknown;
  crew?: unknown;
  plan?: { title?: string };
  stopCount?: number;
  hostDisplayName?: string;
};

function expectPreview(body: PreviewBody): void {
  expect(body.visibility).toBe("preview");
  expect(body.stops).toBeUndefined();
  expect(body.crew).toBeUndefined();
  expect(body.plan).toBeUndefined();
  expect(JSON.stringify(body)).not.toContain("Alice private night");
  expect(JSON.stringify(body)).not.toContain("Venue One");
}

function planRevision(): number {
  return Number(truth(`select route_revision from public.plans where id = '${PLAN_ID}'`));
}

function planStopOrder(): string {
  return truth(
    `select string_agg(venue_id, ',' order by position) from public.plan_stops where plan_id = '${PLAN_ID}'`,
  );
}

describe("private Plan: read", () => {
  it("anonymous, user B, and a bare Supabase bearer all get the preview and never the route", async () => {
    for (const bearer of [undefined, BEARER_BOB, BEARER_ALICE]) {
      const response = await defined(handlers.readPlan)(
        request(`/api/plans/${PLAN_ID}`, { bearer }),
        context({ id: PLAN_ID }),
      );
      expect(response.status).toBe(200);
      const body = await readJson<PreviewBody>(response);
      expectPreview(body);
      expect(body.stopCount).toBe(3);
    }
  });

  it("the host's member capability is what opens the member state", async () => {
    const response = await defined(handlers.readPlan)(
      request(`/api/plans/${PLAN_ID}`, { bearer: HOST_TOKEN }),
      context({ id: PLAN_ID }),
    );
    expect(response.status).toBe(200);
    const body = await readJson<{ plan: { title: string }; stops: unknown[]; crew: unknown[] }>(response);
    expect(body.plan.title).toBe("Alice private night");
    expect(body.stops).toHaveLength(3);
    // Alice's own seat plus the device RSVP the guest cells act as.
    expect(body.crew).toHaveLength(2);
  });

  it("the get-in and recap views answer the preview to a stranger", async () => {
    for (const handler of [handlers.getin, handlers.recap]) {
      for (const bearer of [undefined, BEARER_BOB]) {
        const response = await defined(handler)(
          request(`/api/plans/${PLAN_ID}/x`, { bearer }),
          context({ id: PLAN_ID }),
        );
        expect(response.status).toBe(200);
        const body = await readJson<PreviewBody>(response);
        expect(body.visibility).toBe("preview");
        expect(JSON.stringify(body)).not.toContain("Venue One");
      }
    }
  });

  it("the unfurler card renders for anyone and reads only the preview", async () => {
    const response = await defined(handlers.planCard)(
      request(`/api/plan-card?id=${PLAN_ID}`),
      context({}),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("image/png");
    // The card is built from buildPlanPrivacyPreview alone (see its source);
    // the preview DTO carries no stop name and no title, asserted above.
  });

  it("at the table: the owner reads her Plan, a stranger and anonymous read nothing, and the seat token is not a column anyone may select", async () => {
    const owner = await requireSession().rest(`/plans?select=id&id=eq.${PLAN_ID}`, { sub: ALICE });
    expect(owner.status).toBe(200);
    expect(owner.body).toEqual([{ id: PLAN_ID }]);

    const stranger = await requireSession().rest(`/plans?select=id&id=eq.${PLAN_ID}`, { sub: BOB });
    expect(stranger.status).toBe(200);
    expect(stranger.body).toEqual([]);

    const anonymous = await requireSession().rest(`/plans?select=id&id=eq.${PLAN_ID}`);
    expect(anonymous.status === 200 ? anonymous.body : []).toEqual([]);

    for (const table of ["plan_stops", "plan_crew_members"]) {
      const strangerRows = await requireSession().rest(`/${table}?select=plan_id&plan_id=eq.${PLAN_ID}`, { sub: BOB });
      expect(strangerRows.status).toBe(200);
      expect(strangerRows.body).toEqual([]);
    }

    const tokenColumn = await requireSession().rest(
      `/plan_crew_members?select=token_hash&plan_id=eq.${PLAN_ID}`,
      { sub: ALICE },
    );
    expect(tokenColumn.status).toBeGreaterThanOrEqual(400);
  });
});

describe("private Plan: write", () => {
  it("anonymous and user B cannot replace the route, rotate the invite, or set presence, and nothing moves", async () => {
    const revisionBefore = planRevision();
    const orderBefore = planStopOrder();
    for (const bearer of [undefined, BEARER_BOB]) {
      const replaced = await defined(handlers.updatePlan)(
        request(`/api/plans/${PLAN_ID}`, {
          method: "PATCH",
          bearer,
          body: { stops: REORDERED_ROUTE, expectedRouteRevision: revisionBefore },
        }),
        context({ id: PLAN_ID }),
      );
      expect([400, 403]).toContain(replaced.status);

      const rotated = await defined(handlers.rotateInvite)(
        request(`/api/plans/${PLAN_ID}/invite-rotate`, { bearer, body: {} }),
        context({ id: PLAN_ID }),
      );
      expect(rotated.status).toBe(403);

      const presence = await defined(handlers.presence)(
        request(`/api/plans/${PLAN_ID}/presence`, { bearer, body: { status: "here" } }),
        context({ id: PLAN_ID }),
      );
      expect([400, 403]).toContain(presence.status);
    }
    expect(planRevision()).toBe(revisionBefore);
    expect(planStopOrder()).toBe(orderBefore);
    expect(truth(`select status from public.plan_crew_members where id = '${HOST_MEMBER_ID}'`)).toBe("in");
  });

  it("the host's capability replaces the route (the control cell)", async () => {
    const revisionBefore = planRevision();
    const replaced = await defined(handlers.updatePlan)(
      request(`/api/plans/${PLAN_ID}`, {
        method: "PATCH",
        bearer: HOST_TOKEN,
        body: { stops: REORDERED_ROUTE, expectedRouteRevision: revisionBefore },
      }),
      context({ id: PLAN_ID }),
    );
    expect(replaced.status, await replaced.text()).toBe(200);
    expect(planRevision()).toBe(revisionBefore + 1);
    expect(planStopOrder()).toBe(REORDERED_ROUTE.map((stop) => defined(stop).venueId).join(","));
  });

  it("at the table: no browser role may write a Plan row, its stops, or its crew", async () => {
    for (const [role, sub] of [["anon", null], ["authenticated", ALICE], ["authenticated", BOB]] as const) {
      const renamed = attemptAsRole(role, sub, `update public.plans set title = 'stolen' where id = '${PLAN_ID}'`);
      expect(renamed.ok ? truth(`select title from public.plans where id = '${PLAN_ID}'`) : "refused")
        .not.toBe("stolen");
      const stopped = attemptAsRole(
        role,
        sub,
        `insert into public.plan_stops (plan_id, venue_id, venue_name, position) values ('${PLAN_ID}', 'venue-x', 'X', 9)`,
      );
      expect(stopped.ok).toBe(false);
      const seated = attemptAsRole(
        role,
        sub,
        `insert into public.plan_crew_members (plan_id, name, token_hash, user_id) values ('${PLAN_ID}', 'Intruder', repeat('f', 64), '${BOB}')`,
      );
      expect(seated.ok).toBe(false);
    }
    // Alice's seat and the device RSVP, and nothing a browser role added.
    expect(truth(`select count(*) from public.plan_crew_members where plan_id = '${PLAN_ID}'`)).toBe("2");
    expect(
      truth(`select count(*) from public.plan_crew_members where plan_id = '${PLAN_ID}' and name = 'Intruder'`),
    ).toBe("0");
  });
});

describe("invite capability", () => {
  let inviteToken = "";
  let guestToken = "";

  it("an invite token is not a member token: as a bearer it reads the preview and edits nothing", async () => {
    const created = await defined(handlers.createInvite)(
      request(`/api/plans/${PLAN_ID}/invites`, {
        bearer: HOST_TOKEN,
        key: "matrix-invite-1",
        body: { expiresInMinutes: 30 },
      }),
      context({ id: PLAN_ID }),
    );
    console.error("CREATE CREW:", created.status, await created.clone().text());
    expect(created.status, await created.clone().text()).toBe(201);
    inviteToken = (await readJson<{ token: string }>(created)).token;
    expect(inviteToken).toBeTruthy();

    const read = await defined(handlers.readPlan)(
      request(`/api/plans/${PLAN_ID}`, { bearer: inviteToken }),
      context({ id: PLAN_ID }),
    );
    expect(read.status).toBe(200);
    expectPreview(await readJson<PreviewBody>(read));

    const revision = planRevision();
    const edited = await defined(handlers.updatePlan)(
      request(`/api/plans/${PLAN_ID}`, {
        method: "PATCH",
        bearer: inviteToken,
        body: { stops: ROUTE, expectedRouteRevision: revision },
      }),
      context({ id: PLAN_ID }),
    );
    expect([400, 403]).toContain(edited.status);
    expect(planRevision()).toBe(revision);
  });

  it("user B redeems the invite into one seat bound to her account, and the seat is what opens the member view", async () => {
    const joined = await defined(handlers.join)(
      request(`/api/plans/${PLAN_ID}/join`, {
        bearer: BEARER_BOB,
        key: "matrix-join-bob",
        body: { name: "Bob", inviteToken },
      }),
      context({ id: PLAN_ID }),
    );
    expect(joined.status, await joined.clone().text()).toBe(200);
    guestToken = (await readJson<{ memberToken: string }>(joined)).memberToken;
    expect(guestToken).toBeTruthy();
    expect(truth(
      `select count(*) from public.plan_crew_members where plan_id = '${PLAN_ID}' and user_id = '${BOB}' and membership_revoked_at is null`,
    )).toBe("1");

    const member = await defined(handlers.readPlan)(
      request(`/api/plans/${PLAN_ID}`, { bearer: guestToken }),
      context({ id: PLAN_ID }),
    );
    expect(member.status).toBe(200);
    expect((await readJson<{ stops: unknown[] }>(member)).stops).toHaveLength(3);

    // The account bearer alone is still the preview: capability, not identity,
    // is the Plan's read key (audit section 5 observed the same).
    const bare = await defined(handlers.readPlan)(
      request(`/api/plans/${PLAN_ID}`, { bearer: BEARER_BOB }),
      context({ id: PLAN_ID }),
    );
    expectPreview(await readJson<PreviewBody>(bare));

    // At the table, the seat makes B a participant: RLS now answers her JWT.
    const rows = await requireSession().rest(`/plans?select=id&id=eq.${PLAN_ID}`, { sub: BOB });
    expect(rows.body).toEqual([{ id: PLAN_ID }]);
  });

  it("the invite is spent: a second redemption is refused, and one account holds one seat", async () => {
    const replay = await defined(handlers.join)(
      request(`/api/plans/${PLAN_ID}/join`, {
        key: "matrix-join-replay",
        body: { name: "Again", inviteToken },
      }),
      context({ id: PLAN_ID }),
    );
    expect(replay.status).toBeGreaterThanOrEqual(400);

    const fresh = await defined(handlers.createInvite)(
      request(`/api/plans/${PLAN_ID}/invites`, {
        bearer: HOST_TOKEN,
        key: "matrix-invite-2",
        body: { expiresInMinutes: 30 },
      }),
      context({ id: PLAN_ID }),
    );
    const second = (await readJson<{ token: string }>(fresh)).token;
    const secondSeat = await defined(handlers.join)(
      request(`/api/plans/${PLAN_ID}/join`, {
        bearer: BEARER_BOB,
        key: "matrix-join-bob-second-seat",
        body: { name: "Bob again", inviteToken: second },
      }),
      context({ id: PLAN_ID }),
    );
    expect(secondSeat.status).toBe(409);
    expect(truth(
      `select count(*) from public.plan_crew_members where plan_id = '${PLAN_ID}' and user_id = '${BOB}'`,
    )).toBe("1");
  });

  it("a guest capability may not rotate the invite link", async () => {
    const rotated = await defined(handlers.rotateInvite)(
      request(`/api/plans/${PLAN_ID}/invite-rotate`, { bearer: guestToken, body: {} }),
      context({ id: PLAN_ID }),
    );
    expect(rotated.status).toBe(403);
  });

  it("a removed member loses both doors at once", async () => {
    // The statement remove_plan_invite_rsvp_membership_atomic (0124) runs when
    // the host removes a seat: the membership is revoked and the seat's token
    // hash rotated, in one write.
    const revoked = requireSession().sql(`
      update public.plan_crew_members
         set membership_revoked_at = now(),
             token_hash = encode(extensions.gen_random_bytes(32), 'hex'),
             updated_at = now()
       where plan_id = '${PLAN_ID}' and user_id = '${BOB}' and membership_revoked_at is null
    `);
    expect(revoked.ok, revoked.err).toBe(true);

    const read = await defined(handlers.readPlan)(
      request(`/api/plans/${PLAN_ID}`, { bearer: guestToken }),
      context({ id: PLAN_ID }),
    );
    expectPreview(await readJson<PreviewBody>(read));

    const presence = await defined(handlers.presence)(
      request(`/api/plans/${PLAN_ID}/presence`, { bearer: guestToken, body: { status: "here" } }),
      context({ id: PLAN_ID }),
    );
    expect([400, 403]).toContain(presence.status);

    // The table door (0144): before it, every Plan policy read a helper that
    // never learned about revocation, and a removed account kept SELECT on the
    // Plan, its stops and its crew through PostgREST.
    const rows = await requireSession().rest(`/plans?select=id&id=eq.${PLAN_ID}`, { sub: BOB });
    expect(rows.body).toEqual([]);
    for (const table of ["plan_stops", "plan_crew_members"]) {
      const strangerRows = await requireSession().rest(`/${table}?select=plan_id&plan_id=eq.${PLAN_ID}`, { sub: BOB });
      expect(strangerRows.body).toEqual([]);
    }
  });

  it("the participant helper the policies read is the one that knows about revocation, and it is not an exposed RPC", async () => {
    expect(truth(`
      select string_agg(n.nspname, ',' order by n.nspname)
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where p.proname = 'rls_is_plan_participant'
    `)).toBe("pubmax_private");
    expect(truth(`
      select position('membership_revoked_at' in pg_get_functiondef('pubmax_private.rls_is_plan_participant(uuid)'::regprocedure)) > 0
    `)).toBe("true");
    expect(truth(`
      select string_agg(distinct qual, ',')
        from pg_policies
       where tablename in ('plans', 'plan_stops', 'plan_crew_members') and cmd = 'SELECT'
    `)).not.toContain("public.rls_is_plan_participant");
    const rpc = await requireSession().rest(`/rpc/rls_is_plan_participant?p_plan_id=${PLAN_ID}`, { sub: BOB });
    expect(rpc.status).toBeGreaterThanOrEqual(400);
  });
});

describe("private Night Memory, Moment and its object", () => {
  let bobMemory = "";

  it("the memory list is the caller's own: anonymous is refused, B sees none of A's, A sees hers", async () => {
    const anonymous = await defined(handlers.listMemories)(request("/api/night-memories"), context({}));
    expect(anonymous.status).toBe(401);

    const bob = await defined(handlers.listMemories)(request("/api/night-memories", { bearer: BEARER_BOB }), context({}));
    expect(bob.status).toBe(200);
    expect((await readJson<{ memories: Array<{ id: string }> }>(bob)).memories.map((row) => row.id))
      .not.toContain(ALICE_MEMORY);

    const alice = await defined(handlers.listMemories)(request("/api/night-memories", { bearer: BEARER_ALICE }), context({}));
    expect(alice.status).toBe(200);
    expect((await readJson<{ memories: Array<{ id: string }> }>(alice)).memories.map((row) => row.id))
      .toContain(ALICE_MEMORY);
  });

  it("A's Moments answer only to A, and B can neither read nor add to that Memory", async () => {
    const anonymous = await defined(handlers.listMoments)(
      request(`/api/night-memories/${ALICE_MEMORY}/moments`),
      context({ id: ALICE_MEMORY }),
    );
    expect(anonymous.status).toBe(401);

    const bob = await defined(handlers.listMoments)(
      request(`/api/night-memories/${ALICE_MEMORY}/moments`, { bearer: BEARER_BOB }),
      context({ id: ALICE_MEMORY }),
    );
    expect(bob.status).toBe(200);
    expect((await readJson<{ moments: unknown[] }>(bob)).moments).toEqual([]);

    const alice = await defined(handlers.listMoments)(
      request(`/api/night-memories/${ALICE_MEMORY}/moments`, { bearer: BEARER_ALICE }),
      context({ id: ALICE_MEMORY }),
    );
    expect(alice.status).toBe(200);
    const mine = await readJson<{ moments: Array<{ id: string; mediaObjectKey?: string }> }>(alice);
    expect(mine.moments.map((row) => row.id)).toEqual([ALICE_MOMENT]);

    const intruded = await defined(handlers.addMoment)(
      request(`/api/night-memories/${ALICE_MEMORY}/moments`, {
        bearer: BEARER_BOB,
        body: { kind: "event", caption: "not mine" },
      }),
      context({ id: ALICE_MEMORY }),
    );
    expect(intruded.status).toBe(400);
    expect(truth(`select count(*) from public.night_moments where memory_id = '${ALICE_MEMORY}'`)).toBe("1");
  });

  it("only the owner may describe a photo Moment", async () => {
    const bob = await defined(handlers.altText)(
      request(`/api/night-moments/${ALICE_MOMENT}/alt-text`, {
        method: "PATCH",
        bearer: BEARER_BOB,
        body: { altText: "bob was here" },
      }),
      context({ id: ALICE_MOMENT }),
    );
    expect(bob.status).toBe(403);
    expect(truth(`select coalesce(alt_text, '') from public.night_moments where id = '${ALICE_MOMENT}'`)).toBe("");

    const alice = await defined(handlers.altText)(
      request(`/api/night-moments/${ALICE_MOMENT}/alt-text`, {
        method: "PATCH",
        bearer: BEARER_ALICE,
        body: { altText: "the bar at closing" },
      }),
      context({ id: ALICE_MOMENT }),
    );
    expect(alice.status, await alice.clone().text()).toBe(200);
  });

  it("B can create her own Memory through the same door", async () => {
    const created = await defined(handlers.createMemory)(
      request("/api/night-memories", { bearer: BEARER_BOB, body: { title: "Bob night" } }),
      context({}),
    );
    console.error("CREATE CREW:", created.status, await created.clone().text());
    expect(created.status, await created.clone().text()).toBe(201);
    bobMemory = (await readJson<{ memory: { id: string } }>(created)).memory.id;
    expect(truth(`select owner_id from public.night_memories where id = '${bobMemory}'`)).toBe(BOB);
  });

  it("at the table: the Moment row answers its owner alone, and no browser role may write one", async () => {
    expect(visibleRows("authenticated", ALICE, `select count(*) from public.night_moments where id = '${ALICE_MOMENT}'`)).toBe(1);
    expect(visibleRows("authenticated", BOB, `select count(*) from public.night_moments where id = '${ALICE_MOMENT}'`)).toBe(0);
    expect(visibleRows("anon", null, `select count(*) from public.night_moments where id = '${ALICE_MOMENT}'`)).toBe(0);

    for (const [role, sub] of [["anon", null], ["authenticated", ALICE], ["authenticated", BOB]] as const) {
      const captioned = attemptAsRole(role, sub, `update public.night_moments set caption = 'rewritten' where id = '${ALICE_MOMENT}'`);
      expect(captioned.ok ? truth(`select caption from public.night_moments where id = '${ALICE_MOMENT}'`) : "refused")
        .not.toBe("rewritten");
      const inserted = attemptAsRole(
        role,
        sub,
        `insert into public.night_moments (id, memory_id, owner_id, kind, caption) values (gen_random_uuid(), '${ALICE_MEMORY}', '${sub ?? ALICE}', 'event', 'forged')`,
      );
      expect(inserted.ok).toBe(false);
      const deleted = attemptAsRole(role, sub, `delete from public.night_moments where id = '${ALICE_MOMENT}'`);
      expect(deleted.ok ? truth(`select count(*) from public.night_moments where id = '${ALICE_MOMENT}'`) : "1").toBe("1");
    }
  });

  it("at the bucket: the upload object is invisible to every browser role, its owner included, because only a server-minted signed URL serves it", async () => {
    for (const [role, sub] of [["anon", null], ["authenticated", ALICE], ["authenticated", BOB]] as const) {
      expect(visibleRows(role, sub, `select count(*) from storage.objects where name = '${ALICE_MOMENT_OBJECT}'`)).toBe(0);
      const moved = attemptAsRole(role, sub, `update storage.objects set name = 'stolen.jpg' where name = '${ALICE_MOMENT_OBJECT}'`);
      expect(moved.ok ? truth(`select count(*) from storage.objects where name = '${ALICE_MOMENT_OBJECT}'`) : "1").toBe("1");
      const removed = attemptAsRole(role, sub, `delete from storage.objects where name = '${ALICE_MOMENT_OBJECT}'`);
      expect(removed.ok ? truth(`select count(*) from storage.objects where name = '${ALICE_MOMENT_OBJECT}'`) : "1").toBe("1");
    }
  });
});

type PriceSubmitBody = {
  ok?: boolean;
  confirmationOutcome?: { status: string; confirmation?: { confirmationId: string }; dropIds?: string[] };
  pintTrust?: string;
  price?: { priceGbp: number };
};

/**
 * A price as a real client sends it since 7 Sept 2026: multipart, carrying the
 * photo of the bill the route refuses a price without (lib/pintDropReceipt.ts).
 * The bytes are a tiny real JPEG, which is what the upload path sniffs for.
 */
async function submitPrice(
  bearer: string | undefined,
  venueId: string,
  priceGbp: number,
  options: { receipt?: boolean } = {},
): Promise<Response> {
  const form = new FormData();
  form.set("venueId", venueId);
  form.set("drinkCategory", "beer");
  form.set("priceGbp", String(priceGbp));
  if (options.receipt !== false) {
    // A REAL receipt, because this suite reaches the real upload path: a
    // four-byte JPEG sniffs correctly and then dies inside sharp
    // ("VipsJpeg: JPEG datastream contains no image"), which answered 503 and
    // read as a broken permission rule (__tests__/helpers/billFixture.ts).
    form.set("receipt_photo", billFixtureFile());
  }
  return defined(handlers.priceSubmit)(
    request("/api/price-submit", { bearer, form }),
    context({}),
  );
}

/**
 * THE PRIVATE PROFILE CARD (migration 0154, the account-privacy wave).
 *
 * The cells run in file order over one shared account, because the choice is
 * state: Alice writes her card, the control cell reads it public, she turns it
 * private through her own door, and every role reads it again.
 *
 * WHAT THIS DOES NOT MEASURE, named rather than left to be discovered: the
 * Social BLOCK. Carol is a mutual follower Alice has blocked, so by the follow
 * graph she is a mate and this seam answers her the full card. A block lives in
 * the Social product-account graph keyed on profile ids (`social_blocks`), a
 * different identity space from the follow-handle graph the seam reads, and it
 * does not hide a PUBLIC profile card from a blocked account either, so this
 * wave neither opens that door nor closes it. Folding it in is its own slice
 * with its own cells, and asserting Carol's answer here would write the gap
 * down as intent.
 */
describe("private profile card: read", () => {
  const PROFILE_HANDLE = "alicepm";
  const WITHHELD = ["Alice-withheld-bio", "Camden", "Alice-withheld-work"];

  type CardBody = {
    projection?: string;
    profile?: Record<string, unknown> | null;
    socialLinks?: unknown[];
  };

  async function readCard(bearer?: string): Promise<{ status: number; raw: string; body: CardBody }> {
    const response = await defined(handlers.readProfile)(
      request(`/api/profiles/${PROFILE_HANDLE}`, bearer ? { bearer } : {}),
      context({ handle: PROFILE_HANDLE }),
    );
    const raw = await response.text();
    return { status: response.status, raw, body: JSON.parse(raw) as CardBody };
  }

  it("A authors her card through her own door, and every role reads it while it is public", async () => {
    const authored = await defined(handlers.writeProfile)(
      request(`/api/profiles/${PROFILE_HANDLE}`, {
        bearer: BEARER_ALICE,
        method: "PATCH",
        body: {
          displayName: "Alice PM",
          bio: "Alice-withheld-bio",
          homeCity: "Camden",
          workplace: "Alice-withheld-work",
        },
      }),
      context({ handle: PROFILE_HANDLE }),
    );
    expect(authored.status).toBe(200);

    for (const bearer of [undefined, BEARER_DAVE, BEARER_BOB, BEARER_ALICE]) {
      const card = await readCard(bearer);
      expect(card.status).toBe(200);
      expect(card.body.projection).toBe("full");
      expect(card.body.profile?.bio).toBe("Alice-withheld-bio");
    }
  });

  it("only A may turn her account private, and a stranger's attempt moves nothing", async () => {
    const dave = await defined(handlers.writeProfile)(
      request(`/api/profiles/${PROFILE_HANDLE}`, {
        bearer: BEARER_DAVE,
        method: "PATCH",
        body: { visibility: "private" },
      }),
      context({ handle: PROFILE_HANDLE }),
    );
    expect(dave.status).toBe(403);
    expect(truth(`select visibility from public.profiles where handle = '${PROFILE_HANDLE}'`))
      .toBe("public");

    const alice = await defined(handlers.writeProfile)(
      request(`/api/profiles/${PROFILE_HANDLE}`, {
        bearer: BEARER_ALICE,
        method: "PATCH",
        body: { visibility: "private" },
      }),
      context({ handle: PROFILE_HANDLE }),
    );
    expect(alice.status).toBe(200);
    expect(truth(`select visibility from public.profiles where handle = '${PROFILE_HANDLE}'`))
      .toBe("private");
  });

  it("anonymous and an unrelated account get the limited card and nothing withheld", async () => {
    for (const bearer of [undefined, BEARER_DAVE]) {
      const card = await readCard(bearer);
      expect(card.status).toBe(200);
      expect(card.body.projection).toBe("limited");
      // Asserted over the WHOLE serialized body rather than the fields a reader
      // remembered to check.
      for (const leak of WITHHELD) expect(card.raw).not.toContain(leak);
      expect(card.body.socialLinks).toEqual([]);
      // Still recognisable, which is the point of a limited card rather than a
      // 404: a friend has to know whose profile they have reached.
      expect(card.body.profile?.handle).toBe(PROFILE_HANDLE);
      expect(card.body.profile?.visibility).toBe("private");
    }
  });

  it("the owner and a mate get the full card", async () => {
    for (const bearer of [BEARER_ALICE, BEARER_BOB]) {
      const card = await readCard(bearer);
      expect(card.body.projection).toBe("full");
      expect(card.body.profile?.bio).toBe("Alice-withheld-bio");
      expect(card.body.profile?.workplace).toBe("Alice-withheld-work");
    }
  });

  it("at the table: no browser role reads another account's row, choice included", () => {
    expect(
      visibleRows("anon", null, `select count(*) from public.profiles where handle = '${PROFILE_HANDLE}'`),
    ).toBe(0);
    expect(
      visibleRows("authenticated", DAVE, `select count(*) from public.profiles where handle = '${PROFILE_HANDLE}'`),
    ).toBe(0);
    // Alice's own row is hers to read, which is what 0067's owner policy says.
    expect(
      visibleRows("authenticated", ALICE, `select count(*) from public.profiles where handle = '${PROFILE_HANDLE}'`),
    ).toBe(1);
  });

  it("at the table: a user JWT cannot insert a profile or rewrite a server-owned column, and the route still can", async () => {
    const stamp = `
      select handle || '|' || coalesce(founding_member_number::text, '') || '|' ||
        coalesce(avatar_moderation_state, '') || '|' || avatar_report_count::text || '|' ||
        coalesce(avatar_moderator_note, '')
      from public.profiles where id = '${ALICE_PROFILE}'
    `;
    const before = truth(stamp);
    const writes = [
      `update public.profiles set handle = 'support' where id = '${ALICE_PROFILE}'`,
      `update public.profiles set founding_member_number = 7 where id = '${ALICE_PROFILE}'`,
      `update public.profiles set avatar_moderation_state = 'approved' where id = '${ALICE_PROFILE}'`,
      `update public.profiles set avatar_report_count = 99 where id = '${ALICE_PROFILE}'`,
      `update public.profiles set avatar_moderator_note = 'cleared' where id = '${ALICE_PROFILE}'`,
      `delete from public.profiles where id = '${ALICE_PROFILE}'`,
    ];
    for (const [role, sub] of [["anon", null], ["authenticated", DAVE], ["authenticated", ALICE]] as const) {
      for (const statement of writes) {
        const attempted = attemptAsRole(role, sub, statement);
        expect(attempted.ok, attempted.err).toBe(false);
        expect(attempted.err).toMatch(/permission denied/i);
      }
      const inserted = attemptAsRole(
        role,
        sub,
        `insert into public.profiles (id, handle) values ('e5e5e5e5-e5e5-4e5e-8e5e-e5e5e5e5e5e5', 'burneddoor')`,
      );
      expect(inserted.ok, inserted.err).toBe(false);
      expect(inserted.err).toMatch(/permission denied/i);
    }
    expect(truth(`select count(*) from public.profiles where handle = 'burneddoor'`)).toBe("0");
    expect(truth(stamp)).toBe(before);

    const server = requireSession().sql(
      `update public.profiles set bio = bio where id = '${ALICE_PROFILE}'`,
      { asRole: "service_role" },
    );
    expect(server.ok, server.err).toBe(true);

    const routed = await defined(handlers.writeProfile)(
      request(`/api/profiles/${PROFILE_HANDLE}`, {
        bearer: BEARER_ALICE,
        method: "PATCH",
        body: { bio: "Alice-withheld-bio" },
      }),
      context({ handle: PROFILE_HANDLE }),
    );
    expect(routed.status).toBe(200);
  });

  it("A can turn it back, and the card is whole again", async () => {
    const restored = await defined(handlers.writeProfile)(
      request(`/api/profiles/${PROFILE_HANDLE}`, {
        bearer: BEARER_ALICE,
        method: "PATCH",
        body: { visibility: "public" },
      }),
      context({ handle: PROFILE_HANDLE }),
    );
    expect(restored.status).toBe(200);
    const card = await readCard();
    expect(card.body.projection).toBe("full");
    expect(card.body.profile?.bio).toBe("Alice-withheld-bio");
  });
});

// Local proof of the Confirm write. Vercel preview bundles for project
// chengdu inline the production Supabase host, so this file never calls a
// preview or pubmaxxing.com. A signed-in match sets pintTrust to confirmed.
// A different figure leaves it disputed. A logged-out caller gets 401 and
// neither browser role can insert a pint_drops row.
describe("price observation and its confirmation", () => {
  it("anonymous cannot log a price, and no browser role can insert a drop", async () => {
    const before = truth(`select count(*) from public.pint_drops where venue_id = '${PRICE_VENUE}'`);
    const response = await submitPrice(undefined, PRICE_VENUE, 4.5);
    expect(response.status).toBe(401);
    expect(truth(`select count(*) from public.pint_drops where venue_id = '${PRICE_VENUE}'`)).toBe(before);

    // The route is the write. RLS grants no insert to anon or authenticated,
    // so a logged-out PostgREST call cannot mint the row the route refused.
    for (const [role, sub] of [["anon", null], ["authenticated", ALICE]] as const) {
      const inserted = attemptAsRole(
        role,
        sub,
        `insert into public.pint_drops (id, venue_id, handle, price_gbp, status, visibility) values (gen_random_uuid(), '${PRICE_VENUE}', 'forged', 4.50, 'visible', 'public')`,
      );
      expect(inserted.ok, inserted.err).toBe(false);
      expect(inserted.err).toMatch(/permission denied/i);
    }
    expect(truth(`select count(*) from public.pint_drops where venue_id = '${PRICE_VENUE}'`)).toBe(before);
  });

  it("A's first report waits for a second drinker, and A's second figure is a second price", async () => {
    const first = await submitPrice(BEARER_ALICE, PRICE_VENUE, 4.5);
    expect(first.status, await first.clone().text()).toBe(201);
    const firstBody = await readJson<PriceSubmitBody>(first);
    expect(firstBody.confirmationOutcome?.status).toBe("awaiting_second_drinker");
    expect(firstBody.pintTrust).toBe("logged-once");

    // A second REPORT, not a second tap: a different figure, so the
    // duplicate-tap window (battle test D10) leaves it alone. Since 7 Sept 2026
    // the drop lane's agreement is EXACT, so 4.50 and 4.60 are two prices this
    // pub holds rather than one repeated report, and the outcome says so with
    // ONE drinker behind them. Trust stays unconfirmed. A mismatch is not a
    // confirmation.
    const repeat = await submitPrice(BEARER_ALICE, PRICE_VENUE, 4.6);
    expect(repeat.status, await repeat.clone().text()).toBe(201);
    const repeatBody = await readJson<PriceSubmitBody>(repeat);
    expect(repeatBody.confirmationOutcome).toMatchObject({
      status: "price_disagrees",
      prices: [4.5, 4.6],
      reporters: 1,
    });
    expect(repeatBody.pintTrust).toBe("disputed");
    expect(repeatBody.pintTrust).not.toBe("confirmed");
    expect(truth(
      `select count(*) from public.pint_drops where venue_id = '${PRICE_VENUE}' and confirmation_id is not null`,
    )).toBe("0");
  });

  it("B's independent report confirms the pair, and both rows carry one confirmation", async () => {
    const second = await submitPrice(BEARER_BOB, PRICE_VENUE, 4.5);
    expect(second.status, await second.clone().text()).toBe(201);
    const body = await readJson<PriceSubmitBody>(second);
    expect(body.confirmationOutcome?.status).toBe("confirmed");
    expect(body.pintTrust).toBe("confirmed");
    const confirmationId = body.confirmationOutcome?.confirmation?.confirmationId ?? "";
    expect(confirmationId).toMatch(/[0-9a-f-]{36}/);
    expect(truth(
      `select count(distinct handle) from public.pint_drops where confirmation_id = '${confirmationId}'`,
    )).toBe("2");
    expect(truth(
      `select count(*) from public.pint_drops where confirmation_id = '${confirmationId}'`,
    )).toBe("2");
  });

  it("A's own observation is versioned newer-wins under her actor, and B's row is not hers to move", async () => {
    const older = await submitPrice(BEARER_ALICE, SECOND_PRICE_VENUE, 4.8);
    expect(older.status, await older.clone().text()).toBe(201);
    const newer = await submitPrice(BEARER_ALICE, SECOND_PRICE_VENUE, 4.6);
    expect(newer.status, await newer.clone().text()).toBe(201);
    expect(truth(
      `select string_agg(price_pennies::text, ',') from public.community_prices where venue_id = '${SECOND_PRICE_VENUE}' and actor = 'profile:${ALICE_PROFILE}' and hidden_at is null`,
    )).toBe("460");

    const bobs = await submitPrice(BEARER_BOB, SECOND_PRICE_VENUE, 5.2);
    expect(bobs.status, await bobs.clone().text()).toBe(201);
    // Two actors, two rows; neither write touched the other's figure.
    expect(truth(
      `select string_agg(price_pennies::text, ',' order by actor) from public.community_prices where venue_id = '${SECOND_PRICE_VENUE}' and hidden_at is null`,
    )).toBe("460,520");

    // At the table, a browser JWT cannot rewrite a price row at all.
    const bobsRowId = truth(
      `select id from public.community_prices where venue_id = '${SECOND_PRICE_VENUE}' and actor = 'profile:${BOB_PROFILE}'`,
    );
    for (const sub of [ALICE, BOB]) {
      const rewritten = attemptAsRole("authenticated", sub, `update public.community_prices set price_pennies = 100 where id = '${bobsRowId}'`);
      expect(rewritten.ok ? truth(`select price_pennies from public.community_prices where id = '${bobsRowId}'`) : "refused")
        .not.toBe("100");
    }
  });

  it("at the table: a browser cannot read a Pint Drop, a visit report, or a contributor handle", async () => {
    expect(truth(`select handle from public.pint_drops where id = '${ANON_DROP}'`)).toBe("secret_author");

    const drops = await requireSession().rest(
      `/pint_drops?select=handle,moderator_note,receipt_photo_key&id=eq.${ANON_DROP}`,
      { sub: BOB },
    );
    expect(drops.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(drops.body)).not.toContain("secret_author");
    expect(JSON.stringify(drops.body)).not.toContain("staff-only-note");
    const anonymousDrops = await requireSession().rest(`/pint_drops?select=handle&id=eq.${ANON_DROP}`);
    expect(anonymousDrops.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(anonymousDrops.body)).not.toContain("secret_author");

    const tableRead = attemptAsRole(
      "authenticated",
      BOB,
      `select handle from public.pint_drops where id = '${ANON_DROP}'`,
    );
    expect(tableRead.ok, tableRead.err).toBe(false);
    expect(tableRead.err).toMatch(/permission denied/i);

    const reports = await requireSession().rest(
      `/structured_visit_reports?select=handle,moderator_note&id=eq.${VISIT_REPORT}`,
      { sub: BOB },
    );
    expect(reports.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(reports.body)).not.toContain("secret_author");
    expect(JSON.stringify(reports.body)).not.toContain("staff-only-note");

    const contributor = await requireSession().rest(
      `/community_prices?select=contributor_handle&id=eq.${VISIBLE_PRICE}`,
      { sub: BOB },
    );
    expect(contributor.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(contributor.body)).not.toContain("secret_author");

    const prices = await requireSession().rest(
      `/community_prices?select=id,price_pennies&venue_id=in.(${PRICE_VENUE},${DOOR_VENUE})`,
      { sub: BOB },
    );
    expect(prices.status).toBe(200);
    const priceRows = prices.body as Array<{ id: string; price_pennies: number }>;
    expect(priceRows.map((row) => row.id)).not.toContain(HIDDEN_PRICE);
    expect(priceRows).toContainEqual({ id: VISIBLE_PRICE, price_pennies: 450 });
    const actorColumn = await requireSession().rest(`/community_prices?select=actor&venue_id=eq.${PRICE_VENUE}`, { sub: BOB });
    expect(actorColumn.status).toBeGreaterThanOrEqual(400);
    const hiddenColumn = await requireSession().rest(`/community_prices?select=hidden_at&venue_id=eq.${PRICE_VENUE}`, { sub: BOB });
    expect(hiddenColumn.status).toBeGreaterThanOrEqual(400);
  });
});

describe("moderator actions", () => {
  it("owning the drop is not a moderator credential: confirm, restore and the review lanes refuse A and B", async () => {
    const logged = await submitPrice(BEARER_ALICE, MODERATOR_VENUE, 5.1);
    expect(logged.status, await logged.clone().text()).toBe(201);
    const aliceDrop = truth(
      `select id from public.pint_drops where venue_id = '${MODERATOR_VENUE}' and handle = 'alicepm' order by created_at limit 1`,
    );
    expect(aliceDrop).toMatch(/[0-9a-f-]{36}/);
    for (const bearer of [undefined, BEARER_ALICE, BEARER_BOB]) {
      const confirmed = await defined(handlers.pintDrops)(
        request("/api/pint-drops", { bearer, body: { action: "confirm", id: aliceDrop } }),
        context({}),
      );
      expect(confirmed.status).toBe(403);
      const restored = await defined(handlers.pintDrops)(
        request("/api/pint-drops", { bearer, body: { action: "restore", id: HIDDEN_DROP } }),
        context({}),
      );
      expect(restored.status).toBe(403);
      const lane = await defined(handlers.pintDropsRead)(
        request("/api/pint-drops?status=hidden", { bearer }),
        context({}),
      );
      expect(lane.status).toBe(403);
      const priceHide = await defined(handlers.adminPrices)(
        request("/api/admin/community-prices", { bearer, body: { action: "hide", id: HIDDEN_PRICE } }),
        context({}),
      );
      expect([401, 403]).toContain(priceHide.status);
    }
    expect(truth(`select status from public.pint_drops where id = '${HIDDEN_DROP}'`)).toBe("hidden");
    expect(truth(`select confirmation_id is null from public.pint_drops where id = '${aliceDrop}'`)).toBe("true");

    // The real credential, and only it, opens the door.
    const moderated = await defined(handlers.pintDrops)(
      request("/api/pint-drops", {
        body: { action: "confirm", id: aliceDrop },
        headers: { "x-admin-token": MODERATOR_TOKEN },
      }),
      context({}),
    );
    expect(moderated.status, await moderated.clone().text()).toBe(200);
    expect(truth(`select confirmation_basis from public.pint_drops where id = '${aliceDrop}'`)).toBe("moderator");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The wider matrix: the roles and resources the first cut did not reach.
//
// Astra's delta audit (6 Sep 2026, F07) read the Supabase advisor and found
// `rls_enabled_no_policy` on a set of tables that are service-mediated by
// design: `conversations`, `messages`, and the whole Social Crew family. A
// table with RLS on and no policy is refused to every browser role, which is
// the STRONGEST table answer there is; what it does not tell anybody is
// whether the ROUTE in front of it gates correctly, because the route holds
// the service-role key and RLS never runs for it. So the answer to that
// advisory is not a policy. It is this: the route door, asserted per role, per
// resource, with reads and writes separated.
//
// SEVEN ROLES. owner (Alice), invited participant (Bob, who holds a pending
// invitation and then a seat), guest (a device RSVP seat: a Plan capability
// token bound to no account), unrelated user (Dave), removed member (Bob,
// after his seat is taken), blocked user (Carol, who differs from Bob ONLY by
// the block) and staff (the `ADMIN_TOKEN` moderator, already asserted above).
//
// THREE RULES EVERY DENIED CELL IS HELD TO. A refusal answers the honest
// status; it leaks no protected metadata, which is asserted over the WHOLE
// serialized body rather than over the fields a reader remembered to check;
// and it has no side effect, which is asserted as a truth read of the row it
// was aimed at, taken before and after.

/** Every id-shaped thing a refusal may never disclose. */
const CREW_SECRETS = ["Alice crew night", "Alice private line", "Bob private line"];

function expectNoDisclosure(body: unknown, secrets: readonly string[] = CREW_SECRETS): void {
  const serialized = JSON.stringify(body ?? null);
  for (const secret of secrets) expect(serialized).not.toContain(secret);
}

function crewRequest(
  path: string,
  options: { bearer?: string; body?: Record<string, unknown>; method?: string; key?: string; headers?: Record<string, string> } = {},
): Request {
  // Every Crew write demands its own idempotency key, so one is minted per call
  // unless a cell is deliberately replaying.
  const key = options.key ?? `pm-crew-${Math.random().toString(16).slice(2)}-${Date.now()}`;
  return request(path, { ...options, key });
}

/** State the Crew cells build up, in file order, through the real routes. */
const crew: { id: string; bobMemberId: string; bobInvitationId: string; carolInvitationId: string } = {
  id: "",
  bobMemberId: "",
  bobInvitationId: "",
  carolInvitationId: "",
};

describe("Social Crew: the owner builds it through the real doors", () => {
  it("only the account holding the Plan's host seat may raise a Crew over it", async () => {
    // Dave has an account and no seat: the create is not his to make, and the
    // Plan is untouched by the attempt.
    const refused = await defined(handlers.createCrew)(
      crewRequest("/api/social/crews", {
        bearer: BEARER_DAVE,
        headers: { [CREW_HOST_HEADER]: "pm-crew-plan-host-capability-dave" },
        body: { planId: CREW_PLAN_ID, visibility: "private" },
      }),
      context({}),
    );
    expect(refused.status).toBeGreaterThanOrEqual(400);
    expectNoDisclosure(await readJson(refused));
    expect(
      truth(`select social_owner_account_id is null from public.plans where id = '${CREW_PLAN_ID}'`),
    ).toBe("true");

    const created = await defined(handlers.createCrew)(
      crewRequest("/api/social/crews", {
        bearer: BEARER_ALICE,
        headers: { [CREW_HOST_HEADER]: CREW_HOST_CAPABILITY },
        body: { planId: CREW_PLAN_ID, visibility: "private" },
      }),
      context({}),
    );
    expect(created.status, await created.clone().text()).toBe(201);
    const body = await readJson<{ crewId?: string }>(created);
    crew.id = String(body.crewId ?? "");
    expect(crew.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("the owner reads her Crew and every other role reads nothing", async () => {
    const owner = await defined(handlers.readCrew)(
      crewRequest(`/api/social/crews/${crew.id}`, { bearer: BEARER_ALICE }),
      context({ crewId: crew.id }),
    );
    expect(owner.status, await owner.clone().text()).toBe(200);

    // Dave is unrelated, Carol is blocked, and anonymous holds nothing. All
    // three get the same answer, so the refusal cannot be read as a membership
    // oracle, and none of them carries the Crew's own words.
    for (const bearer of [undefined, BEARER_DAVE, BEARER_CAROL]) {
      const response = await defined(handlers.readCrew)(
        crewRequest(`/api/social/crews/${crew.id}`, { bearer }),
        context({ crewId: crew.id }),
      );
      expect(response.status).toBeGreaterThanOrEqual(400);
      expectNoDisclosure(await readJson(response));
    }
  });

  it("a Crew id that names nothing answers exactly as a Crew somebody else owns", async () => {
    const unknown = await defined(handlers.readCrew)(
      crewRequest(`/api/social/crews/${UNKNOWN_ID}`, { bearer: BEARER_DAVE }),
      context({ crewId: UNKNOWN_ID }),
    );
    const foreign = await defined(handlers.readCrew)(
      crewRequest(`/api/social/crews/${crew.id}`, { bearer: BEARER_DAVE }),
      context({ crewId: crew.id }),
    );
    expect(unknown.status).toBe(foreign.status);
  });
});

describe("Social Crew: invitation, acceptance and the block", () => {
  it("only the owner may invite, and a blocked account cannot be invited at all", async () => {
    const byStranger = await defined(handlers.inviteToCrew)(
      crewRequest(`/api/social/crews/${crew.id}/invitations`, {
        bearer: BEARER_DAVE,
        body: { targetProfileId: DAVE_PROFILE },
      }),
      context({ crewId: crew.id }),
    );
    expect(byStranger.status).toBeGreaterThanOrEqual(400);
    expect(truth(`select count(*) from public.social_crew_invitations where crew_id = '${crew.id}'`)).toBe("0");

    // Carol is a mutual follower, so the block is the only thing left to
    // refuse her.
    const blocked = await defined(handlers.inviteToCrew)(
      crewRequest(`/api/social/crews/${crew.id}/invitations`, {
        bearer: BEARER_ALICE,
        body: { targetProfileId: CAROL_PROFILE },
      }),
      context({ crewId: crew.id }),
    );
    expect(blocked.status).toBeGreaterThanOrEqual(400);
    expect(truth(`select count(*) from public.social_crew_invitations where crew_id = '${crew.id}'`)).toBe("0");

    const invited = await defined(handlers.inviteToCrew)(
      crewRequest(`/api/social/crews/${crew.id}/invitations`, {
        bearer: BEARER_ALICE,
        body: { targetProfileId: BOB_PROFILE },
      }),
      context({ crewId: crew.id }),
    );
    expect(invited.status, await invited.clone().text()).toBe(201);
    crew.bobInvitationId = truth(
      `select id from public.social_crew_invitations where crew_id = '${crew.id}' and target_account_id = '${BOB_ACCOUNT}'`,
    );
  });

  it("an invitation is the target's alone: nobody else may spend it, and holding one is not yet a read", async () => {
    // Dave is not the target. The invitation stays pending, so the refusal
    // cost the invitation nothing.
    const stolen = await defined(handlers.decideInvitation)(
      crewRequest(`/api/social/crews/${crew.id}/invitations/${crew.bobInvitationId}`, {
        bearer: BEARER_DAVE,
        method: "PATCH",
        body: { action: "accept" },
      }),
      context({ crewId: crew.id, invitationId: crew.bobInvitationId }),
    );
    expect(stolen.status).toBeGreaterThanOrEqual(400);
    expectNoDisclosure(await readJson(stolen));
    expect(
      truth(`select state from public.social_crew_invitations where id = '${crew.bobInvitationId}'`),
    ).toBe("pending");

    // Bob holds the invitation and STILL reads nothing: an invitation is a way
    // in, never a view.
    const beforeAccepting = await defined(handlers.readCrew)(
      crewRequest(`/api/social/crews/${crew.id}`, { bearer: BEARER_BOB }),
      context({ crewId: crew.id }),
    );
    expect(beforeAccepting.status).toBeGreaterThanOrEqual(400);
    expectNoDisclosure(await readJson(beforeAccepting));
  });

  it("the target accepts, and acceptance is what opens the read", async () => {
    const accepted = await defined(handlers.decideInvitation)(
      crewRequest(`/api/social/crews/${crew.id}/invitations/${crew.bobInvitationId}`, {
        bearer: BEARER_BOB,
        method: "PATCH",
        body: { action: "accept" },
      }),
      context({ crewId: crew.id, invitationId: crew.bobInvitationId }),
    );
    expect(accepted.status, await accepted.clone().text()).toBe(200);

    const read = await defined(handlers.readCrew)(
      crewRequest(`/api/social/crews/${crew.id}`, { bearer: BEARER_BOB }),
      context({ crewId: crew.id }),
    );
    expect(read.status, await read.clone().text()).toBe(200);

    crew.bobMemberId = truth(
      `select id from public.social_crew_members where crew_id = '${crew.id}' and social_account_id = '${BOB_ACCOUNT}'`,
    );
  });

  it("a member is not an owner: he may not invite, remove or re-set the Crew", async () => {
    const before = truth(
      `select visibility from public.social_crews where id = '${crew.id}'`,
    );
    const invited = await defined(handlers.inviteToCrew)(
      crewRequest(`/api/social/crews/${crew.id}/invitations`, {
        bearer: BEARER_BOB,
        body: { targetProfileId: DAVE_PROFILE },
      }),
      context({ crewId: crew.id }),
    );
    expect(invited.status).toBeGreaterThanOrEqual(400);
    expect(
      truth(`select count(*) from public.social_crew_invitations where crew_id = '${crew.id}' and target_account_id = '${DAVE_ACCOUNT}'`),
    ).toBe("0");

    const changed = await defined(handlers.updateCrew)(
      crewRequest(`/api/social/crews/${crew.id}`, {
        bearer: BEARER_BOB,
        method: "PATCH",
        body: { visibility: "friends" },
      }),
      context({ crewId: crew.id }),
    );
    expect(changed.status).toBeGreaterThanOrEqual(400);
    expect(truth(`select visibility from public.social_crews where id = '${crew.id}'`)).toBe(before);
  });
});

describe("Social Crew: the removed member", () => {
  it("removal takes the read away in the same instant, and the removed member cannot put himself back", async () => {
    const removed = await defined(handlers.removeCrewMember)(
      crewRequest(`/api/social/crews/${crew.id}/members/${crew.bobMemberId}`, {
        bearer: BEARER_ALICE,
        method: "DELETE",
      }),
      context({ crewId: crew.id, memberId: crew.bobMemberId }),
    );
    expect(removed.status, await removed.clone().text()).toBe(200);
    expect(
      truth(`select state from public.social_crew_members where id = '${crew.bobMemberId}'`),
    ).toBe("removed");

    const read = await defined(handlers.readCrew)(
      crewRequest(`/api/social/crews/${crew.id}`, { bearer: BEARER_BOB }),
      context({ crewId: crew.id }),
    );
    expect(read.status).toBeGreaterThanOrEqual(400);
    expectNoDisclosure(await readJson(read));

    // The spent invitation is not a second door back in.
    const replayed = await defined(handlers.decideInvitation)(
      crewRequest(`/api/social/crews/${crew.id}/invitations/${crew.bobInvitationId}`, {
        bearer: BEARER_BOB,
        method: "PATCH",
        body: { action: "accept" },
      }),
      context({ crewId: crew.id, invitationId: crew.bobInvitationId }),
    );
    expect(replayed.status).toBeGreaterThanOrEqual(400);
    expect(
      truth(`select state from public.social_crew_members where id = '${crew.bobMemberId}'`),
    ).toBe("removed");
  });
});

describe("Social Crew: at the table", () => {
  it("no browser role may read a Crew row or call the Crew entry points, whoever they are", () => {
    for (const table of [
      "social_crews",
      "social_crew_members",
      "social_crew_invitations",
      "social_crew_join_requests",
      "private_social_crew_write_receipts",
      "private_social_accounts",
    ]) {
      expect(visibleRows("anon", null, `select count(*) from public.${table}`)).toBe(0);
      for (const sub of [ALICE, BOB, CAROL, DAVE]) {
        expect(visibleRows("authenticated", sub, `select count(*) from public.${table}`)).toBe(0);
      }
    }

    // The Crew RPCs are `security definer` and take the actor as an ARGUMENT,
    // so an EXECUTE grant to a browser role would be impersonation by
    // parameter. They are service-only, and this is the cell that says so.
    for (const call of [
      `select public.read_social_crew_snapshot('${BOB_ACCOUNT}'::uuid, '${BOB_PROFILE}'::uuid, '${crew.id}'::uuid)`,
      `select public.remove_social_crew_member_atomic('${BOB_ACCOUNT}'::uuid, '${crew.id}'::uuid, '${crew.bobMemberId}'::uuid, 'pm-matrix-key-000000', repeat('a', 64))`,
      `select public.social_relationship_between_profiles('${ALICE_PROFILE}'::uuid, '${BOB_PROFILE}'::uuid)`,
    ]) {
      const attempted = attemptAsRole("authenticated", BOB, call);
      expect(attempted.ok, call).toBe(false);
      expect(attempted.err).toMatch(/permission denied/i);
    }
  });
});
describe("private conversation: read", () => {
  it("anonymous is refused the thread and told nothing about it", async () => {
    const response = await defined(handlers.readThread)(
      request(`/api/messages/${CONVERSATION_ID}?handle=alicepm`),
      context({ id: CONVERSATION_ID }),
    );
    expect(response.status).toBe(401);
    expectNoDisclosure(await readJson(response));
  });

  it("both participants read the thread, and neither outsider does", async () => {
    for (const [bearer, handle] of [
      [BEARER_ALICE, "alicepm"],
      [BEARER_BOB, "bobpm"],
    ] as const) {
      const response = await defined(handlers.readThread)(
        request(`/api/messages/${CONVERSATION_ID}?handle=${handle}`, { bearer }),
        context({ id: CONVERSATION_ID }),
      );
      expect(response.status, await response.clone().text()).toBe(200);
      const body = await readJson<{ messages?: { body?: string }[] }>(response);
      expect(body.messages?.map((message) => message.body)).toEqual([
        "Alice private line",
        "Bob private line",
      ]);
    }

    // Dave and Carol are signed in, hold their own handles, and are not in
    // this conversation. Asking under their OWN handle answers an empty thread
    // rather than somebody else's, and asking under a participant's handle is
    // refused by the ownership gate.
    for (const [bearer, handle] of [
      [BEARER_DAVE, "davepm"],
      [BEARER_CAROL, "carolpm"],
    ] as const) {
      const own = await defined(handlers.readThread)(
        request(`/api/messages/${CONVERSATION_ID}?handle=${handle}`, { bearer }),
        context({ id: CONVERSATION_ID }),
      );
      expectNoDisclosure(await readJson(own.clone()));
      if (own.status === 200) {
        const body = await readJson<{ messages?: unknown[] }>(own);
        expect(body.messages ?? []).toEqual([]);
      }

      const impersonated = await defined(handlers.readThread)(
        request(`/api/messages/${CONVERSATION_ID}?handle=alicepm`, { bearer }),
        context({ id: CONVERSATION_ID }),
      );
      expect(impersonated.status).toBeGreaterThanOrEqual(400);
      expectNoDisclosure(await readJson(impersonated));
    }
  });

  it("a conversation id that names nothing reveals nothing to a participant either", async () => {
    const response = await defined(handlers.readThread)(
      request(`/api/messages/${UNKNOWN_ID}?handle=alicepm`, { bearer: BEARER_ALICE }),
      context({ id: UNKNOWN_ID }),
    );
    expectNoDisclosure(await readJson(response.clone()));
    if (response.status === 200) {
      const body = await readJson<{ messages?: unknown[] }>(response);
      expect(body.messages ?? []).toEqual([]);
    }
  });

  it("naming somebody else's handle does not ask for their inbox: the LINKED handle wins", async () => {
    // `resolveMessageHandle` prefers the handle the caller's account owns and
    // only ever falls back to the asserted one for a caller with no linked
    // profile. So Dave naming Alice is not a refusal, it is Dave's own inbox,
    // and the cell that matters is that Alice's conversation is not in it.
    const foreign = await defined(handlers.inbox)(
      request("/api/messages?handle=alicepm", { bearer: BEARER_DAVE }),
      context({}),
    );
    expect(foreign.status).toBe(200);
    const body = await readJson<{ conversations?: { id?: string }[] }>(foreign);
    expect(body.conversations?.some((row) => row.id === CONVERSATION_ID)).not.toBe(true);
    expectNoDisclosure(body);

    // An anonymous caller asserting a CLAIMED handle is refused outright,
    // because the handle belongs to an account and no bearer names it.
    const anonymous = await defined(handlers.inbox)(
      request("/api/messages?handle=alicepm"),
      context({}),
    );
    expect(anonymous.status).toBeGreaterThanOrEqual(400);
    expectNoDisclosure(await readJson(anonymous));
  });
});

describe("private conversation: write", () => {
  it("an outsider cannot send into a thread, and the thread does not grow", async () => {
    const before = truth(
      `select count(*) from public.messages where conversation_id = '${CONVERSATION_ID}'`,
    );
    for (const bearer of [undefined, BEARER_DAVE, BEARER_CAROL]) {
      const response = await defined(handlers.writeThread)(
        request(`/api/messages/${CONVERSATION_ID}`, {
          bearer,
          body: { action: "send", handle: "alicepm", body: "written by an outsider" },
        }),
        context({ id: CONVERSATION_ID }),
      );
      expect(response.status).toBeGreaterThanOrEqual(400);
    }
    expect(
      truth(`select count(*) from public.messages where conversation_id = '${CONVERSATION_ID}'`),
    ).toBe(before);
    expect(
      truth(`select count(*) from public.messages where body = 'written by an outsider'`),
    ).toBe("0");
  });

  it("at the table: the second line is PARTICIPANT-scoped, not deny-all, and it is read-only", () => {
    // Migration 0019 created both tables RLS-on with no policy and said so in
    // its own comment; 0066 then granted SELECT to `authenticated` behind two
    // participant policies. That comment is now the older half of the story, so
    // the cell asserts the LIVE rule: a participant reads their own thread, an
    // outsider reads nothing, anonymous reads nothing.
    for (const table of ["conversations", "messages"]) {
      expect(visibleRows("anon", null, `select count(*) from public.${table}`)).toBe(0);
      for (const outsider of [CAROL, DAVE]) {
        expect(
          visibleRows("authenticated", outsider, `select count(*) from public.${table}`),
        ).toBe(0);
      }
    }
    for (const participant of [ALICE, BOB]) {
      expect(
        visibleRows(
          "authenticated",
          participant,
          `select count(*) from public.conversations where id = '${CONVERSATION_ID}'`,
        ),
      ).toBe(1);
      expect(
        visibleRows(
          "authenticated",
          participant,
          `select count(*) from public.messages where conversation_id = '${CONVERSATION_ID}'`,
        ),
      ).toBe(2);
    }

    // SELECT is the whole grant. A participant may not write one either, so the
    // route stays the only way a message is ever made.
    const written = attemptAsRole(
      "authenticated",
      ALICE,
      `insert into public.messages (conversation_id, sender_handle, body)
         values ('${CONVERSATION_ID}', 'alicepm', 'written at the table')`,
    );
    expect(written.ok).toBe(false);
    expect(
      truth(`select count(*) from public.messages where body = 'written at the table'`),
    ).toBe("0");
  });
});

describe("message attachment: the photo's own door", () => {
  it("the object key never reaches an outsider, whatever they assert", async () => {
    // The bucket in front of this cluster holds no bytes, so a participant's
    // own read answers the same `Photo not found.` an outsider gets. What the
    // cell proves is that no refusal ever names the object, and that the row
    // below is what the participant gate reads.
    for (const [bearer, handle] of [
      [undefined, "alicepm"],
      [BEARER_DAVE, "davepm"],
      [BEARER_CAROL, "carolpm"],
      [BEARER_BOB, "bobpm"],
    ] as const) {
      const response = await defined(handlers.messagePhoto)(
        request(`/api/messages/${CONVERSATION_ID}/photo/${ALICE_MESSAGE}?handle=${handle}`, { bearer }),
        context({ id: CONVERSATION_ID, messageId: ALICE_MESSAGE }),
      );
      expect(response.status).toBeGreaterThanOrEqual(400);
      expectNoDisclosure(await readJson(response), [...CREW_SECRETS, MESSAGE_PHOTO_OBJECT]);
    }
  });

  it("a reported message loses its attachment, so the storage link stops answering its own participant", async () => {
    const reported = await defined(handlers.writeThread)(
      request(`/api/messages/${CONVERSATION_ID}`, {
        bearer: BEARER_BOB,
        body: { action: "report", handle: "bobpm", messageId: ALICE_MESSAGE },
      }),
      context({ id: CONVERSATION_ID }),
    );
    expect(reported.status, await reported.clone().text()).toBe(200);
    expect(
      truth(`select flagged_at is not null from public.messages where id = '${ALICE_MESSAGE}'`),
    ).toBe("true");

    // The row keeps its object key, because reporting is not deletion. What
    // stops is the READ: one projection drops the attachment, so the thread and
    // the serving door lose it in the same instant.
    expect(
      truth(`select attachment_object_key from public.messages where id = '${ALICE_MESSAGE}'`),
    ).toBe(MESSAGE_PHOTO_OBJECT);

    const thread = await defined(handlers.readThread)(
      request(`/api/messages/${CONVERSATION_ID}?handle=bobpm`, { bearer: BEARER_BOB }),
      context({ id: CONVERSATION_ID }),
    );
    expect(thread.status).toBe(200);
    const body = await readJson<{ messages?: { id?: string; attachment?: unknown }[] }>(thread);
    const flagged = body.messages?.find((message) => message.id === ALICE_MESSAGE);
    expect(flagged?.attachment ?? null).toBeNull();
  });
});

describe("saves: two lanes, two promises", () => {
  it("a Wanted is the owner's alone at the read and at the write", async () => {
    const seeded = await defined(handlers.writeWanted)(
      request("/api/wanted", {
        bearer: BEARER_ALICE,
        body: { venueId: PRICE_VENUE, venueName: "Venue Two", note: "Alice wants this" },
      }),
      context({}),
    );
    expect(seeded.status, await seeded.clone().text()).toBe(201);

    const owner = await readJson<{ wanteds?: { note?: string }[] }>(
      await defined(handlers.listWanted)(request("/api/wanted", { bearer: BEARER_ALICE }), context({})),
    );
    expect(owner.wanteds?.some((wanted) => wanted.note === "Alice wants this")).toBe(true);

    // Anonymous is refused; every other signed-in account reads its OWN empty
    // list and never Alice's line.
    const anonymous = await defined(handlers.listWanted)(request("/api/wanted"), context({}));
    expect(anonymous.status).toBe(401);
    for (const bearer of [BEARER_BOB, BEARER_CAROL, BEARER_DAVE]) {
      const response = await defined(handlers.listWanted)(request("/api/wanted", { bearer }), context({}));
      expectNoDisclosure(await readJson(response), ["Alice wants this"]);
    }
  });

  it("a Diary entry is the owner's alone at the read, the write and the table", async () => {
    const seeded = await defined(handlers.writeDiary)(
      request("/api/diary", {
        bearer: BEARER_ALICE,
        body: { venueId: PRICE_VENUE, visitedOn: "2026-09-01", rating: 4.5, review: "Alice diary line" },
      }),
      context({}),
    );
    expect(seeded.status, await seeded.clone().text()).toBe(201);
    expect(
      Number(truth(`select count(*) from public.diary_entries where owner_user_id = '${ALICE}'`)),
    ).toBe(1);

    const owner = await readJson<{ entries?: { review?: string }[] }>(
      await defined(handlers.listDiary)(request("/api/diary", { bearer: BEARER_ALICE }), context({})),
    );
    expect(owner.entries?.some((entry) => entry.review === "Alice diary line")).toBe(true);

    // The body names no owner: a second account that posts the same pub and day
    // writes its OWN row, never Alice's, and cannot read hers.
    const bobWrite = await defined(handlers.writeDiary)(
      request("/api/diary", {
        bearer: BEARER_BOB,
        body: { venueId: PRICE_VENUE, visitedOn: "2026-09-01", ownerUserId: ALICE, owner_user_id: ALICE, review: "Bob diary line" },
      }),
      context({}),
    );
    expect(bobWrite.status, await bobWrite.clone().text()).toBe(201);
    expect(
      Number(truth(`select count(*) from public.diary_entries where owner_user_id = '${ALICE}'`)),
    ).toBe(1);

    const anonymous = await defined(handlers.listDiary)(request("/api/diary"), context({}));
    expect(anonymous.status).toBe(401);
    for (const bearer of [BEARER_CAROL, BEARER_DAVE]) {
      const response = await defined(handlers.listDiary)(request("/api/diary", { bearer }), context({}));
      expectNoDisclosure(await readJson(response), ["Alice diary line", "Bob diary line"]);
    }
    const bobRead = await readJson(
      await defined(handlers.listDiary)(request("/api/diary", { bearer: BEARER_BOB }), context({})),
    );
    expectNoDisclosure(bobRead, ["Alice diary line"]);
  });

  it("a saved-pub list is PUBLIC to read and gated to write, and the write gate holds", async () => {
    const saved = await defined(handlers.writeSavedPub)(
      request("/api/saved-pubs", {
        bearer: BEARER_ALICE,
        body: { handle: "alicepm", venueId: PRICE_VENUE, listType: "favourites" },
      }),
      context({}),
    );
    expect(saved.status, await saved.clone().text()).toBeLessThan(400);
    const savedCount = truth(
      `select count(*) from public.saved_pubs where profile_id = '${ALICE_PROFILE}'`,
    );
    expect(Number(savedCount)).toBeGreaterThan(0);

    // An anonymous caller asserting a CLAIMED handle is refused: the handle
    // belongs to an account and no bearer names it.
    const anonymous = await defined(handlers.writeSavedPub)(
      request("/api/saved-pubs", {
        bearer: undefined,
        body: { handle: "alicepm", venueId: SECOND_PRICE_VENUE, listType: "favourites" },
      }),
      context({}),
    );
    expect(anonymous.status).toBe(403);

    // A signed-in caller naming Alice writes to their OWN list, because the
    // linked handle wins over the asserted one. Nothing is refused and nothing
    // of Alice's moves, which is the honest shape of this door.
    for (const [bearer, profile] of [
      [BEARER_BOB, BOB_PROFILE],
      [BEARER_DAVE, DAVE_PROFILE],
    ] as const) {
      const response = await defined(handlers.writeSavedPub)(
        request("/api/saved-pubs", {
          bearer,
          body: { handle: "alicepm", venueId: SECOND_PRICE_VENUE, listType: "favourites" },
        }),
        context({}),
      );
      expect(response.status, await response.clone().text()).toBe(200);
      expect(
        Number(truth(`select count(*) from public.saved_pubs where profile_id = '${profile}'`)),
      ).toBeGreaterThan(0);
    }
    expect(
      truth(`select count(*) from public.saved_pubs where profile_id = '${ALICE_PROFILE}'`),
    ).toBe(savedCount);

    // The READ is deliberately public: a saved list is printed on a public
    // profile. This cell records that as a decision rather than leaving it to
    // be discovered.
    const stranger = await defined(handlers.listSavedPubs)(
      request("/api/saved-pubs?handle=alicepm", { bearer: BEARER_DAVE }),
      context({}),
    );
    expect(stranger.status).toBe(200);
  });

  it("at the table: a save answers its owner alone, and every browser write is refused at the grant", () => {
    expect(visibleRows("anon", null, "select count(*) from public.saved_pubs")).toBe(0);
    expect(
      visibleRows(
        "authenticated",
        ALICE,
        `select count(*) from public.saved_pubs where profile_id = '${ALICE_PROFILE}'`,
      ),
    ).toBe(Number(truth(`select count(*) from public.saved_pubs where profile_id = '${ALICE_PROFILE}'`)));
    expect(
      visibleRows(
        "authenticated",
        DAVE,
        `select count(*) from public.saved_pubs where profile_id = '${ALICE_PROFILE}'`,
      ),
    ).toBe(0);

    // 0172 took every browser write grant, so the owner's own update is
    // refused at the grant as well as a stranger's, and nothing MOVED.
    for (const sub of [DAVE, ALICE]) {
      const attempted = attemptAsRole(
        "authenticated",
        sub,
        `update public.saved_pubs set note = 'moved at the table' where profile_id = '${ALICE_PROFILE}'`,
      );
      expect(attempted.ok, attempted.err).toBe(false);
      expect(attempted.err).toMatch(/permission denied/i);
    }
    expect(
      truth(`select count(*) from public.saved_pubs where note = 'moved at the table'`),
    ).toBe("0");
  });
});

describe("account export", () => {
  it("anonymous is refused the file", async () => {
    const response = await defined(handlers.exportAccount)(request("/api/account/export"), context({}));
    expect(response.status).toBe(401);
    expectNoDisclosure(await readJson(response));
  });

  it("the account exported is the one the bearer names, and no request field can move it", async () => {
    const response = await defined(handlers.exportAccount)(
      request(`/api/account/export?handle=alicepm&userId=${ALICE}`, { bearer: BEARER_DAVE }),
      context({}),
    );
    // Dave gets Dave's file or an honest refusal. What he may never get is
    // Alice's, so the cell is asserted over the whole body.
    expectNoDisclosure(await readJson(response), [
      ...CREW_SECRETS,
      "Alice wants this",
      "alicepm",
      ALICE,
    ]);
  });
});

describe("guest: a device RSVP holds a capability, and a capability is not an identity", () => {
  it("the device seat opens the Plan it is a seat on", async () => {
    const response = await defined(handlers.readPlan)(
      request(`/api/plans/${PLAN_ID}`, { bearer: GUEST_TOKEN }),
      context({ id: PLAN_ID }),
    );
    expect(response.status, await response.clone().text()).toBe(200);
    const body = await readJson<PreviewBody>(response);
    expect(body.visibility).not.toBe("preview");
  });

  it("that seat cannot collaborate, and the Plan does not move when it tries", async () => {
    const revision = planRevision();
    const order = planStopOrder();
    for (const [handler, path, body] of [
      [handlers.updatePlan, `/api/plans/${PLAN_ID}`, { route: REORDERED_ROUTE, routeRevision: revision }],
      [handlers.rotateInvite, `/api/plans/${PLAN_ID}/invite-rotate`, { expiresInMinutes: 120 }],
    ] as const) {
      const response = await (handler as Handler)(
        request(path, {
          bearer: GUEST_TOKEN,
          method: path.endsWith("invite-rotate") ? "POST" : "PATCH",
          body,
          key: "pm-guest-idempotency-key-0001",
        }),
        context({ id: PLAN_ID }),
      );
      expect(response.status).toBeGreaterThanOrEqual(400);
    }
    expect(planRevision()).toBe(revision);
    expect(planStopOrder()).toBe(order);
  });

  it("the seat token names nobody anywhere else: no inbox, no Wanted, no export, no deletion", async () => {
    for (const [handler, path] of [
      [handlers.inbox, "/api/messages"],
      [handlers.listWanted, "/api/wanted"],
      [handlers.listDiary, "/api/diary"],
      [handlers.exportAccount, "/api/account/export"],
    ] as const) {
      const response = await (handler as Handler)(
        request(path, { bearer: GUEST_TOKEN }),
        context({}),
      );
      expectNoDisclosure(await readJson(response.clone()), [
        ...CREW_SECRETS,
        "Alice wants this",
        "Alice diary line",
      ]);
      // A capability that is not an identity is anonymous to every route that
      // asks who is calling, so each answers its own anonymous outcome.
      expect(response.status === 200 || response.status === 401).toBe(true);
    }

    const deleted = await defined(handlers.deleteAccount)(
      request("/api/account", { method: "DELETE", bearer: GUEST_TOKEN, body: { userId: ALICE } }),
      context({}),
    );
    expect(deleted.status).toBe(401);
    expect(deletion.calls).toEqual([]);
  });
});

describe("photo tags: the consent inbox is the tagged account's own", () => {
  it("anonymous is refused, and every signed-in account reads only its own lane", async () => {
    const anonymous = await defined(handlers.tagInbox)(request("/api/social/tags?lane=proposed"), context({}));
    expect(anonymous.status).toBe(401);
    expectNoDisclosure(await readJson(anonymous));

    for (const bearer of [BEARER_ALICE, BEARER_DAVE]) {
      const response = await defined(handlers.tagInbox)(
        request("/api/social/tags?lane=proposed", { bearer }),
        context({}),
      );
      expect(response.status, await response.clone().text()).toBe(200);
      expectNoDisclosure(await readJson(response));
    }
  });

  it("the lane takes no actor parameter, so no caller can ask for somebody else's", async () => {
    // An unknown query key is refused outright rather than ignored, which is
    // what stops `?actor=` or `?profileId=` ever being read as an instruction.
    const response = await defined(handlers.tagInbox)(
      request(`/api/social/tags?lane=proposed&actor=${ALICE_PROFILE}`, { bearer: BEARER_DAVE }),
      context({}),
    );
    expect(response.status).toBe(400);
    expectNoDisclosure(await readJson(response));
  });
});

describe("account deletion", () => {
  it("anonymous is refused and nothing is deleted", async () => {
    const response = await defined(handlers.deleteAccount)(
      request("/api/account", { method: "DELETE", body: { userId: ALICE } }),
      context({}),
    );
    expect(response.status).toBe(401);
    expect(deletion.calls).toEqual([]);
  });

  it("the deleted account is the caller's own whatever the body names, and the other account's rows survive", async () => {
    const response = await defined(handlers.deleteAccount)(
      request("/api/account", { method: "DELETE", bearer: BEARER_BOB, body: { userId: ALICE, handle: "alicepm" } }),
      context({}),
    );
    expect(response.status, await response.clone().text()).toBe(200);
    expect(deletion.calls).toEqual([BOB]);

    // 0078: the profile is tombstoned while the auth row is still there to name it.
    expect(truth(`select tombstoned_at is not null from public.profiles where id = '${BOB_PROFILE}'`)).toBe("true");
    expect(truth(`select count(*) from auth.users where id = '${BOB}'`)).toBe("0");
    expect(truth(`select count(*) from public.night_memories where owner_id = '${BOB}'`)).toBe("0");

    expect(truth(`select count(*) from auth.users where id = '${ALICE}'`)).toBe("1");
    expect(truth(`select tombstoned_at is null from public.profiles where id = '${ALICE_PROFILE}'`)).toBe("true");
    expect(truth(`select count(*) from public.night_moments where id = '${ALICE_MOMENT}'`)).toBe("1");
    expect(truth(`select count(*) from public.plans where id = '${PLAN_ID}' and owner_user_id = '${ALICE}'`)).toBe("1");
  });
});
