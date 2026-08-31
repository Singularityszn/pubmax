import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false, requiresSupabaseStore: () => false };
});

const authState = vi.hoisted(() => ({
  userId: null as string | null,
  unavailable: false,
}));
vi.mock("@/lib/authServer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authServer")>();
  return {
    ...actual,
    callerUserId: async () => authState.userId,
    verifyCallerAuth: async () => {
      if (authState.unavailable) {
        return { status: "unavailable" as const };
      }
      return authState.userId
        ? {
            status: "verified" as const,
            identity: {
              id: authState.userId,
              email: null,
              createdAt: null,
            },
          }
        : { status: "absent" as const };
    },
  };
});

const storeState = vi.hoisted(() => ({
  degradeVenueIds: new Set<string>(),
  degradeActorCoverage: false,
}));
vi.mock("@/lib/communityPriceStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/communityPriceStore")>();
  type ActorCoverageReader = (
    venueIds: readonly string[],
    actor: string,
    now?: number,
  ) => Promise<{
    pairs: Array<{ venueId: string; drinkCategory: string }>;
    degraded: boolean;
  }>;
  return {
    ...actual,
    readCommunityPricesWithStatus: async (venueId: string, now?: number) => {
      if (storeState.degradeVenueIds.has(venueId)) {
        return { prices: [], degraded: true };
      }
      return actual.readCommunityPricesWithStatus(venueId, now);
    },
    readCurrentCommunityPriceActorCoverage: async (
      venueIds: readonly string[],
      actor: string,
      now?: number,
    ) => {
      if (storeState.degradeActorCoverage) {
        return { pairs: [], degraded: true };
      }
      return (actual as typeof actual & {
        readCurrentCommunityPriceActorCoverage: ActorCoverageReader;
      }).readCurrentCommunityPriceActorCoverage(venueIds, actor, now);
    },
  };
});

import { GET } from "@/app/api/price-missions/route";
import { COMMUNITY_PRICE_MAX_AGE_MS } from "@/lib/communityPrice";
import {
  __resetCommunityPrices,
  moderateCommunityPrice,
  submitCommunityPrice,
} from "@/lib/communityPriceStore";
import {
  __resetMemoryIdentityHandles,
} from "@/lib/identityHandleStore";
import { __resetPintDrops } from "@/lib/pintDrops";
import {
  MAX_PRICE_EVIDENCE_MISSION_VENUE_IDS,
} from "@/lib/priceEvidenceMissions";
import {
  __resetMemoryProfiles,
  profileStore,
} from "@/lib/profileStore";
import {
  __resetMemoryPrivateIdentities,
  memoryPrivateIdentityStore,
} from "@/lib/privateIdentityStore";

const NOW = Date.parse("2026-08-16T18:00:00.000Z");

function get(query: string): Request {
  return new Request(`http://localhost/api/price-missions${query}`);
}

async function authorizeContributor(userId: string, handle: string): Promise<string> {
  authState.userId = userId;
  const onboarding = await memoryPrivateIdentityStore.completeOnboarding({
    userId,
    handle,
    dateOfBirth: "1990-01-01",
  });
  expect(onboarding).toMatchObject({ ok: true });
  const profile = await profileStore().getByUserId(userId);
  if (!profile) throw new Error("Expected contributor profile");
  return `profile:${profile.id}`;
}

const ORIGINAL_SUPABASE_URL = process.env.SUPABASE_URL;
const ORIGINAL_SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  authState.userId = null;
  authState.unavailable = false;
  storeState.degradeVenueIds.clear();
  storeState.degradeActorCoverage = false;
  __resetCommunityPrices();
  __resetMemoryIdentityHandles();
  __resetMemoryProfiles();
  __resetMemoryPrivateIdentities();
  __resetPintDrops();
});

afterEach(() => {
  vi.useRealTimers();
  if (ORIGINAL_SUPABASE_URL === undefined) delete process.env.SUPABASE_URL;
  else process.env.SUPABASE_URL = ORIGINAL_SUPABASE_URL;
  if (ORIGINAL_SUPABASE_SERVICE_ROLE_KEY === undefined) {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  } else {
    process.env.SUPABASE_SERVICE_ROLE_KEY = ORIGINAL_SUPABASE_SERVICE_ROLE_KEY;
  }
});

describe("GET /api/price-missions", () => {
  it("answers 401 when no session is present", async () => {
    const res = await GET(get("?venueId=venue-xjf3n0"));
    expect(res.status).toBe(401);
    const body = await res.json() as { error: string; status?: string };
    expect(body.status).toBe("sign_in_required");
    expect(body.error).toBeTruthy();
  });

  it("refuses more venue IDs than the bound", async () => {
    await authorizeContributor("user-missions", "mission_owl");
    const params = Array.from(
      { length: MAX_PRICE_EVIDENCE_MISSION_VENUE_IDS + 1 },
      (_, index) => `venueId=venue-${index}`,
    ).join("&");
    const res = await GET(get(`?${params}`));
    expect(res.status).toBe(400);
    const body = await res.json() as { code: string };
    expect(body.code).toBe("INVALID_REQUEST");
  });

  it("returns a ready provisional mission without a price or handle", async () => {
    await authorizeContributor("user-missions", "mission_owl");
    await submitCommunityPrice({
      venueId: "venue-xjf3n0",
      drinkCategory: "beer",
      priceGbp: 4.2,
      actor: "profile:someone-else",
    }, NOW);
    const res = await GET(get("?venueId=venue-xjf3n0&venueId=venue-empty"));
    expect(res.status).toBe(200);
    const body = await res.json() as {
      status: string;
      mission: Record<string, unknown> | null;
    };
    expect(body.status).toBe("ready");
    expect(body.mission).toEqual({
      venueId: "venue-xjf3n0",
      reason: "provisional",
      drinkCategory: "beer",
      observedAt: NOW,
    });
    expect(body.mission).not.toHaveProperty("priceGbp");
    expect(body.mission).not.toHaveProperty("handle");
    expect(JSON.stringify(body)).not.toMatch(/51\.|lat|lng|coord/i);
  });

  it("does not repeat the caller's fresh submission on a new route read", async () => {
    const actor = await authorizeContributor("user-own-price", "mission_owner");
    await submitCommunityPrice({
      venueId: "venue-own-price",
      drinkCategory: "beer",
      priceGbp: 4.2,
      actor,
    }, NOW);

    for (let remount = 0; remount < 2; remount += 1) {
      const res = await GET(get("?venueId=venue-own-price"));
      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toMatchObject({
        status: "ready",
        mission: null,
      });
    }
  });

  it("does not send a hidden own submission into a missing-mission loop", async () => {
    const actor = await authorizeContributor("user-hidden-price", "mission_hidden");
    const submission = await submitCommunityPrice({
      venueId: "venue-own-hidden",
      drinkCategory: "beer",
      priceGbp: 4.2,
      actor,
    }, NOW);
    expect(submission.price?.id).toBeTruthy();
    await expect(
      moderateCommunityPrice(submission.price!.id!, true, "not visible"),
    ).resolves.toBe(true);

    const res = await GET(get("?venueId=venue-own-hidden"));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      status: "ready",
      mission: null,
    });
  });

  it("keeps a missing mission when own coverage is not submittable", async () => {
    const actor = await authorizeContributor("user-own-gin", "mission_gin");
    await submitCommunityPrice({
      venueId: "venue-own-gin",
      drinkCategory: "gin",
      priceGbp: 7.2,
      actor,
    }, NOW);

    const res = await GET(get("?venueId=venue-own-gin"));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      status: "ready",
      mission: {
        venueId: "venue-own-gin",
        reason: "missing",
      },
    });
  });

  it("keeps the caller's stale category eligible after excluding fresh evidence", async () => {
    const actor = await authorizeContributor("user-stale-price", "mission_stale");
    await submitCommunityPrice({
      venueId: "venue-own-fresh",
      drinkCategory: "beer",
      priceGbp: 4.2,
      actor,
    }, NOW);
    await submitCommunityPrice({
      venueId: "venue-own-stale",
      drinkCategory: "wine",
      priceGbp: 5.5,
      actor,
    }, NOW - COMMUNITY_PRICE_MAX_AGE_MS - 1);

    const res = await GET(get(
      "?venueId=venue-own-fresh&venueId=venue-own-stale",
    ));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      status: "ready",
      mission: {
        venueId: "venue-own-stale",
        reason: "stale",
        drinkCategory: "wine",
      },
    });
  });

  it("fails closed when actor coverage cannot be read completely", async () => {
    await authorizeContributor("user-coverage-failure", "mission_degraded");
    await submitCommunityPrice({
      venueId: "venue-someone-else",
      drinkCategory: "beer",
      priceGbp: 4.2,
      actor: "profile:someone-else",
    }, NOW);
    storeState.degradeActorCoverage = true;

    const res = await GET(get("?venueId=venue-someone-else"));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      status: "degraded",
      mission: null,
    });
  });

  it("marks a failed store read degraded and does not claim an empty market", async () => {
    await authorizeContributor("user-missions", "mission_owl");
    storeState.degradeVenueIds.add("venue-xjf3n0");
    const res = await GET(get("?venueId=venue-xjf3n0"));
    expect(res.status).toBe(200);
    const body = await res.json() as {
      status: string;
      mission: Record<string, unknown> | null;
    };
    expect(body.status).toBe("degraded");
    expect(body.mission).toBeNull();
    expect(JSON.stringify(body)).not.toMatch(/no pubs|empty market|nothing to log/i);
  });

  it("still ranks a ready neighbour when one venue read is degraded", async () => {
    await authorizeContributor("user-missions", "mission_owl");
    storeState.degradeVenueIds.add("venue-broken");
    await submitCommunityPrice({
      venueId: "venue-xjf3n0",
      drinkCategory: "wine",
      priceGbp: 5.5,
      actor: "profile:someone-else",
    }, NOW - COMMUNITY_PRICE_MAX_AGE_MS - 1);
    const res = await GET(get("?venueId=venue-broken&venueId=venue-xjf3n0"));
    expect(res.status).toBe(200);
    const body = await res.json() as {
      status: string;
      mission: { reason: string; drinkCategory?: string } | null;
    };
    expect(body.status).toBe("degraded");
    expect(body.mission).toMatchObject({
      venueId: "venue-xjf3n0",
      reason: "stale",
      drinkCategory: "wine",
    });
  });
});
