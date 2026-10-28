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

type Published = { storyId: string; momentId: string };

async function publishHostStory(title: string, summary: string, caption: string, guest: boolean): Promise<Published> {
  const memory = await store.createNightMemory(HOST, { title: `Disposable shared night: ${title}` });
  if (!memory) throw new Error("Memory creation failed");
  const moment = await store.addNightMoment(HOST, memory.id, { kind: "quote", caption });
  if (!moment) throw new Error("Moment creation failed");
  const story = await store.createNightStory(HOST, { memoryId: memory.id, title, summary });
  if (!story) throw new Error("Story creation failed");
  if (guest) {
    expect(await store.upsertStoryContributor(HOST, story.id, { handle: HANDLE, role: "contributor" }))
      .toMatchObject({ profileId: GUEST, status: "invited" });
    expect(await store.acceptStoryContribution(GUEST, story.id)).toMatchObject({ status: "accepted" });
  }
  const proposal = await store.proposeNightStoryPublication(HOST, story.id, {
    visibility: "public", momentIds: [moment.id],
  });
  if (!proposal) throw new Error("Publication proposal failed");
  expect(await store.confirmNightStoryPublication(HOST, story.id, {
    proposalId: proposal.proposal.id, confirmationToken: proposal.confirmationToken,
  })).toMatchObject({ status: "published", visibility: "public" });
  return { storyId: story.id, momentId: moment.id };
}

async function expectRedacted({ storyId, momentId }: Published): Promise<void> {
  // This is the actual public-emission gate used by /recap/[storyId] and its metadata.
  // No departed set, database answer or redaction function is injected.
  const after = await store.readPublishedRecapSource(storyId);
  expect(after.status).toBe("found");
  if (after.status !== "found") throw new Error("Host's published recap disappeared after guest deletion");
  expect(after.source.story.title).toBe("Night with a friend");
  expect(after.source.story.summary).toBe("a friend chose the route with Remaining Host.");
  expect(after.source.moments.map((item) => item.id)).toEqual([momentId]);
  expect(after.source.moments[0]?.caption).toBe("a friend led the crawl.");
  expect(JSON.stringify(after.source)).not.toContain(HANDLE);
  expect(JSON.stringify(after.source)).not.toContain(DISPLAY_NAME);
  const publicStory = await store.readNightStory(storyId, null);
  expect(publicStory.status).toBe("found");
  if (publicStory.status !== "found") throw new Error("Public Story disappeared after guest deletion");
  expect(publicStory.story.title).toBe("Night with a friend");
  expect(publicStory.story.summary).toBe("a friend chose the route with Remaining Host.");
  expect(JSON.stringify(publicStory)).not.toContain(HANDLE);
  expect(JSON.stringify(publicStory)).not.toContain(DISPLAY_NAME);
  // Redaction changes the public projection, never the host's source content.
  expect(sql(`select title from public.night_stories where id='${storyId}'`))
    .toBe(`Night with @${HANDLE}`);
}

describe.skipIf(skipReason !== null)("account deletion and published Story redaction", () => {
  it("removes the deleted contributor's identity from the reachable public recap read", async () => {
    const title = `Night with @${HANDLE}`;
    const summary = `${DISPLAY_NAME} chose the route with Remaining Host.`;
    const caption = `${DISPLAY_NAME} led the crawl.`;
    // The audit's case: the guest is still an accepted contributor when the account goes.
    const accepted = await publishHostStory(title, summary, caption, true);
    // A real host role change resets acceptance. Declining then retains only a
    // removed row, so deletion must not rely on current status or joined_at.
    const declined = await publishHostStory(title, summary, caption, true);
    // A Story the guest was never linked to keeps its words whatever happens.
    const unrelated = await publishHostStory("Host-only night", "Remaining Host chose the route.", "Quiet pint.", false);

    const before = await store.readPublishedRecapSource(accepted.storyId);
    expect(before.status).toBe("found");
    if (before.status !== "found") throw new Error("Published recap is not reachable");
    expect(before.source.story.title).toBe(title);
    expect(before.source.moments.map((item) => item.id)).toEqual([accepted.momentId]);
    expect(before.source.moments[0]?.caption).toBe(caption);

    expect(await store.upsertStoryContributor(HOST, declined.storyId, { handle: HANDLE, role: "editor" }))
      .toMatchObject({ profileId: GUEST, status: "invited", joinedAt: null });
    expect(await store.declineStoryContributionResult(GUEST, declined.storyId)).toEqual({ ok: true, value: true });
    expect(sql(`select status from public.night_story_contributors
      where story_id='${declined.storyId}' and profile_id='${GUEST}'`)).toBe("removed");
    expect(sql(`select status from public.night_story_contributors
      where story_id='${accepted.storyId}' and profile_id='${GUEST}'`)).toBe("accepted");

    // This is the auth.users DELETE GoTrue performs, not GoTrue HTTP or JWT proof.
    sql(`delete from auth.users where id='${GUEST}'`);
    expect(sql(`select count(*) from auth.users where id='${GUEST}'`)).toBe("0");
    expect(sql(`select (tombstoned_at is not null)::text from public.profiles where id='${GUEST_PROFILE}'`))
      .toBe("true");
    expect(sql(`select count(*) from auth.users where id='${HOST}'`)).toBe("1");
    // The cascade still removes the join rows; the redaction must not need them.
    expect(sql(`select count(*) from public.night_story_contributors where profile_id='${GUEST}'`)).toBe("0");

    await expectRedacted(accepted);
    await expectRedacted(declined);
    const untouched = await store.readPublishedRecapSource(unrelated.storyId);
    expect(untouched.status).toBe("found");
    if (untouched.status !== "found") throw new Error("Unrelated recap disappeared");
    expect(untouched.source.story.title).toBe("Host-only night");

    expect(sql(`select (night_story_ids @> array['${accepted.storyId}'::uuid, '${declined.storyId}'::uuid]
        and not night_story_ids @> array['${unrelated.storyId}'::uuid])::text
      from public.account_retention_ledger where account_user_id='${GUEST}'`)).toBe("true");
    expect(sql(`select retired_display_name from public.account_retention_ledger
      where account_user_id='${GUEST}'`)).toBe(DISPLAY_NAME);

    // New retained identity columns stay behind the existing service-only door.
    for (const role of ["anon", "authenticated"]) {
      expect(session!.sql(`set role ${role}; select retired_display_name, retired_handles,
        night_story_ids from public.account_retention_ledger`).ok).toBe(false);
    }
    session!.sqlFile(join(root, "supabase/migrations/rollback/20261026123000_0198_story_departure_retention_rollback.sql"));
    await session!.reloadPostgrestSchema();
    for (const { storyId, momentId } of [accepted, declined]) {
      expect(sql(`select status || '/' || visibility || '/' || (published_at is null)::text
        from public.night_stories where id='${storyId}'`)).toBe("draft/private/true");
      expect(sql(`select title from public.night_stories where id='${storyId}'`)).toBe(title);
      expect(sql(`select count(*) from public.night_moments where id='${momentId}'`)).toBe("1");
      // Both public readers refuse a private Story before redaction.
      expect(await store.readPublishedRecapSource(storyId)).toEqual({ status: "absent" });
      expect(await store.readNightStory(storyId, null)).toEqual({ status: "absent" });
    }
    const afterRollback = await store.readPublishedRecapSource(unrelated.storyId);
    expect(afterRollback.status).toBe("unavailable");
    expect(await store.readNightStory(unrelated.storyId, null)).toEqual({ status: "unavailable" });
  });
});
