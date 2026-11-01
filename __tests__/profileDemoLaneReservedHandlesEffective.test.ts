// Audit finding lib/profileOwnership:gateHandleAction-unlinked-lane-ignores-tombstone-and-retired-alias,
// proved on real PostgreSQL and PostgREST through the real Supabase stores and
// the real routes.
//
// THE FAULT. The anonymous demo lane opened for any handle whose profiles row
// had no owner, or had no row at all. Two RESERVED identifiers pass that test:
// a deleted account's profile (the tombstone trigger keeps the row and the FK
// clears its owner) and a retired alias (a renamed live account's previous
// handle, which exists only in profile_handle_aliases). So an anonymous caller
// could rewrite a departed account's profile, check in under its handle, and
// save a public crawl story under a retired or departed name, while the claim
// and rename doors refuse exactly those handles. And profileStore.ensure()
// could mint a fresh profiles row under a retired alias.
//
// THE PROOF. The route and store checks run with every migration before 0200,
// so they prove the application gate on its own. Then the database half: a
// bare insert takes a retired alias before 0200, is refused after it, and is
// accepted again after the rollback.

import { readdirSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { postgresSkipReason } from "./helpers/postgres";

type Session = {
  sqlFile(path: string): void;
  sql(statement: string): { ok: boolean; out: string; err: string };
  reloadPostgrestSchema(): Promise<void>;
  stop(): Promise<void>;
  restBaseUrl: string;
  serviceRoleKey: string;
};

const ROOT = process.cwd();
const MIGRATIONS = join(ROOT, "supabase/migrations");
const FORWARD_NAME = "20261028120000_0200_profile_handle_alias_reservation.sql";
const FORWARD = join(MIGRATIONS, FORWARD_NAME);
const ROLLBACK = join(
  MIGRATIONS,
  "rollback/20261028120000_0200_profile_handle_alias_reservation_rollback.sql",
);

const RENAMED_USER = "c1970000-0000-4000-8000-000000000001";
const DEPARTED_USER = "c1970000-0000-4000-8000-000000000002";
const FRESH_USER = "c1970000-0000-4000-8000-000000000003";
const RETIRED_ALIAS = "alias_before_rename";
const CURRENT_HANDLE = "alias_after_rename";
const DEPARTED = "departed_drinker";
const PUB = "venue-eltcmh";

const skipReason = postgresSkipReason();
const nativeFetch = globalThis.fetch;
let session: Session | null = null;
let routes: {
  PATCH: typeof import("@/app/api/profiles/[handle]/route").PATCH;
  DELETE: typeof import("@/app/api/profiles/[handle]/route").DELETE;
  CHECK_IN: typeof import("@/app/api/check-ins/route").POST;
  CRAWL: typeof import("@/app/api/crawls/route").POST;
};
let profiles: typeof import("@/lib/profileStore").supabaseProfileStore;

function db(): Session {
  if (!session) throw new Error("Demo lane proof has no database session");
  return session;
}

function sql(statement: string): string {
  const result = db().sql(statement);
  if (!result.ok) throw new Error(result.err);
  return result.out.trim();
}

/** A statement that must fail, with the error text PostgreSQL gave. */
function refusal(statement: string): string {
  const result = db().sql(statement);
  expect(result.ok, `expected a refusal: ${statement}`).toBe(false);
  return result.err;
}

/** An anonymous request: no bearer, so the demo lane is the only lane. */
function anonymous(url: string, method: string, body?: unknown): Request {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json", "x-real-ip": "203.0.113.70" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

const handleParams = (handle: string) => ({ params: Promise.resolve({ handle }) });

function departedRow(): string {
  return sql(`select coalesce(display_name, '') || '|' || coalesce(bio, '') || '|' ||
    (user_id is null) || '|' || (tombstoned_at is not null)
    from public.profiles where handle = '${DEPARTED}';`);
}

beforeAll(async () => {
  if (skipReason) return;
  // @ts-expect-error The existing executable session harness has no declarations.
  const harness = await import("../scripts/rls/session-harness.mjs") as {
    startRlsSession(): Promise<Session>;
  };
  session = await harness.startRlsSession();
  try {
    for (const name of readdirSync(MIGRATIONS)
      .filter((name) => name.endsWith(".sql")
        && name > "20260806035204_0070_v1_release_security.sql"
        && name < FORWARD_NAME)
      .sort()) {
      session.sqlFile(join(MIGRATIONS, name));
    }
    await session.reloadPostgrestSchema();
    vi.stubEnv("SUPABASE_URL", session.restBaseUrl);
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", session.serviceRoleKey);
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("PUBMAX_SOCIAL_FRIENDS_LAUNCH", "1");
    const restBaseUrl = session.restBaseUrl;
    const origin = new URL(restBaseUrl).origin;
    // The real Supabase client talks to real PostgREST; only its URL prefix is
    // adapted, and no other HTTP origin is reachable.
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      const requested = input instanceof Request ? input.url : String(input);
      if (new URL(requested).origin !== origin) throw new Error("Demo lane proof forbids external HTTP");
      const local = requested.replace(`${restBaseUrl}/rest/v1`, restBaseUrl);
      return nativeFetch(input instanceof Request ? new Request(local, input) : local, init);
    });
    vi.resetModules();
    const profileRoute = await import("@/app/api/profiles/[handle]/route");
    routes = {
      PATCH: profileRoute.PATCH,
      DELETE: profileRoute.DELETE,
      CHECK_IN: (await import("@/app/api/check-ins/route")).POST,
      CRAWL: (await import("@/app/api/crawls/route")).POST,
    };
    const store = await import("@/lib/profileStore");
    expect(store.profileStore()).toBe(store.supabaseProfileStore);
    profiles = store.supabaseProfileStore;

    // A live account that renamed: its previous handle is now a retired alias
    // with no profiles row. A departed account: its row is a tombstone.
    sql(`insert into auth.users(id) values ('${RENAMED_USER}'), ('${DEPARTED_USER}'), ('${FRESH_USER}');`);
    expect(sql(`select (public.claim_pubmaxx_handle('${RENAMED_USER}', '${RETIRED_ALIAS}'))->>'ok';`)).toBe("true");
    expect(sql(`select (public.rename_pubmaxx_handle('${RENAMED_USER}', '${CURRENT_HANDLE}'))->>'ok';`)).toBe("true");
    expect(sql(`select (public.claim_pubmaxx_handle('${DEPARTED_USER}', '${DEPARTED}'))->>'ok';`)).toBe("true");
    sql(`update public.profiles set display_name = 'Departed', bio = 'Left PUBMAXX'
      where handle = '${DEPARTED}';
      delete from auth.users where id = '${DEPARTED_USER}';`);
    expect(sql(`select count(*) from public.profiles where handle = '${RETIRED_ALIAS}';`)).toBe("0");
    expect(sql(`select count(*) from public.profile_handle_aliases where handle = '${RETIRED_ALIAS}';`)).toBe("1");
    expect(departedRow()).toBe("Departed|Left PUBMAXX|true|true");
  } catch (error) {
    await session.stop();
    session = null;
    throw error;
  }
}, 600_000);

afterAll(async () => {
  try { await session?.stop(); } finally {
    session = null;
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  }
});

describe.skipIf(skipReason !== null)("the anonymous demo lane on a reserved handle", () => {
  it("answers 404 to a PATCH of a deleted account's profile and changes nothing", async () => {
    const response = await routes.PATCH(
      anonymous(`http://localhost/api/profiles/${DEPARTED}`, "PATCH", {
        displayName: "Squatter Name",
        bio: "planted on a departed account",
      }),
      handleParams(DEPARTED),
    );
    expect(response.status).toBe(404);
    expect(departedRow()).toBe("Departed|Left PUBMAXX|true|true");
  });

  it("answers 404 to a DELETE of a deleted account's profile and changes nothing", async () => {
    const response = await routes.DELETE(
      anonymous(`http://localhost/api/profiles/${DEPARTED}`, "DELETE"),
      handleParams(DEPARTED),
    );
    expect(response.status).toBe(404);
    expect(departedRow()).toBe("Departed|Left PUBMAXX|true|true");
  });

  it("answers 404 to a check-in under a deleted account's handle", async () => {
    const response = await routes.CHECK_IN(
      anonymous("http://localhost/api/check-ins", "POST", { handle: DEPARTED, venueId: PUB }),
    );
    expect(response.status).toBe(404);
    expect(sql(`select count(*) from public.check_ins where handle = '${DEPARTED}';`)).toBe("0");
  });

  it.each([
    [DEPARTED, 404],
    [RETIRED_ALIAS, 409],
  ])("refuses a crawl story authored as %s", async (handle, status) => {
    const before = sql("select count(*) from public.crawl_stories;");
    const response = await routes.CRAWL(
      anonymous("http://localhost/api/crawls", "POST", {
        title: "A reserved name",
        stops: [{ venueId: PUB }],
        authorHandle: handle,
      }),
    );
    expect(response.status).toBe(status);
    expect(sql("select count(*) from public.crawl_stories;")).toBe(before);
  });

  it("refuses the store writes a gate could be bypassed into", async () => {
    expect(await profiles.update(DEPARTED, { displayName: "Squatter Name" })).toBeNull();
    expect(await profiles.softDeleteForCaller(DEPARTED, null)).toEqual({ status: "not-found" });
    expect(departedRow()).toBe("Departed|Left PUBMAXX|true|true");
    await expect(profiles.ensure(RETIRED_ALIAS)).rejects.toThrow(/not available/);
    expect(sql(`select count(*) from public.profiles where handle = '${RETIRED_ALIAS}';`)).toBe("0");
  });
});

describe.skipIf(skipReason !== null)("0200 reserves an alias against every other profile row", () => {
  it("refuses writes while a pre-migration alias collision still exists", async () => {
    sql(`insert into public.profiles(handle) values ('${RETIRED_ALIAS}');`);
    db().sqlFile(FORWARD);
    const beforeName = sql(`select coalesce(display_name, '') from public.profiles where handle = '${RETIRED_ALIAS}';`);
    const before = sql("select count(*) from public.crawl_stories;");
    const responses = [
      await routes.PATCH(
        anonymous(`http://localhost/api/profiles/${RETIRED_ALIAS}`, "PATCH", { displayName: "Squatter" }),
        handleParams(RETIRED_ALIAS),
      ),
      await routes.DELETE(
        anonymous(`http://localhost/api/profiles/${RETIRED_ALIAS}`, "DELETE"),
        handleParams(RETIRED_ALIAS),
      ),
      await routes.CRAWL(anonymous("http://localhost/api/crawls", "POST", {
        title: "A reserved name", stops: [{ venueId: PUB }], authorHandle: RETIRED_ALIAS,
      })),
    ];
    expect(responses.map((response) => response.status)).toEqual([409, 409, 409]);
    await expect(profiles.ensure(RETIRED_ALIAS)).rejects.toThrow(/not available/);
    expect(sql(`select count(*) from public.profiles where handle = '${RETIRED_ALIAS}';`)).toBe("1");
    expect(sql(`select coalesce(display_name, '') from public.profiles where handle = '${RETIRED_ALIAS}';`)).toBe(beforeName);
    expect(sql("select count(*) from public.crawl_stories;")).toBe(before);
    sql(`delete from public.profiles where handle = '${RETIRED_ALIAS}';`);
  });

  it("refuses an insert or a handle change onto another profile's alias", () => {
    expect(refusal(`insert into public.profiles(handle) values ('${RETIRED_ALIAS}');`))
      .toMatch(/held by another profile/);
    expect(refusal(`insert into public.profiles(handle) values ('${CURRENT_HANDLE.toUpperCase()}');`))
      .toMatch(/held by another profile|duplicate key/);
    sql("insert into public.profiles(handle) values ('unowned_demo_row');");
    expect(refusal(`update public.profiles set handle = '${RETIRED_ALIAS}' where handle = 'unowned_demo_row';`))
      .toMatch(/held by another profile/);
  });

  it("keeps the claim and rename doors and the deletion trigger working", () => {
    expect(sql(`select (public.claim_pubmaxx_handle('${FRESH_USER}', '${RETIRED_ALIAS}'))->>'code';`)).toBe("taken");
    expect(sql(`select (public.claim_pubmaxx_handle('${FRESH_USER}', 'fresh_after_0200'))->>'ok';`)).toBe("true");
    expect(sql(`select (public.rename_pubmaxx_handle('${FRESH_USER}', 'fresh_renamed_0200'))->>'ok';`)).toBe("true");
    expect(sql("select handle from public.profiles where handle like 'fresh_%';")).toBe("fresh_renamed_0200");
    sql(`delete from auth.users where id = '${FRESH_USER}';`);
    expect(sql("select tombstoned_at is not null from public.profiles where handle = 'fresh_renamed_0200';")).toBe("true");
  });

  it("rolls back to the old behaviour", () => {
    db().sqlFile(ROLLBACK);
    sql(`insert into public.profiles(handle) values ('${RETIRED_ALIAS}');`);
    sql(`delete from public.profiles where handle = '${RETIRED_ALIAS}';`);
  });
});
