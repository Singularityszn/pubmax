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
  BEARER_ALICE: "pm-bearer-alice",
  BEARER_BOB: "pm-bearer-bob",
}));
vi.mock("@/lib/authServer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authServer")>();
  const identityFor = (request: Request) => {
    const token = actual.bearerToken(request);
    if (token === ACTORS.BEARER_ALICE) return { id: ACTORS.ALICE, email: null, createdAt: null };
    if (token === ACTORS.BEARER_BOB) return { id: ACTORS.BOB, email: null, createdAt: null };
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

const { ALICE, BOB, BEARER_ALICE, BEARER_BOB } = ACTORS;
const ALICE_PROFILE = "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1";
const BOB_PROFILE = "b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2";
const PLAN_ID = "c0000000-0000-4000-8000-000000000003";
const HOST_MEMBER_ID = "c1000000-0000-4000-8000-000000000004";
const HOST_TOKEN = "pm-host-member-token";
const ALICE_MEMORY = "d0000000-0000-4000-8000-000000000005";
const ALICE_MOMENT = "d1000000-0000-4000-8000-000000000006";
const ALICE_MOMENT_OBJECT = `night-moments/${ALICE}/${ALICE_MEMORY}/venue.jpg`;
const HIDDEN_DROP = "e0000000-0000-4000-8000-000000000007";
const HIDDEN_PRICE = "e1000000-0000-4000-8000-000000000008";
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
    method?: string;
    headers?: Record<string, string>;
  } = {},
): Request {
  const headers = new Headers({ "content-type": "application/json", ...(options.headers ?? {}) });
  if (options.bearer) headers.set("authorization", `Bearer ${options.bearer}`);
  if (options.key) headers.set("idempotency-key", options.key);
  return new Request(`http://localhost${path}`, {
    method: options.method ?? (options.body ? "POST" : "GET"),
    headers,
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
  };
  hashPlanMemberToken = planStore.hashPlanMemberToken;

  deletion.run = (userId) => {
    const result = session!.sql(`delete from auth.users where id = '${userId}'`);
    return result.ok ? "deleted" : "unavailable";
  };

  const seeded = session.sql(`
    insert into auth.users (id) values ('${ALICE}'), ('${BOB}');

    insert into public.profiles (id, user_id, handle) values
      ('${ALICE_PROFILE}', '${ALICE}', 'alicepm'),
      ('${BOB_PROFILE}', '${BOB}', 'bobpm');

    -- Both accounts are adults on file, so a price lane's onboarding gate is
    -- never what refuses a cell below.
    insert into public.private_account_identities (user_id, date_of_birth) values
      ('${ALICE}', '1990-01-01'),
      ('${BOB}', '1991-02-02');

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

    -- A hidden Pint Drop and a hidden community price: moderation state a
    -- browser role may never read back.
    insert into public.pint_drops (id, venue_id, handle, price_gbp, status, visibility)
      values ('${HIDDEN_DROP}', '${PRICE_VENUE}', 'alicepm', 3.10, 'hidden', 'public');
    insert into public.community_prices (id, venue_id, drink_category, price_pennies, actor, contributor_handle, hidden_at)
      values ('${HIDDEN_PRICE}', '${PRICE_VENUE}', 'beer', 310, 'profile:${ALICE_PROFILE}', 'alicepm', now());
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
      const response = await handlers.readPlan(
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
    const response = await handlers.readPlan(
      request(`/api/plans/${PLAN_ID}`, { bearer: HOST_TOKEN }),
      context({ id: PLAN_ID }),
    );
    expect(response.status).toBe(200);
    const body = await readJson<{ plan: { title: string }; stops: unknown[]; crew: unknown[] }>(response);
    expect(body.plan.title).toBe("Alice private night");
    expect(body.stops).toHaveLength(3);
    expect(body.crew).toHaveLength(1);
  });

  it("the get-in and recap views answer the preview to a stranger", async () => {
    for (const handler of [handlers.getin, handlers.recap]) {
      for (const bearer of [undefined, BEARER_BOB]) {
        const response = await handler(
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
    const response = await handlers.planCard(
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
      const replaced = await handlers.updatePlan(
        request(`/api/plans/${PLAN_ID}`, {
          method: "PATCH",
          bearer,
          body: { stops: REORDERED_ROUTE, expectedRouteRevision: revisionBefore },
        }),
        context({ id: PLAN_ID }),
      );
      expect([400, 403]).toContain(replaced.status);

      const rotated = await handlers.rotateInvite(
        request(`/api/plans/${PLAN_ID}/invite-rotate`, { bearer, body: {} }),
        context({ id: PLAN_ID }),
      );
      expect(rotated.status).toBe(403);

      const presence = await handlers.presence(
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
    const replaced = await handlers.updatePlan(
      request(`/api/plans/${PLAN_ID}`, {
        method: "PATCH",
        bearer: HOST_TOKEN,
        body: { stops: REORDERED_ROUTE, expectedRouteRevision: revisionBefore },
      }),
      context({ id: PLAN_ID }),
    );
    expect(replaced.status, await replaced.text()).toBe(200);
    expect(planRevision()).toBe(revisionBefore + 1);
    expect(planStopOrder()).toBe(REORDERED_ROUTE.map((stop) => stop.venueId).join(","));
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
    expect(truth(`select count(*) from public.plan_crew_members where plan_id = '${PLAN_ID}'`)).toBe("1");
  });
});

describe("invite capability", () => {
  let inviteToken = "";
  let guestToken = "";

  it("an invite token is not a member token: as a bearer it reads the preview and edits nothing", async () => {
    const created = await handlers.createInvite(
      request(`/api/plans/${PLAN_ID}/invites`, {
        bearer: HOST_TOKEN,
        key: "matrix-invite-1",
        body: { expiresInMinutes: 30 },
      }),
      context({ id: PLAN_ID }),
    );
    expect(created.status, await created.clone().text()).toBe(201);
    inviteToken = (await readJson<{ token: string }>(created)).token;
    expect(inviteToken).toBeTruthy();

    const read = await handlers.readPlan(
      request(`/api/plans/${PLAN_ID}`, { bearer: inviteToken }),
      context({ id: PLAN_ID }),
    );
    expect(read.status).toBe(200);
    expectPreview(await readJson<PreviewBody>(read));

    const revision = planRevision();
    const edited = await handlers.updatePlan(
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
    const joined = await handlers.join(
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

    const member = await handlers.readPlan(
      request(`/api/plans/${PLAN_ID}`, { bearer: guestToken }),
      context({ id: PLAN_ID }),
    );
    expect(member.status).toBe(200);
    expect((await readJson<{ stops: unknown[] }>(member)).stops).toHaveLength(3);

    // The account bearer alone is still the preview: capability, not identity,
    // is the Plan's read key (audit section 5 observed the same).
    const bare = await handlers.readPlan(
      request(`/api/plans/${PLAN_ID}`, { bearer: BEARER_BOB }),
      context({ id: PLAN_ID }),
    );
    expectPreview(await readJson<PreviewBody>(bare));

    // At the table, the seat makes B a participant: RLS now answers her JWT.
    const rows = await requireSession().rest(`/plans?select=id&id=eq.${PLAN_ID}`, { sub: BOB });
    expect(rows.body).toEqual([{ id: PLAN_ID }]);
  });

  it("the invite is spent: a second redemption is refused, and one account holds one seat", async () => {
    const replay = await handlers.join(
      request(`/api/plans/${PLAN_ID}/join`, {
        key: "matrix-join-replay",
        body: { name: "Again", inviteToken },
      }),
      context({ id: PLAN_ID }),
    );
    expect(replay.status).toBeGreaterThanOrEqual(400);

    const fresh = await handlers.createInvite(
      request(`/api/plans/${PLAN_ID}/invites`, {
        bearer: HOST_TOKEN,
        key: "matrix-invite-2",
        body: { expiresInMinutes: 30 },
      }),
      context({ id: PLAN_ID }),
    );
    const second = (await readJson<{ token: string }>(fresh)).token;
    const secondSeat = await handlers.join(
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
    const rotated = await handlers.rotateInvite(
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

    const read = await handlers.readPlan(
      request(`/api/plans/${PLAN_ID}`, { bearer: guestToken }),
      context({ id: PLAN_ID }),
    );
    expectPreview(await readJson<PreviewBody>(read));

    const presence = await handlers.presence(
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
    const anonymous = await handlers.listMemories(request("/api/night-memories"), context({}));
    expect(anonymous.status).toBe(401);

    const bob = await handlers.listMemories(request("/api/night-memories", { bearer: BEARER_BOB }), context({}));
    expect(bob.status).toBe(200);
    expect((await readJson<{ memories: Array<{ id: string }> }>(bob)).memories.map((row) => row.id))
      .not.toContain(ALICE_MEMORY);

    const alice = await handlers.listMemories(request("/api/night-memories", { bearer: BEARER_ALICE }), context({}));
    expect(alice.status).toBe(200);
    expect((await readJson<{ memories: Array<{ id: string }> }>(alice)).memories.map((row) => row.id))
      .toContain(ALICE_MEMORY);
  });

  it("A's Moments answer only to A, and B can neither read nor add to that Memory", async () => {
    const anonymous = await handlers.listMoments(
      request(`/api/night-memories/${ALICE_MEMORY}/moments`),
      context({ id: ALICE_MEMORY }),
    );
    expect(anonymous.status).toBe(401);

    const bob = await handlers.listMoments(
      request(`/api/night-memories/${ALICE_MEMORY}/moments`, { bearer: BEARER_BOB }),
      context({ id: ALICE_MEMORY }),
    );
    expect(bob.status).toBe(200);
    expect((await readJson<{ moments: unknown[] }>(bob)).moments).toEqual([]);

    const alice = await handlers.listMoments(
      request(`/api/night-memories/${ALICE_MEMORY}/moments`, { bearer: BEARER_ALICE }),
      context({ id: ALICE_MEMORY }),
    );
    expect(alice.status).toBe(200);
    const mine = await readJson<{ moments: Array<{ id: string; mediaObjectKey?: string }> }>(alice);
    expect(mine.moments.map((row) => row.id)).toEqual([ALICE_MOMENT]);

    const intruded = await handlers.addMoment(
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
    const bob = await handlers.altText(
      request(`/api/night-moments/${ALICE_MOMENT}/alt-text`, {
        method: "PATCH",
        bearer: BEARER_BOB,
        body: { altText: "bob was here" },
      }),
      context({ id: ALICE_MOMENT }),
    );
    expect(bob.status).toBe(403);
    expect(truth(`select coalesce(alt_text, '') from public.night_moments where id = '${ALICE_MOMENT}'`)).toBe("");

    const alice = await handlers.altText(
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
    const created = await handlers.createMemory(
      request("/api/night-memories", { bearer: BEARER_BOB, body: { title: "Bob night" } }),
      context({}),
    );
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
  price?: { priceGbp: number };
};

async function submitPrice(bearer: string | undefined, venueId: string, priceGbp: number): Promise<Response> {
  return handlers.priceSubmit(
    request("/api/price-submit", {
      bearer,
      body: { venueId, drinkCategory: "beer", priceGbp },
    }),
    context({}),
  );
}

describe("price observation and its confirmation", () => {
  it("anonymous cannot log a price", async () => {
    const response = await submitPrice(undefined, PRICE_VENUE, 4.5);
    expect(response.status).toBe(401);
  });

  it("A's first report waits for a second drinker, and A reporting again is named as the same reporter", async () => {
    const first = await submitPrice(BEARER_ALICE, PRICE_VENUE, 4.5);
    expect(first.status, await first.clone().text()).toBe(201);
    expect((await readJson<PriceSubmitBody>(first)).confirmationOutcome?.status).toBe("awaiting_second_drinker");

    // A second REPORT, not a second tap: a different figure inside the shared
    // agreement tolerance, so the duplicate-tap window (battle test D10) leaves
    // it alone and the independence rule is what answers.
    const repeat = await submitPrice(BEARER_ALICE, PRICE_VENUE, 4.6);
    expect(repeat.status, await repeat.clone().text()).toBe(201);
    expect((await readJson<PriceSubmitBody>(repeat)).confirmationOutcome?.status).toBe("same_reporter");
    expect(truth(
      `select count(*) from public.pint_drops where venue_id = '${PRICE_VENUE}' and confirmation_id is not null`,
    )).toBe("0");
  });

  it("B's independent report confirms the pair, and both rows carry one confirmation", async () => {
    const second = await submitPrice(BEARER_BOB, PRICE_VENUE, 4.5);
    expect(second.status, await second.clone().text()).toBe(201);
    const body = await readJson<PriceSubmitBody>(second);
    expect(body.confirmationOutcome?.status).toBe("confirmed");
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

  it("at the table: hidden rows and the actor column stay out of every browser read", async () => {
    const drops = await requireSession().rest(`/pint_drops?select=id&venue_id=eq.${PRICE_VENUE}`, { sub: BOB });
    expect(drops.status).toBe(200);
    expect((drops.body as Array<{ id: string }>).map((row) => row.id)).not.toContain(HIDDEN_DROP);
    const anonymousDrops = await requireSession().rest(`/pint_drops?select=id&venue_id=eq.${PRICE_VENUE}`);
    expect(anonymousDrops.status === 200 ? anonymousDrops.body : []).toEqual([]);

    const prices = await requireSession().rest(`/community_prices?select=id&venue_id=eq.${PRICE_VENUE}`, { sub: BOB });
    expect(prices.status).toBe(200);
    expect((prices.body as Array<{ id: string }>).map((row) => row.id)).not.toContain(HIDDEN_PRICE);
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
      const confirmed = await handlers.pintDrops(
        request("/api/pint-drops", { bearer, body: { action: "confirm", id: aliceDrop } }),
        context({}),
      );
      expect(confirmed.status).toBe(403);
      const restored = await handlers.pintDrops(
        request("/api/pint-drops", { bearer, body: { action: "restore", id: HIDDEN_DROP } }),
        context({}),
      );
      expect(restored.status).toBe(403);
      const lane = await handlers.pintDropsRead(
        request("/api/pint-drops?status=hidden", { bearer }),
        context({}),
      );
      expect(lane.status).toBe(403);
      const priceHide = await handlers.adminPrices(
        request("/api/admin/community-prices", { bearer, body: { action: "hide", id: HIDDEN_PRICE } }),
        context({}),
      );
      expect([401, 403]).toContain(priceHide.status);
    }
    expect(truth(`select status from public.pint_drops where id = '${HIDDEN_DROP}'`)).toBe("hidden");
    expect(truth(`select confirmation_id is null from public.pint_drops where id = '${aliceDrop}'`)).toBe("true");

    // The real credential, and only it, opens the door.
    const moderated = await handlers.pintDrops(
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

describe("account deletion", () => {
  it("anonymous is refused and nothing is deleted", async () => {
    const response = await handlers.deleteAccount(
      request("/api/account", { method: "DELETE", body: { userId: ALICE } }),
      context({}),
    );
    expect(response.status).toBe(401);
    expect(deletion.calls).toEqual([]);
  });

  it("the deleted account is the caller's own whatever the body names, and the other account's rows survive", async () => {
    const response = await handlers.deleteAccount(
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
