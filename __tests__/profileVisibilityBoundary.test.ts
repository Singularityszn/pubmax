// THE ONE SEAM THAT DECIDES WHAT A READER MAY HAVE OF A PRIVATE PROFILE.
//
// Every case here is one of the two rules the seam copies from
// `resolvePlanProjection`: it reads no environment variable, and it fails
// CLOSED. The last test reads this module's own source, because D01 was not a
// logic bug in the Plan boundary: it was a flag CI set and no deployment did.

import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import type { AccountVisibility } from "@/lib/accountVisibility";
import { resolveProfileProjection } from "@/lib/profileVisibilityBoundary.server";
import type { ProfileRecord } from "@/lib/profileStore";

const OWNER_USER_ID = "owner-user-id";
const MATE_USER_ID = "mate-user-id";
const STRANGER_USER_ID = "stranger-user-id";

function record(visibility: AccountVisibility): ProfileRecord {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    handle: "night_person",
    userId: OWNER_USER_ID,
    displayName: "Night Person",
    homeCity: "Camden",
    bio: "Withheld-bio-sentence",
    favouriteDrink: "Withheld-drink",
    interests: "Withheld-interests",
    workplace: "Withheld-workplace",
    foundingMemberNumber: 7,
    visibility,
    createdAt: "2026-06-01T12:00:00.000Z",
    updatedAt: "2026-09-08T09:00:00.000Z",
  };
}

/** The follow graph as this suite needs it: mate_handle and night_person are mates. */
const MUTUAL_EDGES = new Set(["mate_handle>night_person", "night_person>mate_handle"]);
/** One way only: follower_handle follows night_person and is not followed back. */
const ONE_WAY_EDGES = new Set(["follower_handle>night_person"]);

function seams(options: {
  visibility: AccountVisibility;
  callerUserId?: string | null;
  edges?: ReadonlySet<string>;
  verifyThrows?: boolean;
  handleLookupThrows?: boolean;
  followThrows?: boolean;
  profile?: ProfileRecord | null;
}) {
  const handleByUserId: Record<string, string> = {
    [OWNER_USER_ID]: "night_person",
    [MATE_USER_ID]: "mate_handle",
    [STRANGER_USER_ID]: "follower_handle",
  };
  const verifyCaller = vi.fn(async () => {
    if (options.verifyThrows) throw new Error("auth server unavailable");
    return options.callerUserId ?? null;
  });
  const getHandleByUserId = vi.fn(async (userId: string) => {
    if (options.handleLookupThrows) throw new Error("profile store unavailable");
    return handleByUserId[userId] ?? null;
  });
  const isFollowing = vi.fn(async (follower: string, followee: string) => {
    if (options.followThrows) throw new Error("follow store unavailable");
    return (options.edges ?? new Set<string>()).has(`${follower}>${followee}`);
  });
  const readCoverUrls = vi.fn(async () => ["/api/cover/gen-1"] as readonly string[]);
  return { verifyCaller, getHandleByUserId, isFollowing, readCoverUrls };
}

async function resolve(options: Parameters<typeof seams>[0]) {
  const s = seams(options);
  const projection = await resolveProfileProjection({
    request: new Request("http://localhost/api/profiles/night_person"),
    profile:
      options.profile === undefined ? record(options.visibility) : options.profile,
    readCoverUrls: s.readCoverUrls,
    verifyCaller: s.verifyCaller,
    profiles: { getHandleByUserId: s.getHandleByUserId },
    follows: { isFollowing: s.isFollowing },
  });
  return { projection, ...s };
}

describe("resolveProfileProjection \u2014 a public account is unchanged", () => {
  it("answers the full card to a stranger", async () => {
    const { projection } = await resolve({ visibility: "public" });
    expect(projection.projection).toBe("full");
    expect(projection.profile?.bio).toBe("Withheld-bio-sentence");
  });

  // The cheap synchronous answer is taken FIRST, so the ordinary read of the
  // ordinary account adds no bearer verification and no follow read at all.
  it("verifies no bearer and reads no follow edge", async () => {
    const { verifyCaller, getHandleByUserId, isFollowing } = await resolve({
      visibility: "public",
      callerUserId: STRANGER_USER_ID,
    });
    expect(verifyCaller).not.toHaveBeenCalled();
    expect(getHandleByUserId).not.toHaveBeenCalled();
    expect(isFollowing).not.toHaveBeenCalled();
  });
});

describe("resolveProfileProjection \u2014 a private account", () => {
  it("answers the full card to its owner", async () => {
    const { projection } = await resolve({
      visibility: "private",
      callerUserId: OWNER_USER_ID,
    });
    expect(projection.projection).toBe("full");
    expect(projection.profile?.bio).toBe("Withheld-bio-sentence");
  });

  it("answers the full card to a mate", async () => {
    const { projection } = await resolve({
      visibility: "private",
      callerUserId: MATE_USER_ID,
      edges: MUTUAL_EDGES,
    });
    expect(projection.projection).toBe("full");
    expect(projection.profile?.homeCity).toBe("Camden");
  });

  // A lot is MUTUAL, so a one-way follower is a stranger here. Anything else
  // would make following somebody enough to read them, which is the whole thing
  // a private account is asking us not to do.
  it("answers the limited card to a one-way follower", async () => {
    const { projection } = await resolve({
      visibility: "private",
      callerUserId: STRANGER_USER_ID,
      edges: ONE_WAY_EDGES,
    });
    expect(projection.projection).toBe("limited");
  });

  it("answers the limited card to a signed-in account with no relationship", async () => {
    const { projection } = await resolve({
      visibility: "private",
      callerUserId: STRANGER_USER_ID,
    });
    expect(projection.projection).toBe("limited");
  });

  it("answers the limited card with no bearer at all", async () => {
    const { projection } = await resolve({ visibility: "private" });
    expect(projection.projection).toBe("limited");
  });

  it("withholds every owner-authored field over the whole serialized body", async () => {
    const { projection } = await resolve({ visibility: "private" });
    const raw = JSON.stringify(projection);
    for (const leak of [
      "Withheld-bio-sentence",
      "Withheld-drink",
      "Withheld-interests",
      "Withheld-workplace",
      "Camden",
      "/api/cover/",
    ]) {
      expect(raw).not.toContain(leak);
    }
    expect(raw).toContain("night_person");
  });

  // A limited card carries no backdrop, so the rotation is never read for one.
  it("does not spend the cover rotation read on the limited lane", async () => {
    const { readCoverUrls } = await resolve({ visibility: "private" });
    expect(readCoverUrls).not.toHaveBeenCalled();
  });

  it("spends the cover rotation read on the full lane", async () => {
    const { readCoverUrls, projection } = await resolve({
      visibility: "private",
      callerUserId: OWNER_USER_ID,
    });
    expect(readCoverUrls).toHaveBeenCalledTimes(1);
    expect(projection.profile?.coverUrls).toEqual(["/api/cover/gen-1"]);
  });
});

describe("resolveProfileProjection \u2014 it fails closed", () => {
  it("takes a bearer verification that THREW as a stranger", async () => {
    const { projection } = await resolve({
      visibility: "private",
      callerUserId: OWNER_USER_ID,
      verifyThrows: true,
    });
    expect(projection.projection).toBe("limited");
  });

  it("takes a handle lookup that THREW as a stranger", async () => {
    const { projection } = await resolve({
      visibility: "private",
      callerUserId: MATE_USER_ID,
      edges: MUTUAL_EDGES,
      handleLookupThrows: true,
    });
    expect(projection.projection).toBe("limited");
  });

  it("takes a follow read that THREW as a stranger", async () => {
    const { projection } = await resolve({
      visibility: "private",
      callerUserId: MATE_USER_ID,
      edges: MUTUAL_EDGES,
      followThrows: true,
    });
    expect(projection.projection).toBe("limited");
  });

  it("takes an account that owns no handle as a stranger", async () => {
    const { projection } = await resolve({
      visibility: "private",
      callerUserId: "account-with-no-handle",
      edges: MUTUAL_EDGES,
    });
    expect(projection.projection).toBe("limited");
  });

  it("reads ownership off the stored column, never off the handle text", async () => {
    // The same handle, but the row names nobody: a caller cannot become the owner
    // of an unowned row by holding a token, and no handle string is evidence.
    const unowned: ProfileRecord = { ...record("private"), userId: undefined };
    const { projection } = await resolve({
      visibility: "private",
      callerUserId: OWNER_USER_ID,
      profile: unowned,
    });
    expect(projection.projection).toBe("limited");
  });

  it("answers a full null card for a handle with no stored row", async () => {
    const { projection } = await resolve({ visibility: "private", profile: null });
    expect(projection.projection).toBe("full");
    expect(projection.profile).toBeNull();
  });
});

// D01's lesson, applied before it can happen here: the member projection of a
// Plan sat behind a rollout flag, so production answered the preview to every
// reader while CI proved a product nobody had.
describe("resolveProfileProjection \u2014 no deployment may decide this", () => {
  it("reads no environment variable", () => {
    const source = readFileSync(
      path.join(process.cwd(), "lib/profileVisibilityBoundary.server.ts"),
      "utf8",
    );
    expect(source).not.toContain("process.env");
  });
});

describe("the page holds no card across an account or handle boundary", () => {
  // The seam decides correctly on every read, and the page can still PRINT the
  // previous answer while the next one is in flight: `stored` and `projection`
  // are React state, they survive a sign-in, a sign-out and a walk to another
  // profile, and `getAccessToken()` plus the round trip are awaited before
  // either moves. So a device that had just read a private account as a MATE
  // kept that full card on screen for the new reader. `lib/surfaceDataCache.ts`
  // drops its whole store at an account boundary for exactly this reason; the
  // state beside it has to go the same way.
  //
  // A source fence rather than a mount, because this is the 1,400-line page
  // client.
  const pageSource = readFileSync(
    path.join(process.cwd(), "app/u/[handle]/ProfilePageClient.tsx"),
    "utf8",
  );

  it("drops the stored card, the projection and the read state on the boundary", () => {
    const boundary = pageSource.slice(
      pageSource.indexOf("if (followStateKey === followKey) return;"),
    );
    expect(boundary).not.toBe("");
    const body = boundary.slice(0, boundary.indexOf("}, [followKey, followStateKey]);"));

    expect(body, "the card belongs to the account that read it").toContain(
      "setStored(null)",
    );
    expect(body, "a full card may not outlive the read that earned it").toContain(
      'setProjection("full")',
    );
    expect(
      body,
      "a claim may not be offered off an answer about somebody else",
    ).toContain('setPublicRead("asking")');
  });

  it("keys that boundary on the account AND the handle", () => {
    expect(pageSource).toContain(
      "const followKey = `${accountRevision}:${routeHandle}`;",
    );
  });
});
