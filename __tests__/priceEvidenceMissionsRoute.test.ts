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
  coverageUnavailable: false,
}));
vi.mock("@/lib/communityPriceStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/communityPriceStore")>();
  return {
    ...actual,
    readCurrentCommunityPriceActorCoverage: async (...args: Parameters<typeof actual.readCurrentCommunityPriceActorCoverage>) => {
      if (storeState.coverageUnavailable) return { pairs: [], degraded: true };
      return actual.readCurrentCommunityPriceActorCoverage(...args);
    },
    readCommunityPricesWithStatus: async (venueId: string, now?: number) => {
      if (storeState.degradeVenueIds.has(venueId)) {
        return { prices: [], degraded: true };
      }
      return actual.readCommunityPricesWithStatus(venueId, now);
    },
  };
});

import { GET } from "@/app/api/price-missions/route";
import { COMMUNITY_PRICE_MAX_AGE_MS } from "@/lib/communityPrice";
import { resolveContributionIdentity } from "@/lib/contributionIdentity.server";
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
  const contributor = await resolveContributionIdentity(get("?venueId=venue-xjf3n0"));
  if (!contributor.ok) throw new Error("Expected the onboarded contributor identity.");
  return contributor.actor;
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
  storeState.coverageUnavailable = false;
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

  it("does not ask the contributor to corroborate a current own observation", async () => {
    const actor = await authorizeContributor("user-own-current", "mission_owner");
    const submission = await submitCommunityPrice({
      venueId: "venue-own-current",
      drinkCategory: "beer",
      priceGbp: 4.2,
      actor,
    }, NOW);
    expect(submission.price).toMatchObject({
      venueId: "venue-own-current",
      drinkCategory: "beer",
      submittedAt: NOW,
    });

    const res = await GET(get("?venueId=venue-own-current"));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ status: "ready", mission: null });
  });

  it("keeps the provisional task available to another contributor", async () => {
    const originalActor = await authorizeContributor("user-first-observer", "first_observer");
    await submitCommunityPrice({
      venueId: "venue-independent-check",
      drinkCategory: "beer",
      priceGbp: 4.2,
      actor: originalActor,
    }, NOW);
    const otherActor = await authorizeContributor("user-second-observer", "second_observer");
    expect(otherActor).not.toBe(originalActor);

    const res = await GET(get(`?venueId=venue-independent-check&actor=${encodeURIComponent(originalActor)}`));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      status: "ready",
      mission: {
        venueId: "venue-independent-check",
        reason: "provisional",
        drinkCategory: "beer",
        observedAt: NOW,
      },
    });
  });

  it("does not replace a hidden current own observation with a missing task", async () => {
    const actor = await authorizeContributor("user-hidden-observer", "hidden_observer");
    const { price } = await submitCommunityPrice({
      venueId: "venue-hidden-own", drinkCategory: "beer", priceGbp: 4.2, actor,
    }, NOW);
    if (!price?.id) throw new Error("Expected a stored observation.");
    await moderateCommunityPrice(price.id, true, "menu mismatch");

    const res = await GET(get("?venueId=venue-hidden-own"));
    await expect(res.json()).resolves.toEqual({ status: "ready", mission: null });
  });

  it("offers another category at the same venue without exposing actor coverage", async () => {
    const actor = await authorizeContributor("user-category-observer", "category_observer");
    await submitCommunityPrice({
      venueId: "venue-other-category", drinkCategory: "beer", priceGbp: 4.2, actor,
    }, NOW);
    await submitCommunityPrice({
      venueId: "venue-other-category", drinkCategory: "wine", priceGbp: 5.5, actor: "profile:another",
    }, NOW);

    const res = await GET(get("?venueId=venue-other-category"));
    await expect(res.json()).resolves.toEqual({
      status: "ready",
      mission: { venueId: "venue-other-category", reason: "provisional", drinkCategory: "wine", observedAt: NOW },
    });
  });

  it("does not offer a task when its actor coverage read fails", async () => {
    await authorizeContributor("user-coverage-unavailable", "coverage_unavailable");
    storeState.coverageUnavailable = true;

    const res = await GET(get("?venueId=venue-empty"));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ status: "degraded", mission: null });
  });

  it("keeps stale own observations eligible for a fresh price", async () => {
    const actor = await authorizeContributor("user-stale-observer", "stale_observer");
    const observedAt = NOW - COMMUNITY_PRICE_MAX_AGE_MS - 1;
    await submitCommunityPrice({
      venueId: "venue-stale-own",
      drinkCategory: "wine",
      priceGbp: 5.5,
      actor,
    }, observedAt);

    const res = await GET(get("?venueId=venue-stale-own"));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      status: "ready",
      mission: {
        venueId: "venue-stale-own",
        reason: "stale",
        drinkCategory: "wine",
        observedAt,
      },
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
