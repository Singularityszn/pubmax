// "Is the kitchen still open?" (A1): the write door and the public read. The
// contribution gate and the venue door are the shared seams, doubled here;
// the store is the real process-memory backend.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false, requiresSupabaseStore: () => false };
});

const ALICE = "a1111111-1111-4111-8111-111111111111";
const BOB = "b2222222-2222-4222-8222-222222222222";

type Resolution = import("@/lib/contributionIdentity.server").ContributionIdentityResolution;

const identityState = vi.hoisted(() => ({
  resolution: null as unknown as import("@/lib/contributionIdentity.server").ContributionIdentityResolution,
}));

vi.mock("@/lib/contributionIdentity.server", () => ({
  resolveContributionIdentity: async () => identityState.resolution,
}));

vi.mock("@/lib/venueWriteTarget.server", () => ({
  resolveWritableVenueId: async (venueId: string) =>
    venueId === "venue-crown" ? { ok: true, venueId } : { ok: false, status: 400, error: "Pick a venue from the map." },
}));

vi.mock("@/lib/venueAliases", () => ({
  resolveCanonicalVenueId: async (id: string) => id,
}));

vi.mock("@/lib/profileStore", () => {
  const handleOf = (userId: string) =>
    userId === "a1111111-1111-4111-8111-111111111111" ? "alice" : userId === "b2222222-2222-4222-8222-222222222222" ? "bob" : null;
  return {
    isProfileTombstoned: (profile: { tombstonedAt?: string } | null) => Boolean(profile?.tombstonedAt),
    profileStore: () => ({
      getHandleByUserId: async (userId: string) => handleOf(userId),
      getByUserId: async (userId: string) => {
        const handle = handleOf(userId);
        return handle ? { id: `profile-${handle}`, handle, userId } : null;
      },
    }),
  };
});

import { GET, POST } from "@/app/api/kitchen-reports/route";
import { __resetKitchenReports } from "@/lib/kitchenReportsStore";
import { __resetPintDrops } from "@/lib/pintDrops";

const SIGNED_OUT: Resolution = {
  ok: false,
  httpStatus: 401,
  body: { error: "Sign in to contribute.", code: "sign_in_required" },
} as unknown as Resolution;
const SIGNED_IN_ALICE: Resolution = { ok: true, accountId: ALICE, actor: "profile:alice", handle: "alice" };
const SIGNED_IN_BOB: Resolution = { ok: true, accountId: BOB, actor: "profile:bob", handle: "bob" };

let ipCounter = 0;
function nextIp(): string {
  ipCounter += 1;
  return `198.51.100.${ipCounter % 250}`;
}

function tap(body: unknown): Request {
  return new Request("http://localhost/api/kitchen-reports", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": nextIp() },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function read(venueId: string): Request {
  return new Request(`http://localhost/api/kitchen-reports?venueId=${venueId}`, {
    headers: { "x-forwarded-for": nextIp() },
  });
}

beforeEach(() => {
  __resetKitchenReports();
  __resetPintDrops();
  identityState.resolution = SIGNED_IN_ALICE;
});

describe("POST /api/kitchen-reports", () => {
  it("answers 401 to a signed-out tap and stores nothing", async () => {
    identityState.resolution = SIGNED_OUT;
    const response = await POST(tap({ venueId: "venue-crown", state: "open" }));
    expect(response.status).toBe(401);
    const body = (await (await GET(read("venue-crown"))).json()) as { report: unknown };
    expect(body.report).toBeNull();
  });

  it("answers 400 to a word off the list, and to a malformed body", async () => {
    for (const state of ["serving", "Open", "", 1, null]) {
      const response = await POST(tap({ venueId: "venue-crown", state }));
      expect(response.status, String(state)).toBe(400);
    }
    expect((await POST(tap("not json"))).status).toBe(400);
    expect((await POST(tap({ venueId: "venue-unknown", state: "open" }))).status).toBe(400);
  });

  it("answers 200 to a report and to another account's confirmation, with the live handle", async () => {
    const first = await POST(tap({ venueId: "venue-crown", state: "open", reporterUserId: BOB }));
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as { outcome: string; report: Record<string, unknown> };
    expect(firstBody.outcome).toBe("reported");
    expect(firstBody.report).toMatchObject({ venueId: "venue-crown", state: "open", handle: "alice", confirmed: false });
    expect(JSON.stringify(firstBody)).not.toContain(ALICE);

    identityState.resolution = SIGNED_IN_BOB;
    const second = await POST(tap({ venueId: "venue-crown", state: "open" }));
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as { outcome: string; report: Record<string, unknown> };
    expect(secondBody.outcome).toBe("confirmed");
    expect(secondBody.report).toMatchObject({ handle: "alice", confirmed: true });
    expect(JSON.stringify(secondBody)).not.toContain(BOB);
  });

  it("answers 409 to the reporter's own confirmation and to a third account", async () => {
    await POST(tap({ venueId: "venue-crown", state: "closed" }));
    const own = await POST(tap({ venueId: "venue-crown", state: "closed" }));
    expect(own.status).toBe(409);
    expect(((await own.json()) as { error: string }).error).toBe("Somebody else has to confirm it.");

    identityState.resolution = SIGNED_IN_BOB;
    expect((await POST(tap({ venueId: "venue-crown", state: "closed" }))).status).toBe(200);
    identityState.resolution = {
      ok: true,
      accountId: "c3333333-3333-4333-8333-333333333333",
      actor: "profile:carol",
      handle: "carol",
    } as Resolution;
    const third = await POST(tap({ venueId: "venue-crown", state: "closed" }));
    expect(third.status).toBe(409);
    expect(((await third.json()) as { error: string }).error).toBe("One other drinker has already confirmed this.");
  });
});

describe("GET /api/kitchen-reports", () => {
  it("returns the newest report with the reporter's handle and no account id", async () => {
    await POST(tap({ venueId: "venue-crown", state: "open" }));
    identityState.resolution = SIGNED_IN_BOB;
    await POST(tap({ venueId: "venue-crown", state: "closed" }));
    const response = await GET(read("venue-crown"));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { status: string; report: Record<string, unknown> };
    expect(body.status).toBe("ready");
    expect(body.report).toMatchObject({ state: "closed", handle: "bob", confirmed: false });
    expect(JSON.stringify(body)).not.toContain(BOB);
    expect(response.headers.get("cache-control")).toMatch(/no-store/);
  });

  it("asks for a pub", async () => {
    expect((await GET(new Request("http://localhost/api/kitchen-reports"))).status).toBe(400);
  });
});
