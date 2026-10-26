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

const HOST = "a1970000-0000-4000-8000-000000000001";
const GUEST = "b1970000-0000-4000-8000-000000000002";
const HOST_PROFILE = "a1970000-0000-4000-8000-000000000003";
const GUEST_PROFILE = "b1970000-0000-4000-8000-000000000004";
const HANDLE = "departing_story_guest";
const DISPLAY_NAME = "Carla Guest";
const skipReason = postgresSkipReason();
const root = process.cwd();
const nativeFetch = globalThis.fetch;
let session: Session | null = null;
let store: typeof import("@/lib/nightMemoryStore");

function sql(statement: string): string {
  if (!session) throw new Error("Story deletion proof has no database session");
  const result = session.sql(statement);
  if (!result.ok) throw new Error(result.err);
  return result.out;
}

beforeAll(async () => {
  if (skipReason) return;
  // @ts-expect-error The existing executable session harness has no declarations.
  const harness = await import("../scripts/rls/session-harness.mjs") as {
    startRlsSession(): Promise<Session>;
  };
  session = await harness.startRlsSession();
  try {
    const migrations = join(root, "supabase/migrations");
    for (const name of readdirSync(migrations)
      .filter((name) => name.endsWith(".sql") && name > "20260806035204_0070_v1_release_security.sql")
      .sort()) {
      session.sqlFile(join(migrations, name));
    }
    await session.reloadPostgrestSchema();
    vi.stubEnv("SUPABASE_URL", session.restBaseUrl);
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", session.serviceRoleKey);
    vi.stubEnv("SUPABASE_STORAGE_BUCKET", "pint-drops");
    vi.stubEnv("VERCEL_ENV", "preview");
    const origin = new URL(session.restBaseUrl).origin;
    // This only adapts the existing Supabase URL prefix to local PostgREST.
    // The real client, queries, rows, cascades and public reader remain active.
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      const requested = input instanceof Request ? input.url : String(input);
      if (new URL(requested).origin !== origin) throw new Error("Story proof forbids external HTTP");
      const local = requested.replace(`${session!.restBaseUrl}/rest/v1`, session!.restBaseUrl);
      return nativeFetch(input instanceof Request ? new Request(local, input) : local, init);
    });
    vi.resetModules();
    store = await import("@/lib/nightMemoryStore");
    sql(`insert into auth.users(id) values ('${HOST}'), ('${GUEST}');
      insert into public.profiles(id,user_id,handle,display_name) values
      ('${HOST_PROFILE}','${HOST}','remaining_story_host','Remaining Host'),
      ('${GUEST_PROFILE}','${GUEST}','${HANDLE}','${DISPLAY_NAME}');`);
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

describe.skipIf(skipReason !== null)("account deletion and published Story redaction", () => {
  it("removes the deleted contributor's identity from the reachable public recap read", async () => {
    const memory = await store.createNightMemory(HOST, { title: "Disposable shared night" });
    expect(memory).not.toBeNull();
    if (!memory) throw new Error("Memory creation failed");
    const moment = await store.addNightMoment(HOST, memory.id, {
      kind: "quote", caption: `${DISPLAY_NAME} led the crawl.`,
    });
    expect(moment).not.toBeNull();
    if (!moment) throw new Error("Moment creation failed");
    const story = await store.createNightStory(HOST, {
      memoryId: memory.id, title: `Night with @${HANDLE}`, summary: `${DISPLAY_NAME} chose the route with Remaining Host.`,
    });
    expect(story).not.toBeNull();
    if (!story) throw new Error("Story creation failed");
    expect(await store.upsertStoryContributor(HOST, story.id, { handle: HANDLE, role: "contributor" }))
      .toMatchObject({ profileId: GUEST, status: "invited" });
    expect(await store.acceptStoryContribution(GUEST, story.id)).toMatchObject({ status: "accepted" });
    const proposal = await store.proposeNightStoryPublication(HOST, story.id, {
      visibility: "public", momentIds: [moment.id],
    });
    expect(proposal).not.toBeNull();
    if (!proposal) throw new Error("Publication proposal failed");
    expect(await store.confirmNightStoryPublication(HOST, story.id, {
      proposalId: proposal.proposal.id, confirmationToken: proposal.confirmationToken,
    })).toMatchObject({ status: "published", visibility: "public" });

    const before = await store.readPublishedRecapSource(story.id);
    expect(before.status).toBe("found");
    if (before.status !== "found") throw new Error("Published recap is not reachable");
    expect(before.source.story.title).toBe(`Night with @${HANDLE}`);
    expect(before.source.moments.map((item) => item.id)).toEqual([moment.id]);
    expect(before.source.moments[0]?.caption).toBe(`${DISPLAY_NAME} led the crawl.`);

    // A real host role change resets acceptance. Declining then retains only a
    // removed row, so deletion must not rely on current status or joined_at.
    expect(await store.upsertStoryContributor(HOST, story.id, { handle: HANDLE, role: "editor" }))
      .toMatchObject({ profileId: GUEST, status: "invited", joinedAt: null });
    expect(await store.declineStoryContributionResult(GUEST, story.id)).toEqual({ ok: true, value: true });
    expect(sql(`select status from public.night_story_contributors
      where story_id='${story.id}' and profile_id='${GUEST}'`)).toBe("removed");

    // This is the auth.users DELETE GoTrue performs, not GoTrue HTTP or JWT proof.
    sql(`delete from auth.users where id='${GUEST}'`);
    expect(sql(`select count(*) from auth.users where id='${GUEST}'`)).toBe("0");
    expect(sql(`select (tombstoned_at is not null)::text from public.profiles where id='${GUEST_PROFILE}'`))
      .toBe("true");
    expect(sql(`select count(*) from auth.users where id='${HOST}'`)).toBe("1");
    expect(sql(`select (night_story_ids @> array['${story.id}'::uuid])::text
      from public.account_retention_ledger where account_user_id='${GUEST}'`)).toBe("true");
    expect(sql(`select retired_display_name from public.account_retention_ledger
      where account_user_id='${GUEST}'`)).toBe(DISPLAY_NAME);
    const departureRows = sql(`select json_build_object(
      'contributors', (select count(*) from public.night_story_contributors where profile_id='${GUEST}'),
      'withdrawn', (select count(*) from public.night_story_contributors where story_id='${story.id}' and status='withdrawn')
    )::text`);

    // This is the actual public-emission gate used by /recap/[storyId] and its metadata.
    // No departed set, database answer or redaction function is injected.
    const after = await store.readPublishedRecapSource(story.id);
    expect(after.status).toBe("found");
    if (after.status !== "found") throw new Error("Host's published recap disappeared after guest deletion");
    expect(after.source.story.title, `Real database departure state: ${departureRows}`).toBe("Night with a friend");
    expect(after.source.story.summary).toBe("a friend chose the route with Remaining Host.");
    expect(after.source.moments.map((item) => item.id)).toEqual([moment.id]);
    expect(after.source.moments[0]?.caption).toBe("a friend led the crawl.");
    expect(JSON.stringify(after.source)).not.toContain(HANDLE);
    expect(JSON.stringify(after.source)).not.toContain(DISPLAY_NAME);
    const publicStory = await store.readNightStory(story.id, null);
    expect(publicStory.status).toBe("found");
    if (publicStory.status !== "found") throw new Error("Public Story disappeared after guest deletion");
    expect(publicStory.story.title).toBe("Night with a friend");
    expect(publicStory.story.summary).toBe("a friend chose the route with Remaining Host.");
    expect(JSON.stringify(publicStory)).not.toContain(HANDLE);
    expect(JSON.stringify(publicStory)).not.toContain(DISPLAY_NAME);
    // Redaction changes the public projection, never the host's source content.
    expect(sql(`select title from public.night_stories where id='${story.id}'`))
      .toBe(`Night with @${HANDLE}`);

    // New retained identity columns stay behind the existing service-only door.
    for (const role of ["anon", "authenticated"]) {
      expect(session!.sql(`set role ${role}; select retired_display_name, retired_handles,
        night_story_ids from public.account_retention_ledger`).ok).toBe(false);
    }
    session!.sqlFile(join(root, "supabase/migrations/rollback/20261026123000_0198_story_departure_retention_rollback.sql"));
    await session!.reloadPostgrestSchema();
    expect(sql(`select status || '/' || visibility || '/' || (published_at is null)::text
      from public.night_stories where id='${story.id}'`)).toBe("draft/private/true");
    expect(sql(`select title from public.night_stories where id='${story.id}'`)).toBe(`Night with @${HANDLE}`);
    expect(sql(`select count(*) from public.night_moments where id='${moment.id}'`)).toBe("1");
    // Both old and new public readers refuse a private Story before redaction.
    expect(await store.readPublishedRecapSource(story.id)).toEqual({ status: "absent" });
    expect(await store.readNightStory(story.id, null)).toEqual({ status: "absent" });

  });
});
