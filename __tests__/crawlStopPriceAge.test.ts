import { beforeEach, describe, expect, it, vi } from "vitest";

// A CRAWL STOP PRICE IS A PRICE SUBMISSION. Privacy and Terms say a price
// submission needs a signed-in account, a claimed handle and an 18+ answer.
// POST /api/crawls took stop prices from anyone (review of PR 2517), so the
// route now asks the price door's own question (`resolveContributionIdentity`)
// whenever a stop carries a price, and answers with the price door's own body.
// A crawl with no stop price keeps the anonymous save.

const authState = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock("@/lib/authServer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authServer")>();
  const identity = () =>
    authState.userId ? { id: authState.userId, email: null, createdAt: null } : null;
  return {
    ...actual,
    verifyCallerAuth: async () => {
      const id = identity();
      return id ? { status: "verified" as const, identity: id } : { status: "absent" as const };
    },
    callerAuthIdentity: async () => identity(),
    callerUserId: async () => authState.userId,
  };
});
vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return {
    ...actual,
    isSupabaseConfigured: () => false,
    requiresSupabaseStore: () => false,
  };
});
vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));
vi.mock("@/lib/venueIndex", () => ({
  lookupCanonicalVenue: async (id: string) => ({
    status: "found" as const,
    canonicalId: id,
    venue: { id, name: "The Test Arms", borough: "London", lat: 51.5, lng: -0.12 },
  }),
  resolveStoredVenue: async (id: string) => ({
    id,
    name: "The Test Arms",
    borough: "London",
    lat: 51.5,
    lng: -0.12,
  }),
  venueMapUrl: (id: string) => `/map?sel=${encodeURIComponent(id)}`,
}));

import { POST } from "@/app/api/crawls/route";
import {
  __resetMemoryAdultSelfAssertions,
  memoryAdultSelfAssertionStore,
} from "@/lib/adultSelfAssertionStore";
import {
  CONTRIBUTION_ADULT_REFUSAL,
  CONTRIBUTION_HANDLE_REFUSAL,
  CONTRIBUTION_UNDER_18_REFUSAL,
} from "@/lib/contributionGateStatus";
import { __resetCrawlStories } from "@/lib/crawlStoryStore";
import {
  __resetMemoryIdentityHandles,
  memoryIdentityHandleStore,
} from "@/lib/identityHandleStore";
import { __resetPintDrops } from "@/lib/pintDrops";
import {
  __resetMemoryPrivateIdentities,
  memoryPrivateIdentityStore,
} from "@/lib/privateIdentityStore";
import { __resetMemoryProfiles } from "@/lib/profileStore";

const URL_BASE = "http://localhost/api/crawls";

type Stop = { venueId: string; priceGbp?: unknown };

function post(stops: Stop[], extra: Record<string, unknown> = {}): Promise<Response> {
  return POST(
    new Request(URL_BASE, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Friday loop", stops, ...extra }),
    }),
  );
}

function storedCount(): number {
  const stories = (globalThis as { __pubmaxCrawlStories?: Map<string, unknown> })
    .__pubmaxCrawlStories;
  return stories?.size ?? 0;
}

async function claim(userId: string, handle: string): Promise<void> {
  expect(await memoryIdentityHandleStore.claim(userId, handle)).toMatchObject({ ok: true });
}

const PRICED: Stop[] = [{ venueId: "venue-a", priceGbp: 5.4 }, { venueId: "venue-b" }];
const UNPRICED: Stop[] = [{ venueId: "venue-a" }, { venueId: "venue-b", priceGbp: null }];

beforeEach(() => {
  authState.userId = null;
  __resetCrawlStories();
  __resetPintDrops();
  __resetMemoryProfiles();
  __resetMemoryIdentityHandles();
  __resetMemoryPrivateIdentities();
  __resetMemoryAdultSelfAssertions();
});

describe("POST /api/crawls stop prices ask the price door's age question", () => {
  it("refuses a priced crawl from an account with no 18+ answer, then takes it after the tap", async () => {
    authState.userId = "user-unanswered";
    await claim("user-unanswered", "unanswered_drinker");

    const refused = await post(PRICED, { authorHandle: "unanswered_drinker" });
    expect(refused.status).toBe(409);
    expect(refused.headers.get("cache-control")).toBe("no-store");
    expect(await refused.json()).toEqual({
      status: "adult_check_required",
      error: CONTRIBUTION_ADULT_REFUSAL,
    });
    expect(storedCount()).toBe(0);

    await memoryAdultSelfAssertionStore.record("user-unanswered");
    const accepted = await post(PRICED, { authorHandle: "unanswered_drinker" });
    expect(accepted.status).toBe(201);
    expect(storedCount()).toBe(1);
  });

  it("refuses a priced crawl when the stored date of birth is under 18, whatever the tap says", async () => {
    authState.userId = "user-minor";
    expect(
      await memoryPrivateIdentityStore.completeOnboarding({
        userId: "user-minor",
        handle: "minor_drinker",
        dateOfBirth: "2015-01-01",
      }),
    ).toMatchObject({ ok: true });
    await memoryAdultSelfAssertionStore.record("user-minor");

    const refused = await post(PRICED);
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({
      status: "adult_check_failed",
      error: CONTRIBUTION_UNDER_18_REFUSAL,
    });
    expect(storedCount()).toBe(0);
  });

  it("refuses a priced crawl from a signed-out caller, so the age check has no anonymous way round", async () => {
    const refused = await post(PRICED);
    expect(refused.status).toBe(401);
    expect(await refused.json()).toEqual({
      status: "sign_in_required",
      error: "Sign in to contribute.",
    });
    expect(storedCount()).toBe(0);
  });

  it("refuses a priced crawl from an account with no handle yet", async () => {
    authState.userId = "user-no-handle";
    await memoryAdultSelfAssertionStore.record("user-no-handle");

    const refused = await post(PRICED);
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({
      status: "onboarding_required",
      error: CONTRIBUTION_HANDLE_REFUSAL,
    });
    expect(storedCount()).toBe(0);
  });

  it("stores no priced crawl when the account cannot be read", async () => {
    authState.userId = "user-store-down";
    const read = vi
      .spyOn(memoryPrivateIdentityStore, "read")
      .mockRejectedValueOnce(new Error("store down"));
    try {
      const refused = await post(PRICED);
      expect(refused.status).toBe(503);
      expect(await refused.json()).toEqual({
        error: "Contribution identity is unavailable right now.",
      });
      expect(storedCount()).toBe(0);
    } finally {
      read.mockRestore();
    }
  });

  it("keeps the anonymous save for a crawl with no stop price", async () => {
    const saved = await post(UNPRICED);
    expect(saved.status).toBe(201);
    expect(storedCount()).toBe(1);
  });

  it("keeps the save for an unanswered account when no stop carries a price", async () => {
    authState.userId = "user-unanswered";
    await claim("user-unanswered", "unanswered_drinker");

    const saved = await post(UNPRICED, { authorHandle: "unanswered_drinker" });
    expect(saved.status).toBe(201);
    expect(storedCount()).toBe(1);
  });

  it.each([["not a number"], [-2], [""]])(
    "does not count %j as a stop price, because the store keeps no price for it",
    async (priceGbp) => {
      const saved = await post([{ venueId: "venue-a", priceGbp }]);
      expect(saved.status).toBe(201);
      const { slug } = (await saved.json()) as { slug: string };
      const stories = (globalThis as {
        __pubmaxCrawlStories?: Map<string, { stops: Array<{ priceGbp: number | null }> }>;
      }).__pubmaxCrawlStories;
      expect(stories?.get(slug)?.stops.map((stop) => stop.priceGbp)).toEqual([null]);
    },
  );
});
