// THE LONDON LANE ON THE DURABLE STORE. Only PostgREST is a fixture: the
// Supabase client, the post store, the profile store and the withdrawal seam
// are real. Two things are proved here that the keyless route test cannot see:
//
//   1. The lane asks the signed-in Across-town read (`read_social_post_feed`)
//      for NOBODY, a SQL null viewer, never a profile id.
//   2. Whatever that read returns, the lane's own rule (`keepLondonLane`) is
//      applied again on top, so a row the SQL should never have returned (a
//      hidden or removed post, a friends post) still cannot reach a stranger.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { __resetMemoryProfileWithdrawals } from "@/lib/accountPublicAccess.server";
import { supabaseSocialPostStore } from "@/lib/socialPostStore";

const PUB = "a0000000-0000-4000-8000-000000000001";
const SHY = "a0000000-0000-4000-8000-000000000002";
const GONE = "a0000000-0000-4000-8000-000000000003";
const GHOST = "a0000000-0000-4000-8000-000000000004";

const state = {
  feedBodies: [] as Array<Record<string, unknown>>,
  feedRows: [] as Array<Record<string, unknown>>,
  profilesFail: false,
  paths: [] as string[],
};

const VISIBILITY: Record<string, string> = { [PUB]: "public", [SHY]: "private", [GONE]: "public" };
const HANDLES: Record<string, string> = { [PUB]: "lane_pub", [SHY]: "lane_shy", [GONE]: "lane_gone", [GHOST]: "lane_ghost" };

let sequence = 0;
function row(body: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  sequence += 1;
  const author = (overrides.author_profile_id as string | undefined) ?? PUB;
  return {
    id: `b0000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
    author_profile_id: author,
    author_handle: HANDLES[author],
    kind: "standard",
    visibility: "public",
    status: "visible",
    body,
    area_slug: "camden",
    venue_id: null,
    hashtags: [],
    comment_policy: "open",
    photo_media_id: null,
    photo_alt_text: null,
    author_name_hidden: false,
    moderation_state: "approved",
    revision: 0,
    mutation_version: 0,
    created_at: `2026-11-01T20:${String(60 - sequence).padStart(2, "0")}:00.000Z`,
    updated_at: "2026-11-01T20:00:00.000Z",
    ...overrides,
  };
}

const fixtureFetch: typeof fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.hostname !== "london-lane.test") throw new Error("Unexpected fixture host.");
  state.paths.push(url.pathname);
  const json = (body: unknown, status = 200) => Response.json(body, { status });
  if (url.pathname === "/rest/v1/rpc/read_social_post_feed") {
    state.feedBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return json(state.feedRows);
  }
  if (url.pathname === "/rest/v1/profiles") {
    if (state.profilesFail) return json({ message: "profiles unavailable" }, 500);
    const ids = (url.searchParams.get("id") ?? "").replace(/^in\.\(|\)$/g, "").split(",");
    return json(ids.filter((id) => id in VISIBILITY).map((id) => ({ id, visibility: VISIBILITY[id] })));
  }
  if (url.pathname === "/rest/v1/rpc/public_withdrawn_profiles") {
    return json([{ profile_id: GONE, handle: "lane_gone" }]);
  }
  throw new Error(`Unexpected fixture path: ${url.pathname}`);
};

beforeEach(() => {
  state.feedBodies = [];
  state.feedRows = [];
  state.profilesFail = false;
  state.paths = [];
  __resetMemoryProfileWithdrawals();
  vi.stubEnv("SUPABASE_URL", "https://london-lane.test");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "fixture-key");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://london-lane.test");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "fixture-key");
  vi.stubGlobal("fetch", fixtureFetch);
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("supabaseSocialPostStore.londonLane", () => {
  it("reads the Across-town lane for nobody", async () => {
    state.feedRows = [row("london public")];
    await supabaseSocialPostStore.londonLane({ limit: 20 });
    expect(state.feedBodies[0]).toEqual({
      p_viewer_profile_id: null,
      p_lane: "discover",
      p_area_slug: null,
      p_before_created_at: null,
      p_before_id: null,
      p_limit: 51,
    });
  });

  it("applies the lane's own rule on top of whatever the read returns", async () => {
    state.feedRows = [
      row("london public", { venue_id: "venue-lamb" }),
      row("hidden by a moderator", { status: "hidden" }),
      row("removed by its author", { status: "removed" }),
      row("held for review", { moderation_state: "needs_review" }),
      row("still pending", { moderation_state: "pending" }),
      row("mutuals only", { visibility: "friends" }),
      row("only me", { visibility: "private" }),
      row("in Manchester", { area_slug: "manchester-city-centre" }),
      row("no area", { area_slug: null }),
      row("private account", { author_profile_id: SHY }),
      row("withdrawn author", { author_profile_id: GONE }),
      row("withdrawn hidden name", { author_profile_id: GONE, author_name_hidden: true }),
      row("no profile row", { author_profile_id: GHOST }),
    ];
    const page = await supabaseSocialPostStore.londonLane({ limit: 20 });
    expect(page.posts.map((post) => post.body)).toEqual(["london public"]);
    expect(page.posts[0]).toMatchObject({
      venueId: null,
      venueName: null,
      venueProjected: false,
      ownedByViewer: false,
      visibility: "public",
    });
    expect(page.nextCursor).toBeNull();
  });

  it("fails closed when the account choice cannot be read", async () => {
    state.feedRows = [row("london public")];
    state.profilesFail = true;
    await expect(supabaseSocialPostStore.londonLane({ limit: 20 })).rejects.toThrow();
  });

  it("refuses a cursor minted for a signed-in reader's lane", async () => {
    state.feedRows = [row("one"), row("two"), row("three")];
    const page = await supabaseSocialPostStore.feed(
      { accountId: "account", profileId: PUB, handle: "lane_pub" },
      { lane: "discover", limit: 1 },
    );
    expect(page.nextCursor).toEqual(expect.any(String));
    await expect(supabaseSocialPostStore.londonLane({ cursor: page.nextCursor, limit: 1 }))
      .rejects.toMatchObject({ code: "INVALID_CURSOR" });
  });
});
