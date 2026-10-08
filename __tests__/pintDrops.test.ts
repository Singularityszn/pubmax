import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// The route talks to the PintDropStore interface only. Keep the real module
// (memory store, toDTO, validation) but swap the Supabase store's `create` so
// Supabase-configured tests never open a network connection. Orphan-cleanup
// behaviour is pinned where it now lives: pintDropsStore.test.ts.

vi.mock("@/lib/pintDropsStore", async () => {
  const actual = await vi.importActual<typeof import("@/lib/pintDropsStore")>(
    "@/lib/pintDropsStore",
  );
  // Override create on the Supabase store AND the factory: pintDropsStore() in
  // the actual module closes over the original supabasePintDropStore binding, so
  // replacing only the named export would leave the route calling the real create.
  const supabasePintDropStore = { ...actual.supabasePintDropStore, create: storeCreate };
  return {
    ...actual,
    supabasePintDropStore,
    pintDropsStore: () =>
      supaGuard.configured ? supabasePintDropStore : actual.memoryPintDropStore,
  };
});

// Mock the lib/supabase seam. Two reasons, both about determinism under a
// PRODUCTION build (Vercel CI presets NODE_ENV=production, and Vite bakes
// process.env.NODE_ENV at transform time — so runtime vi.stubEnv on it is a
// silent no-op, exactly the trap profileOwnershipRoute.test.ts documents):
//   • checkRateLimitDurableDetailed — default (null + error) = "durable
//     limiter unavailable", so every existing test keeps exercising the
//     in-memory / degraded fallback as before.
//   • isSupabaseConfigured / requiresSupabaseStore — mocked as controllable
//     flags. isSupabaseConfigured() is FALSE by default so assertServerEnv()
//     (called at ROUTE IMPORT, before any beforeEach) never throws its FATAL
//     even when NODE_ENV is baked to "production". The two 503/guard cases flip
//     the corresponding flag explicitly rather than stubbing NODE_ENV.
//   • getSupabaseAdmin — swappable via adminRef so the supabasePintDropStore
//     report tests below can script rpc() responses without a network client.
//     Defaults to null (= unconfigured), matching the real default in tests.
const { storeCreate, checkRateLimitDurableDetailed, supaGuard, adminRef, reportAuth } = vi.hoisted(() => ({
  storeCreate: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  checkRateLimitDurableDetailed: vi.fn<
    (key: string) => Promise<{ verdict: boolean | null; reason?: "missing-rpc" | "error" | "no-client" }>
  >(),
  supaGuard: { configured: false, requiresStore: false },
  adminRef: { client: null as unknown },
  reportAuth: { userId: null as string | null },
}));
vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return {
    ...actual,
    checkRateLimitDurableDetailed,
    checkRateLimitDurable: async (...args: Parameters<typeof checkRateLimitDurableDetailed>) =>
      (await checkRateLimitDurableDetailed(...args)).verdict,
    isSupabaseConfigured: () => supaGuard.configured,
    requiresSupabaseStore: () => supaGuard.requiresStore,
    getSupabaseAdmin: () => adminRef.client,
    requireSupabaseAdmin: () => {
      const client = adminRef.client;
      if (!client) throw new Error("Supabase not configured.");
      return client;
    },
  };
});

vi.mock("@/lib/authServer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authServer")>();
  return {
    ...actual,
    callerUserId: async () => reportAuth.userId,
  };
});

// assertServerEnv() runs at ROUTE IMPORT (route.ts:39) — before any beforeEach —
// and throws a FATAL when NODE_ENV==="production" and Supabase is unconfigured.
// Under a production build (Vercel CI) that import-time throw would fail the whole
// suite regardless of the supabase mock above (the throw fires during module
// evaluation, before the mocked isSupabaseConfigured is reliably wired into the
// transitive serverEnv binding). It is a pure startup guard with no bearing on
// route behaviour — the 503 durable-store contract is exercised via the
// requiresSupabaseStore() flag below — so no-op it here for a deterministic import
// in every environment.
vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));
// A stored drop nudges Realtime in the background, never awaited by the
// response. The Supabase-configured cases below point at an unreachable stub
// URL, so the real nudge outlived the file and logged its failure while the
// worker was closing: vitest reported an EnvironmentTeardownError and failed
// the whole run. The nudge itself is pinned in pintDropsBroadcast.test.ts.
const signalPintDropLanded = vi.hoisted(() => vi.fn());
vi.mock("@/lib/pintDropsBroadcast.server", () => ({ signalPintDropLanded }));
vi.mock("@/lib/venueAliases", () => {
  const aliases: Record<string, string> = {
    "legacy-pub": "canonical-pub",
    "legacy-bar": "bar-test",
    "venue-1sw9ofl": "venue-eltcmh",
  };
  const canonical = (id: string) => aliases[id] ?? id;
  const storedIds = (id: string) => [
    canonical(id),
    ...Object.keys(aliases).filter((from) => aliases[from] === canonical(id)),
  ];
  return {
    resolveCanonicalVenueId: async (id: string) => canonical(id),
    storedVenueIds: async (id: string) => storedIds(id),
    loadVenueAliasResolver: async () => ({
      canonical,
      storedIds,
      retired: () => null,
    }),
  };
});
vi.mock("@/lib/venueIndex", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/venueIndex")>();
  const venue = (id: string): import("@/lib/venueIndex").VenueRef =>
    id === "bar-test"
      ? {
          id,
          name: "Test Cocktail Bar",
          borough: "Westminster",
          lat: 51.5,
          lng: -0.12,
          kind: "bar",
        }
      : {
          id,
          name: id === "venue-oxf-16404bl" ? "Turf Tavern" : "The Crown",
          borough: id === "venue-oxf-16404bl" ? "Oxford"
            : id === "venue-eltcmh" ? "City of London" : "London",
          lat: 51.5,
          lng: -0.12,
        };
  return {
    ...actual,
    lookupCanonicalVenue: async (id: string) => {
      const canonicalId =
        id === "legacy-pub"
          ? "canonical-pub"
          : id === "legacy-bar"
            ? "bar-test"
            : id;
      if (canonicalId === "unavailable-pub") {
        return { status: "unavailable" as const, canonicalId };
      }
      if (canonicalId === "unknown-pub") {
        return { status: "unknown" as const, canonicalId };
      }
      return { status: "found" as const, canonicalId, venue: venue(canonicalId) };
    },
    getVenueIndex: async () =>
      ({
        size: 1,
        get: (id: string) => venue(id),
      }) as unknown as Map<string, import("@/lib/venueIndex").VenueRef>,
  };
});

// Ownership gate is covered elsewhere; these route tests focus on storage /
// rate-limit contracts and use unlinked demo handles. Keep the gate open so a
// configured-Supabase profile lookup cannot 503/403 the write path under test.
// The gate answers with the request's own verified actor and falls back to a
// stand-in signed-in account, because a priced drop now needs an attributable
// one. Setting `gateActor.userId = null` puts a test on the unlinked demo door
// deliberately.
const gateActor: { userId: string | null } = { userId: "demo-account" };

vi.mock("@/lib/profileOwnership", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/profileOwnership")>();
  return {
    ...actual,
    gateHandleAction: async (_request: Request, handle: string) => ({
      allowed: true as const,
      callerUserId: reportAuth.userId ?? gateActor.userId,
      handle,
    }),
  };
});

import { GET, POST } from "@/app/api/pint-drops/route";
import {
  __resetMemoryAdultSelfAssertions,
  memoryAdultSelfAssertionStore,
} from "@/lib/adultSelfAssertionStore";
import {
  __resetPintDrops,
  dropMatchesCityScope,
  reportPintDrop,
  type PintDropReportIdentity,
  validatePintDrop,
} from "@/lib/pintDrops";
import {
  memoryPintDropStore,
  PhotoRefusalError,
  supabasePintDropStore,
  UNREADABLE_PHOTO_REFUSAL,
} from "@/lib/pintDropsStore";
import { RECEIPT_REQUIRED_LINE, priceNeedsReceipt } from "@/lib/pintDropReceipt";
import { memoryProfileStore } from "@/lib/profileStore";
import { defined } from "@/__tests__/helpers/defined";

const URL_BASE = "http://localhost/api/pint-drops";

/** A tiny, real JPEG: the two markers the upload path's sniffer looks for. */
function jpegFile(name: string): File {
  return new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], name, { type: "image/jpeg" });
}

/**
 * A POST as a real client makes it. A PRICED body goes multipart and carries
 * the bill, because the route refuses a price without one (captain 7 Sept
 * 2026, lib/pintDropReceipt.ts). An unpriced body stays JSON, which is what
 * the note and memory lanes send.
 */
function post(body: unknown): Promise<Response> {
  const fields = (body ?? {}) as Record<string, unknown>;
  if (!priceNeedsReceipt(fields.priceGbp)) {
    return POST(new Request(URL_BASE, { method: "POST", body: JSON.stringify(body) }));
  }
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue;
    // The route reads tags from repeated `vibe_tags` entries, which is what the
    // real composer sends; every other field is a plain string.
    const field = key === "vibeTags" ? "vibe_tags" : key;
    if (Array.isArray(value)) for (const entry of value) form.append(field, String(entry));
    else form.set(field, String(value));
  }
  form.set("receipt_photo", jpegFile("bill.jpg"));
  return POST(new Request(URL_BASE, { method: "POST", body: form }));
}

function get(venueId?: string): Promise<Response> {
  const url = venueId ? `${URL_BASE}?venueId=${encodeURIComponent(venueId)}` : URL_BASE;
  return GET(new Request(url));
}

// Anonymous reports use the hashed client IP for flood control and recording.
// Only verified account identities enter the auto-hide count.
function deviceHeaders(device?: string): Record<string, string> | undefined {
  if (!device) return undefined;
  return { "x-forwarded-for": `203.0.113.${device === "device-a" ? "10" : "20"}` };
}

function report(id: string, reason?: string, device?: string): Promise<Response> {
  return POST(
    new Request(URL_BASE, {
      method: "POST",
      headers: deviceHeaders(device),
      body: JSON.stringify({
        action: "report",
        id,
        ...(reason ? { reason } : {}),
        ...(device ? { actor: device } : {}),
      }),
    }),
  );
}

async function signedReport(
  id: string,
  userId: string,
  reason?: string,
  device?: string,
): Promise<Response> {
  reportAuth.userId = userId;
  try {
    return await report(id, reason, device);
  } finally {
    reportAuth.userId = null;
  }
}

// Moderator GET/POST. In test env (NODE_ENV !== production, ADMIN_TOKEN unset)
// the gate opens by default; pass a token only where a test sets one. The token
// travels in the `x-admin-token` header ONLY — query-string tokens are no
// longer accepted (they leak through logs/history/referrers).
function modGet(status: string, token?: string): Promise<Response> {
  return GET(
    new Request(`${URL_BASE}?status=${status}`, {
      headers: token ? { "x-admin-token": token } : undefined,
    }),
  );
}

function modAction(action: string, id: string, token?: string): Promise<Response> {
  return POST(
    new Request(URL_BASE, {
      method: "POST",
      headers: token ? { "x-admin-token": token } : undefined,
      body: JSON.stringify({ action, id }),
    }),
  );
}

const VENUE = "the-crown";

describe("dropMatchesCityScope", () => {
  it("matches every shipped city prefix and keeps London unprefixed", () => {
    expect(dropMatchesCityScope("venue-16pnwmm", "london")).toBe(true);
    expect(dropMatchesCityScope("venue-mcr-1lwo5lo", "london")).toBe(false);
    expect(dropMatchesCityScope("venue-oxf-16404bl", "london")).toBe(false);
    expect(dropMatchesCityScope("venue-glw-dsoj3p", "glasgow")).toBe(true);
    expect(dropMatchesCityScope("venue-liv-12byxft", "liverpool")).toBe(true);
    expect(dropMatchesCityScope("venue-bri-ycukpj", "bristol")).toBe(true);
    expect(dropMatchesCityScope("venue-cam-1k0qcn7", "cambridge")).toBe(true);
    expect(dropMatchesCityScope("venue-bat-f4de2h", "bath")).toBe(true);
    expect(dropMatchesCityScope("venue-dur-libaa7", "durham")).toBe(true);
    expect(dropMatchesCityScope("venue-oxf-16404bl", "manchester")).toBe(false);
  });
});

beforeEach(() => {
  __resetPintDrops();
  __resetMemoryAdultSelfAssertions();
  // The moderator gate still reads process.env.NODE_ENV at runtime; keep the
  // stub for it. The durable-store guard is driven by the mocked supaGuard flags
  // (reset to the in-memory demo defaults here), NOT by NODE_ENV — see the
  // vi.mock above for why NODE_ENV stubbing can't drive it under a prod build.
  vi.stubEnv("NODE_ENV", "test");
  supaGuard.configured = false;
  supaGuard.requiresStore = false;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.ADMIN_TOKEN;
  checkRateLimitDurableDetailed.mockReset();
  checkRateLimitDurableDetailed.mockResolvedValue({ verdict: null, reason: "error" });
  adminRef.client = null;
  reportAuth.userId = null;
  gateActor.userId = "demo-account";
  delete process.env.RATE_LIMIT_STRICT;
});

afterAll(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/pint-drops (create)", () => {
  it("requires a verified account before validating a production Pint Drop", async () => {
    supaGuard.configured = true;
    supaGuard.requiresStore = true;

    const response = await post({ handle: "self_asserted" });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: "Sign in to post a Pint Drop.",
      code: "UNAUTHENTICATED",
      retryable: false,
    });
  });

  it("accepts a priced drop as a contributor", async () => {
    const res = await post({ venueId: VENUE, handle: "ale", priceGbp: 4.2 });
    expect(res.status).toBe(201);
    const { drop } = await res.json();
    expect(drop.provenance).toBe("contributor");
    expect(drop.status).toBe("visible");
  });

  it("keeps a signed-in observed price visible through the GET seam", async () => {
    reportAuth.userId = "account-pint-drop-flow";
    await memoryProfileStore.createOwned("signed_in_drinker", reportAuth.userId);

    const created = await post({
      venueId: VENUE,
      handle: "signed_in_drinker",
      priceGbp: 4.2,
      drink: "Pint of ale",
    });
    expect(created.status).toBe(201);
    const { drop } = await created.json();
    expect(drop).toMatchObject({
      venueId: VENUE,
      handle: "signed_in_drinker",
      priceGbp: 4.2,
      provenance: "contributor",
    });

    const listed = await get(VENUE);
    expect(listed.status).toBe(200);
    expect((await listed.json()).drops).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: drop.id,
          handle: "signed_in_drinker",
          priceGbp: 4.2,
        }),
      ]),
    );
  });

  it("posts a priced drop for an account whose age answer is the one tap", async () => {
    // ONE RULE (captain, 5 Sep 2026). This route asks for a linked handle and
    // a verified actor and NEVER for a date of birth, so an account that
    // answered the age question with the recorded tap posts its price here the
    // same way it now does through /api/price-submit.
    reportAuth.userId = "account-tapped";
    await memoryProfileStore.createOwned("tapped_drinker", reportAuth.userId);
    await memoryAdultSelfAssertionStore.record(reportAuth.userId);

    const created = await post({
      venueId: VENUE,
      handle: "tapped_drinker",
      priceGbp: 4.6,
      drink: "Pint of ale",
    });

    expect(created.status).toBe(201);
    expect((await created.json()).drop).toMatchObject({
      handle: "tapped_drinker",
      priceGbp: 4.6,
      provenance: "contributor",
    });
  });

  it("asks the Pint Drop write path for no birth date", () => {
    // A source fence, because no request can prove the ABSENCE of a question.
    const route = readFileSync(
      resolve(process.cwd(), "app/api/pint-drops/route.ts"),
      "utf8",
    );
    expect(route).not.toMatch(/dateOfBirth|date_of_birth/);
  });

  it("requires account onboarding instead of claiming a body handle", async () => {
    const accountId = "account-without-profile";
    reportAuth.userId = accountId;

    const rejected = await post({
      venueId: VENUE,
      handle: "stale_device_handle",
      priceGbp: 4.2,
    });
    expect(rejected.status).toBe(409);
    expect(await rejected.json()).toMatchObject({
      status: "onboarding_required",
      code: "ONBOARDING_REQUIRED",
    });

    const listed = await get(VENUE);
    expect((await listed.json()).drops).toEqual([]);
    expect(await memoryProfileStore.getHandleByUserId(accountId)).toBeNull();
  });

  it("adds server-derived price authority for a verified account", async () => {
    reportAuth.userId = "account-a";
    await memoryProfileStore.createOwned("authority_ale", reportAuth.userId);

    const verified = await post({ venueId: VENUE, handle: "authority_ale", priceGbp: 4.2 });
    expect(verified.status).toBe(201);
    const { drop: verifiedDrop } = await verified.json();
    expect(verifiedDrop.authorityKey).toMatch(/^[a-f0-9]{64}$/);
    expect(verifiedDrop.authorityKey).not.toContain("account-a");

  });

  it("refuses a priced drop through the unlinked handle door", async () => {
    reportAuth.userId = null;
    gateActor.userId = null;

    const refused = await post({
      venueId: "canonical-pub",
      handle: "another_ale",
      priceGbp: 4.2,
    });

    expect(refused.status).toBe(401);
    expect(await refused.json()).toEqual({
      error: "Sign in to post a price under your name.",
      code: "UNAUTHENTICATED",
      retryable: false,
    });
    // Nothing reaches the store, so no unattributable price is ever kept.
    const listed = await get("canonical-pub");
    expect((await listed.json()).drops).toEqual([]);
  });

  it("keeps the unlinked handle door open for an unpriced memory", async () => {
    reportAuth.userId = null;
    gateActor.userId = null;

    const accepted = await post({
      venueId: VENUE,
      handle: "another_ale",
      passedDownNote: "cheapest in town, 1998",
    });

    expect(accepted.status).toBe(201);
    const { drop } = await accepted.json();
    expect(drop.provenance).toBe("anecdote");
    expect(drop.priceGbp).toBeNull();
    expect(drop.authorityKey).toBeUndefined();
  });

  // #1436 changed this design. An anonymous drop used to store NO authority
  // key, so a signed-in drinker who chose the anonymous lane posted a price
  // that could never corroborate and could never be corroborated, at any age
  // and however many other drinkers arrived. Anonymity is about DISPLAY, not
  // attribution: the key is now derived from the account exactly as it is for a
  // public drop, and what the anonymous lane buys is that neither the handle
  // nor the key rides a public read.
  it("stores authority for an anonymous drop and publishes neither handle nor key", async () => {
    reportAuth.userId = "account-anon";
    await memoryProfileStore.createOwned("verified_anon", reportAuth.userId);

    const response = await post({
      venueId: VENUE,
      handle: "verified_anon",
      priceGbp: 4.2,
      visibility: "anonymous",
    });

    expect(response.status).toBe(201);
    const { drop } = await response.json();
    expect(drop.visibility).toBe("anonymous");
    // The public DTO the drinker's own write answers with.
    expect(drop.handle).not.toBe("verified_anon");
    expect(drop.authorityKey).toBeUndefined();

    // Every other public read agrees.
    const listed = await get(VENUE);
    const [publicRow] = (await listed.json()).drops;
    expect(publicRow.id).toBe(drop.id);
    expect(publicRow.handle).not.toBe("verified_anon");
    expect(publicRow.authorityKey).toBeUndefined();

    // The row itself carries the key, which is what lets this price
    // corroborate: the confirmation producer reads it server-side.
    const [stored] = await memoryPintDropStore.listConfirmationCandidates(VENUE);
    expect(defined(stored).id).toBe(drop.id);
    expect(defined(stored).authorityKey).toMatch(/^[a-f0-9]{64}$/);
    expect(defined(stored).authorityKey).not.toContain("account-anon");
  });

  it("refuses a priced drop with no photo of the bill", async () => {
    reportAuth.userId = "account-noproof";
    await memoryProfileStore.createOwned("no_proof", reportAuth.userId);
    // The bare JSON body a client that has not been updated would send.
    const res = await POST(
      new Request(URL_BASE, {
        method: "POST",
        body: JSON.stringify({ venueId: VENUE, handle: "no_proof", priceGbp: 4.5 }),
      }),
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error?: string }).error).toBe(RECEIPT_REQUIRED_LINE);
  });

  it("takes a drop that carries no price without asking for a bill", async () => {
    // A Pint Drop can be a note or a bit of lore. Only a PRICE is a claim a
    // reader needs to be able to check.
    reportAuth.userId = "account-lore";
    await memoryProfileStore.createOwned("lore_teller", reportAuth.userId);
    const res = await post({
      venueId: VENUE,
      handle: "lore_teller",
      passedDownNote: "The back bar is the original 1904 mahogany.",
    });
    expect(res.status).toBe(201);
  });

  it("stores no profile row for a signed-out demo drop", async () => {
    gateActor.userId = null;
    const res = await post({
      venueId: VENUE,
      handle: "demo_drinker",
      passedDownNote: "The back bar is the original 1904 mahogany.",
    });
    expect(res.status).toBe(201);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(await memoryProfileStore.getByHandle("demo_drinker")).toBeNull();
  });

  it("confirms an anonymous price against a second account's public one", async () => {
    reportAuth.userId = "account-anon-payer";
    await memoryProfileStore.createOwned("quiet_drinker", reportAuth.userId);
    const anonymous = await post({
      venueId: VENUE,
      handle: "quiet_drinker",
      priceGbp: 4.2,
      visibility: "anonymous",
    });
    expect(anonymous.status).toBe(201);

    reportAuth.userId = "account-second-payer";
    await memoryProfileStore.createOwned("loud_drinker", reportAuth.userId);
    const named = await post({
      venueId: VENUE,
      handle: "loud_drinker",
      priceGbp: 4.2,
    });
    expect(named.status).toBe(201);

    // Two accounts, two authority keys, one agreement: the second reporter
    // completes the pair even though the first drinker stayed anonymous.
    expect(await named.json()).toMatchObject({
      confirmation: { basis: "second_reporter" },
    });
  });

  it("tells the same account its repeat confirms nothing, and stamps nothing", async () => {
    reportAuth.userId = "account-repeat";
    await memoryProfileStore.createOwned("repeat_drinker", reportAuth.userId);
    // One account, two London days, one figure. The daily cap refuses a
    // same-day repeat at the route, so the earlier day's row is placed in the
    // store and the pass is asked directly: it reads the two as one reporter.
    const first = await post({ venueId: VENUE, handle: "repeat_drinker", priceGbp: 4.5 });
    expect(first.status).toBe(201);
    expect(await first.json()).toMatchObject({
      confirmationOutcome: { status: "awaiting_second_drinker" },
    });
    const { addPintDrop } = await import("@/lib/pintDrops");
    const { pintDropAuthorityKey } = await import("@/lib/pintDropAuthority.server");
    addPintDrop({
      id: "repeat-earlier",
      venueId: VENUE,
      handle: "repeat_drinker",
      drink: "Lager",
      priceGbp: 4.5,
      passedDownNote: "",
      era: "",
      provenance: "contributor",
      status: "visible",
      visibility: "public",
      createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
      authorityKey: pintDropAuthorityKey(VENUE, reportAuth.userId),
    });
    const { runSecondReporterPass } = await import("@/lib/pintDropConfirm.server");
    // Asked AS that account: `same_reporter` is a sentence about the caller and
    // is only ever true of the caller's own key (battle test D08).
    expect(
      await runSecondReporterPass(
        VENUE,
        Date.now(),
        pintDropAuthorityKey(VENUE, reportAuth.userId),
      ),
    ).toEqual({ status: "same_reporter" });
    const listed = (await (await get(VENUE)).json()) as { drops: Array<{ confirmation?: unknown }> };
    expect(listed.drops.every((drop) => !drop.confirmation)).toBe(true);
  });

  it("mints for a second account and hands the confirming drop its record", async () => {
    reportAuth.userId = "account-door-one";
    await memoryProfileStore.createOwned("door_one", reportAuth.userId);
    expect((await post({ venueId: VENUE, handle: "door_one", priceGbp: 4.5 })).status).toBe(201);

    reportAuth.userId = "account-door-two";
    await memoryProfileStore.createOwned("door_two", reportAuth.userId);
    const res = await post({ venueId: VENUE, handle: "door_two", priceGbp: 4.5 });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      drop: { id: string; confirmation?: { confirmationId: string } };
      confirmation?: { confirmationId: string; basis: string; confirmingDropId?: string };
      confirmationOutcome?: { status: string; dropIds?: string[] };
    };
    expect(body.confirmationOutcome?.status).toBe("confirmed");
    expect(body.confirmation).toMatchObject({ basis: "second_reporter" });
    expect(body.confirmation?.confirmingDropId).toBeTruthy();
    // The row the drinker gets back already wears the record it just earned,
    // so the sheet can read Confirmed before the lane is re-read.
    expect(body.drop.confirmation?.confirmationId).toBe(body.confirmation?.confirmationId);
    expect(body.confirmationOutcome?.dropIds).toContain(body.drop.id);
  });

  it("accepts a note-only drop as an anecdote", async () => {
    const res = await post({ venueId: VENUE, handle: "ale", passedDownNote: "cheapest in town, 1998" });
    expect(res.status).toBe(201);
    const { drop } = await res.json();
    expect(drop.provenance).toBe("anecdote");
  });

  it("rejects an empty submission (no price, no note)", async () => {
    const res = await post({ venueId: VENUE, handle: "ale" });
    expect(res.status).toBe(400);
  });

  it("rejects an out-of-range price", async () => {
    const res = await post({ venueId: VENUE, handle: "ale", priceGbp: 40 });
    expect(res.status).toBe(400);
  });

  it("rejects a sub-£1 price as an outlier (fat-fingered entry)", async () => {
    const res = await post({ venueId: VENUE, handle: "ale", priceGbp: 0.45 });
    expect(res.status).toBe(400);
    // validatePintDrop is the trust boundary — check it directly too.
    const result = validatePintDrop({ venueId: VENUE, handle: "ale", priceGbp: 0.99 });
    expect(result.ok).toBe(false);
    // Exactly £1 is the honest floor and must pass.
    const atFloor = validatePintDrop({ venueId: VENUE, handle: "ale", priceGbp: 1 });
    expect(atFloor.ok).toBe(true);
  });

  it("rejects a missing handle", async () => {
    const res = await post({ venueId: VENUE, priceGbp: 4.2 });
    expect(res.status).toBe(400);
  });

  it("answers the malformed-request envelope for a broken multipart body instead of throwing", async () => {
    const res = await POST(
      new Request(URL_BASE, {
        method: "POST",
        headers: { "content-type": "multipart/form-data; boundary=not-the-real-boundary" },
        body: "this is not valid multipart content",
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("MALFORMED_REQUEST");
  });

  it("rejects a cocktail bar before persisting a Pint Drop", async () => {
    const res = await post({
      venueId: "bar-test",
      handle: "ale",
      priceGbp: 12,
    });
    expect(res.status).toBe(400);
    const listed = await get("bar-test");
    expect((await listed.json()).drops).toEqual([]);
  });

  it("canonicalizes a legacy pub alias before validation and persistence", async () => {
    const res = await post({
      venueId: "legacy-pub",
      handle: "ale",
      priceGbp: 4.2,
    });
    expect(res.status).toBe(201);
    const { drop } = await res.json();
    expect(drop.venueId).toBe("canonical-pub");
    const listed = await get("canonical-pub");
    expect((await listed.json()).drops).toHaveLength(1);
  });

  it("rejects a legacy alias that resolves to a cocktail bar", async () => {
    const res = await post({
      venueId: "legacy-bar",
      handle: "ale",
      priceGbp: 12,
    });
    expect(res.status).toBe(400);
    const listed = await get("bar-test");
    expect((await listed.json()).drops).toEqual([]);
  });

  it("returns unavailable when the submitted venue city pack cannot load", async () => {
    const res = await post({
      venueId: "unavailable-pub",
      handle: "ale",
      priceGbp: 4.2,
    });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      error: "Venue list is unavailable right now, try again shortly.",
      code: "UNAVAILABLE",
      retryable: true,
    });
  });

  it("normalizes handles before persistence so author filters match", () => {
    const result = validatePintDrop({ venueId: VENUE, handle: " @Ale-Ken! ", priceGbp: 4.2 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.handle).toBe("aleken");
  });

  it("rate-limits the 9th rapid submission from one handle", async () => {
    let last: Response | undefined;
    for (let i = 0; i < 9; i++) {
      last = await post({ venueId: VENUE, handle: "flooder", priceGbp: 4 });
    }
    expect(last!.status).toBe(429);
  });

  it("exposes an anonymous report on a visible Pint Drop to moderator review", async () => {
    const created = await post({ venueId: VENUE, handle: "reported-author", priceGbp: 4.2 });
    expect(created.status).toBe(201);
    const { drop } = await created.json();

    const reportResponse = await report(drop.id, "wrong price", "device-a");
    expect(reportResponse.status).toBe(200);

    const queueResponse = await modGet("reported");
    expect(queueResponse.status).toBe(200);
    const queue = (await queueResponse.json()) as { drops: Array<Record<string, unknown>> };
    expect(queue.drops).toHaveLength(1);
    expect(queue.drops[0]).toMatchObject({
      id: drop.id,
      reportReason: "wrong price",
      handle: "reportedauthor",
    });
    expect(queue.drops[0]).toHaveProperty("reportedAt");
    expect(queue.drops[0]).not.toHaveProperty("reportActors");
  });

  it("lets a moderator keep an anonymous-reported drop visible", async () => {
    const created = await post({ venueId: VENUE, handle: "reported-author", priceGbp: 4.2 });
    expect(created.status).toBe(201);
    const { drop } = await created.json();
    expect((await report(drop.id, "wrong price", "device-a")).status).toBe(200);

    expect((await modAction("restore", drop.id)).status).toBe(200);
    expect((await (await modGet("reported")).json()).drops).toHaveLength(0);
    expect((await (await get(VENUE)).json()).drops).toHaveLength(1);
  });

  it("reopens reported queue after a new report follows a moderator decision", async () => {
    const created = await post({ venueId: VENUE, handle: "reported-author", priceGbp: 4.2 });
    expect(created.status).toBe(201);
    const { drop } = await created.json();

    expect((await report(drop.id, "first report", "device-a")).status).toBe(200);
    expect((await modAction("restore", drop.id)).status).toBe(200);

    expect((await report(drop.id, "new report", "device-b")).status).toBe(200);
    const queue = (await (await modGet("reported")).json()).drops as Array<{ id: string }>;
    expect(queue.map((row) => row.id)).toContain(drop.id);
  });

  it("requeues a moderator-hidden decision without republishing it", async () => {
    const created = await post({ venueId: VENUE, handle: "reported-author", priceGbp: 4.2 });
    expect(created.status).toBe(201);
    const { drop } = await created.json();

    await signedReport(drop.id, "user-one", "first report", "device-a");
    await signedReport(drop.id, "user-two", "second report", "device-b");
    expect((await get(VENUE)).status).toBe(200);
    expect((await (await get(VENUE)).json()).drops).toHaveLength(0);

    expect((await modAction("keep_hidden", drop.id)).status).toBe(200);
    expect((await report(drop.id, "new evidence", "device-a")).status).toBe(200);

    expect((await (await get(VENUE)).json()).drops).toHaveLength(0);
    const queue = (await (await modGet("hidden")).json()).drops as Array<{ id: string }>;
    expect(queue.map((row) => row.id)).toContain(drop.id);
  });

  it("does not reopen an auto-hidden drop before moderator review", async () => {
    const created = await post({ venueId: VENUE, handle: "reported-author", priceGbp: 4.2 });
    expect(created.status).toBe(201);
    const { drop } = await created.json();

    await signedReport(drop.id, "user-one", "first report", "device-a");
    await signedReport(drop.id, "user-two", "second report", "device-b");
    expect((await (await get(VENUE)).json()).drops).toHaveLength(0);

    // Auto-hide is not a moderator decision. An anonymous report must keep the
    // drop hidden until a moderator explicitly restores or keeps it hidden.
    expect((await report(drop.id, "new evidence", "device-c")).status).toBe(200);
    expect((await (await get(VENUE)).json()).drops).toHaveLength(0);
    const hiddenQueue = (await (await modGet("hidden")).json()).drops as Array<{ id: string }>;
    expect(hiddenQueue.map((row) => row.id)).toContain(drop.id);
  });
});

describe("POST /api/pint-drops — daily duplicate guard (venue+identity+day)", () => {
  it("409s a second PRICED drop at the same venue by the same handle the same day", async () => {
    const first = await post({ venueId: "dedupe-pub", handle: "reg", priceGbp: 4.5 });
    expect(first.status).toBe(201);

    const second = await post({ venueId: "dedupe-pub", handle: "reg", priceGbp: 4.6 });
    expect(second.status).toBe(409);

    // Handle normalisation applies: "@Reg" is the same identity as "reg".
    const third = await post({ venueId: "dedupe-pub", handle: "@Reg", priceGbp: 5 });
    expect(third.status).toBe(409);
  });

  it("allows the same handle to price a DIFFERENT venue the same day", async () => {
    expect((await post({ venueId: "pub-a", handle: "reg", priceGbp: 4.5 })).status).toBe(201);
    expect((await post({ venueId: "pub-b", handle: "reg", priceGbp: 4.5 })).status).toBe(201);
  });

  it("allows a DIFFERENT handle to price the same venue the same day", async () => {
    expect((await post({ venueId: "shared-pub", handle: "reg", priceGbp: 4.5 })).status).toBe(201);
    expect((await post({ venueId: "shared-pub", handle: "other", priceGbp: 4.6 })).status).toBe(201);
  });

  it("does not block a note-only anecdote after a priced drop (a memory isn't a price)", async () => {
    expect((await post({ venueId: "note-pub", handle: "reg", priceGbp: 4.5 })).status).toBe(201);
    const note = await post({ venueId: "note-pub", handle: "reg", passedDownNote: "my old local" });
    expect(note.status).toBe(201);
  });

  it("answers the SAME refusal when the pre-check misses and the store refuses (0141)", async () => {
    expect((await post({ venueId: "burst-pub", handle: "reg", priceGbp: 4.5 })).status).toBe(201);

    const soft = await post({ venueId: "burst-pub", handle: "reg", priceGbp: 4.6 });
    expect(soft.status).toBe(409);
    const softBody = await soft.json();

    // The pre-check is fail-open by design, and that is the hole a concurrent
    // burst walks through: every request in flight reads "no price yet" before
    // any row lands. Make the lookup fail and the HARD guard has to answer -
    // the unique index on the Supabase backend, its mirror here - and it has to
    // answer with the same sentence and the same status, because the drinker
    // did the same thing either way.
    const precheck = vi
      .spyOn(memoryPintDropStore, "hasPricedDropToday")
      .mockRejectedValue(new Error("lookup unavailable"));
    try {
      const hard = await post({ venueId: "burst-pub", handle: "reg", priceGbp: 4.7 });
      expect(hard.status).toBe(409);
      expect(await hard.json()).toEqual(softBody);
    } finally {
      precheck.mockRestore();
    }

    // And the refusal kept the first observation rather than stacking a second.
    const drops = (await (await get("burst-pub")).json()).drops as Array<{ priceGbp: number }>;
    expect(drops.map((row) => row.priceGbp)).toEqual([4.5]);
  });
});

describe("validatePintDrop — vibe tags (server-authoritative allowlist)", () => {
  const base = { venueId: VENUE, handle: "ale", priceGbp: 4.2 };

  it("keeps allow-listed tags (case-insensitively)", () => {
    const result = validatePintDrop({ ...base, vibeTags: ["cheap", "Riverside", "LAST TRAIN"] });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.vibeTags).toEqual(["cheap", "riverside", "last train"]);
  });

  it("drops unknown/garbage tags — never trusts the client", () => {
    const result = validatePintDrop({
      ...base,
      vibeTags: ["cheap", "definitely-not-a-tag", "<script>", 42, null, "old local"],
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.vibeTags).toEqual(["cheap", "old local"]);
  });

  it("caps at 4 tags", () => {
    const result = validatePintDrop({
      ...base,
      vibeTags: ["cheap", "chaotic", "quiet pint", "old local", "date night", "riverside"],
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.vibeTags).toHaveLength(4);
  });

  it("dedupes repeated tags", () => {
    const result = validatePintDrop({ ...base, vibeTags: ["cheap", "cheap", "Cheap", "riverside"] });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.vibeTags).toEqual(["cheap", "riverside"]);
  });

  it("validates a drop with only vibe tags + a price (tags are not a standalone signal)", () => {
    const result = validatePintDrop({ venueId: VENUE, handle: "ale", priceGbp: 4.2, vibeTags: ["cheap"] });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.priceGbp).toBe(4.2);
      expect(result.value.vibeTags).toEqual(["cheap"]);
    }
  });

  it("still rejects a drop that has vibe tags but no price and no note", () => {
    // Vibe tags alone never satisfy the price-or-note requirement.
    const result = validatePintDrop({ venueId: VENUE, handle: "ale", vibeTags: ["cheap"] });
    expect(result.ok).toBe(false);
  });

  it("omits the vibeTags field entirely when none are valid (backward-compatible)", () => {
    const result = validatePintDrop({ ...base, vibeTags: ["nope"] });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).not.toHaveProperty("vibeTags");
  });

  it("threads valid tags through the route into the returned DTO", async () => {
    const res = await post({ ...base, vibeTags: ["cheap", "nope", "hidden gem"] });
    expect(res.status).toBe(201);
    const { drop } = await res.json();
    expect(drop.vibeTags).toEqual(["cheap", "hidden gem"]);
  });
});

describe("validatePintDrop — Last Train compose fields (Wave G1)", () => {
  const base = { venueId: VENUE, handle: "ale", priceGbp: 4.2 };
  const leaveBy = "2026-07-08T23:30:00.000Z";

  it("persists leaveByIso + lastTrainDecision when the decision is live", () => {
    const result = validatePintDrop({
      ...base,
      leaveByIso: leaveBy,
      lastTrainDecision: "order_one_more",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.leaveByIso).toBe(leaveBy);
      expect(result.value.lastTrainDecision).toBe("order_one_more");
    }
  });

  it("omits fields when TfL was unreachable (live_data_unavailable)", () => {
    const result = validatePintDrop({
      ...base,
      leaveByIso: leaveBy,
      lastTrainDecision: "live_data_unavailable",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).not.toHaveProperty("leaveByIso");
      expect(result.value).not.toHaveProperty("lastTrainDecision");
    }
  });

  it("omits fields when leaveByIso is missing", () => {
    const result = validatePintDrop({
      ...base,
      lastTrainDecision: "train_risk",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).not.toHaveProperty("leaveByIso");
      expect(result.value).not.toHaveProperty("lastTrainDecision");
    }
  });

  it("threads live fields through the route into the returned DTO", async () => {
    const res = await post({
      ...base,
      leaveByIso: leaveBy,
      lastTrainDecision: "half_pint_only",
    });
    expect(res.status).toBe(201);
    const { drop } = await res.json();
    expect(drop.leaveByIso).toBe(leaveBy);
    expect(drop.lastTrainDecision).toBe("half_pint_only");
  });
});

describe("GET + moderation", () => {
  it("lists a created drop, then hides it after two verified accounts report", async () => {
    const created = await post({ venueId: VENUE, handle: "ale", priceGbp: 4.2 });
    const { drop } = await created.json();

    const listed = await get(VENUE);
    expect(listed.status).toBe(200);
    expect((await listed.json()).drops).toHaveLength(1);

    const reported = await signedReport(drop.id, "user-one", undefined, "device-a");
    expect(reported.status).toBe(200);

    const afterFirstReport = await get(VENUE);
    expect((await afterFirstReport.json()).drops).toHaveLength(1);

    const secondReport = await signedReport(
      drop.id,
      "user-two",
      undefined,
      "device-b",
    );
    expect(secondReport.status).toBe(200);

    const afterThreshold = await get(VENUE);
    expect((await afterThreshold.json()).drops).toHaveLength(0);
  });

  it("lists all visible drops when venueId is omitted (organic + demo seeds)", async () => {
    await post({ venueId: "first", handle: "ale", priceGbp: 4.2 });
    await post({ venueId: "second", handle: "mild", passedDownNote: "my dad's old local" });

    const res = await get();
    expect(res.status).toBe(200);
    const { drops } = (await res.json()) as { drops: Array<{ provenance: string }> };
    // The two organic drops plus the seeded demo drops, all through one read path.
    expect(drops.filter((d) => d.provenance !== "demo")).toHaveLength(2);
    expect(drops.filter((d) => d.provenance === "demo").length).toBeGreaterThanOrEqual(8);
  });

  it("city-scopes and enriches non-London venue ids", async () => {
    const res = await post({ venueId: "venue-oxf-16404bl", handle: "oxale", priceGbp: 4.2 });
    expect(res.status).toBe(201);

    const listed = await GET(new Request(`${URL_BASE}?city=oxford`));
    expect(listed.status).toBe(200);
    const { drops } = (await listed.json()) as {
      drops: Array<{ venueId: string; venueName: string; venueMapUrl: string }>;
    };
    const oxfordDrop = drops.find((d) => d.venueId === "venue-oxf-16404bl");
    expect(oxfordDrop).toMatchObject({
      venueName: "Turf Tavern",
      venueMapUrl: "/map/oxford?sel=venue-oxf-16404bl",
    });
  });

  it("enriches a kept City pint through its canonical venue and legacy alias", async () => {
    const created = await post({ venueId: "venue-1sw9ofl", handle: "city_local", priceGbp: 6.5 });
    expect(created.status).toBe(201);
    const response = await get("venue-eltcmh");
    const { drops } = await response.json();
    expect(drops.filter((drop: { handle: string }) => drop.handle === "city_local"))
      .toMatchObject([{ venueId: "venue-eltcmh", borough: "City of London", priceGbp: 6.5 }]);
  });

  it("does not count a broad fallback or a non-London locality as a borough", async () => {
    await post({ venueId: VENUE, handle: "local", priceGbp: 4.2 });
    const response = await get(VENUE);
    expect((await response.json()).drops[0]).not.toHaveProperty("borough");
    await post({ venueId: "venue-oxf-16404bl", handle: "oxale", priceGbp: 4.2 });
    const oxford = await GET(new Request(`${URL_BASE}?city=oxford`));
    expect((await oxford.json()).drops[0]).not.toHaveProperty("borough");
  });

  it("refuses the in-memory store in production when Supabase is absent", async () => {
    // Flip the durable-store guard directly (the prod condition), leaving
    // isSupabaseConfigured false — this is the requiresSupabaseStore() &&
    // !isSupabaseConfigured() case that must 503. Driving it via the mocked
    // flag is deterministic under both a dev and a production build.
    supaGuard.requiresStore = true;

    const created = await post({ venueId: VENUE, handle: "ale", priceGbp: 4.2 });
    expect(created.status).toBe(503);
    expect(await created.json()).toEqual({
      error: "Pint Drop production storage is not configured.",
      code: "UNAVAILABLE",
      retryable: true,
    });

    const listed = await get(VENUE);
    expect(listed.status).toBe(503);
  });
});

describe("moderation loop", () => {
  async function createDrop(): Promise<string> {
    const res = await post({ venueId: VENUE, handle: "ale", priceGbp: 4.2 });
    return (await res.json()).drop.id as string;
  }

  it("records reportedAt + reportCount and hides at report threshold", async () => {
    const id = await createDrop();

    const res = await signedReport(id, "user-one", "wrong price", "device-a");
    expect(res.status).toBe(200);

    // First report records metadata but does not let one actor take down content.
    expect((await (await get(VENUE)).json()).drops).toHaveLength(1);

    const hidden = await signedReport(id, "user-two", undefined, "device-b");
    expect(hidden.status).toBe(200);

    // Gone from the public list after the threshold.
    expect((await (await get(VENUE)).json()).drops).toHaveLength(0);

    // Visible to the moderator queue with metadata.
    const queue = (await (await modGet("hidden")).json()).drops;
    expect(queue).toHaveLength(1);
    expect(queue[0].id).toBe(id);
    expect(queue[0].reportCount).toBe(2);
    expect(queue[0].reportReason).toBe("wrong price");
    expect(typeof queue[0].reportedAt).toBe("string");
  });

  it("restores a reported drop back to the public list", async () => {
    const id = await createDrop();
    await signedReport(id, "user-one", undefined, "device-a");
    await signedReport(id, "user-two", undefined, "device-b");

    const restored = await modAction("restore", id);
    expect(restored.status).toBe(200);

    // Back in the public list, gone from the queue.
    expect((await (await get(VENUE)).json()).drops).toHaveLength(1);
    expect((await (await modGet("hidden")).json()).drops).toHaveLength(0);
  });

  it("keeps a drop hidden after keep_hidden", async () => {
    const id = await createDrop();
    await signedReport(id, "user-one", undefined, "device-a");
    await signedReport(id, "user-two", undefined, "device-b");

    const kept = await modAction("keep_hidden", id);
    expect(kept.status).toBe(200);

    // Still hidden from the public list.
    expect((await (await get(VENUE)).json()).drops).toHaveLength(0);
    // Hidden decisions remain in the reversible moderator lane.
    expect((await (await modGet("hidden")).json()).drops).toHaveLength(1);
    expect((await modAction("restore", id)).status).toBe(200);
    expect((await (await get(VENUE)).json()).drops).toHaveLength(1);
  });

  it("403s moderator endpoints when ADMIN_TOKEN is unset outside dev/test (M3)", async () => {
    const id = await createDrop();
    await report(id);
    // Simulate a deployed env (e.g. a preview) with no ADMIN_TOKEN configured:
    // the gate must DENY, not fall open.
    vi.stubEnv("NODE_ENV", "production");
    delete process.env.ADMIN_TOKEN;

    expect((await modGet("hidden")).status).toBe(403);
    expect((await modAction("restore", id)).status).toBe(403);
    expect((await modAction("keep_hidden", id)).status).toBe(403);
  });

  it("rejects a query-string admin token — header-only auth (M2/P0)", async () => {
    const id = await createDrop();
    await report(id);
    vi.stubEnv("NODE_ENV", "production");
    process.env.ADMIN_TOKEN = "s3cret";

    // The valid token passed as a query param must NOT open the gate.
    const viaQuery = await GET(new Request(`${URL_BASE}?status=hidden&admin=s3cret`));
    expect(viaQuery.status).toBe(403);

    // The same token in the header clears the gate (store then 503s — Supabase
    // absent in production — but the 403 gate is passed).
    const viaHeader = await modGet("hidden", "s3cret");
    expect(viaHeader.status).not.toBe(403);
  });

  it("403s moderator endpoints in production without a valid token", async () => {
    const id = await createDrop();
    await report(id);
    vi.stubEnv("NODE_ENV", "production");
    process.env.ADMIN_TOKEN = "s3cret";

    expect((await modGet("hidden")).status).toBe(403);
    expect((await modAction("restore", id)).status).toBe(403);
    expect((await modAction("keep_hidden", id)).status).toBe(403);

    // A valid token gets through the gate (the store then 503s — Supabase absent
    // in production — but the point is the 403 gate is cleared).
    const withToken = await modGet("hidden", "s3cret");
    expect(withToken.status).not.toBe(403);
  });
});

describe("verified-account Pint Drop report counting", () => {
  it("accepts two anonymous reports without hiding the drop", async () => {
    const created = await post({ venueId: VENUE, handle: "ale", priceGbp: 4.2 });
    const { drop } = await created.json();

    vi.useFakeTimers();
    try {
      expect((await report(drop.id, "wrong price", "device-a")).status).toBe(200);
      vi.advanceTimersByTime(61_000);
      expect((await report(drop.id, "spam", "device-b")).status).toBe(200);

      const listed = (await (await get(VENUE)).json()).drops as Array<{
        reportCount?: number;
      }>;
      expect(listed).toHaveLength(1);
      expect(listed[0]).not.toHaveProperty("reportCount");
    } finally {
      vi.useRealTimers();
    }
  });

  it("hides the drop after two distinct verified accounts report", async () => {
    const created = await post({ venueId: VENUE, handle: "ale", priceGbp: 4.2 });
    const { drop } = await created.json();

    await signedReport(drop.id, "user-one", undefined, "device-a");
    await signedReport(drop.id, "user-two", undefined, "device-a");

    expect((await (await get(VENUE)).json()).drops).toHaveLength(0);
  });

  it("counts the same verified account once across report windows", async () => {
    const created = await post({ venueId: VENUE, handle: "ale", priceGbp: 4.2 });
    const { drop } = await created.json();

    vi.useFakeTimers();
    try {
      await signedReport(drop.id, "user-one", "wrong price", "device-a");
      vi.advanceTimersByTime(61_000);
      await signedReport(drop.id, "user-one", "spam", "device-b");

      const listed = (await (await get(VENUE)).json()).drops as Array<{
        reportCount?: number;
      }>;
      expect(listed).toHaveLength(1);
      expect(defined(listed[0]).reportCount).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("durable per-actor report uniqueness", () => {
  it("same-actor repeat report across rate-limit windows is an idempotent no-op", async () => {
    const created = await post({ venueId: VENUE, handle: "ale", priceGbp: 4.2 });
    const { drop } = await created.json();

    // Fake timers so we can jump PAST the 60s rate-limit window between the two
    // same-actor reports — the exact gap the windowed limiter can't cover and
    // the store-level ledger must (H1 across windows / limiter cold-start).
    vi.useFakeTimers();
    try {
      const first = await signedReport(drop.id, "user-one", "wrong price", "device-a");
      expect(first.status).toBe(200);

      // New rate-limit window: the per-actor windowed budget has reset, so this
      // duplicate reaches the store — which must treat it as an idempotent no-op.
      vi.advanceTimersByTime(61_000);
      const duplicate = await signedReport(
        drop.id,
        "user-one",
        "wrong price",
        "device-a",
      );
      expect(duplicate.status).toBe(200); // no-op, not an error

      // Count stayed at 1 (below threshold) and the drop is still visible.
      const listed = (await (await get(VENUE)).json()).drops as Array<{
        id: string;
        reportCount?: number;
      }>;
      expect(listed).toHaveLength(1);
      expect(defined(listed[0]).reportCount).toBe(1);

      // A DISTINCT actor's report is the second real one → threshold → hidden.
      vi.advanceTimersByTime(61_000);
      const second = await signedReport(drop.id, "user-two", undefined, "device-b");
      expect(second.status).toBe(200);
      expect((await (await get(VENUE)).json()).drops).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("memory path: reportPintDrop twice with one actorHash counts once", async () => {
    const created = await post({ venueId: VENUE, handle: "ale", priceGbp: 4.2 });
    const { drop } = await created.json();

    const firstIdentity: PintDropReportIdentity = {
      kind: "verified_account",
      actorHash: "hash-1",
    };
    expect(reportPintDrop(drop.id, "spam", firstIdentity)).toBe(true);
    expect(reportPintDrop(drop.id, "spam", firstIdentity)).toBe(true); // idempotent, still true

    // One counted report → still visible with reportCount 1.
    const listed = (await (await get(VENUE)).json()).drops as Array<{ reportCount?: number }>;
    expect(listed).toHaveLength(1);
    expect(defined(listed[0]).reportCount).toBe(1);

    // A different actorHash is the second real report → hidden.
    expect(
      reportPintDrop(drop.id, undefined, {
        kind: "verified_account",
        actorHash: "hash-2",
      }),
    ).toBe(true);
    expect((await (await get(VENUE)).json()).drops).toHaveLength(0);
  });
});

describe("supabasePintDropStore.report — v2 RPC seam", () => {
  function reportIdentity(actorHash: string): PintDropReportIdentity {
    return { kind: "verified_account", actorHash };
  }

  it("calls report_pint_drop_v2 with the actor hash", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 1, error: null });
    adminRef.client = { rpc };

    const ok = await supabasePintDropStore.report(
      "drop-1",
      "spam",
      reportIdentity("hash-abc"),
    );
    expect(ok).toBe(true);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("report_pint_drop_v2", {
      p_id: "drop-1",
      p_actor_hash: "hash-abc",
      p_reason: "spam",
      p_hide_threshold: 2,
    });
  });

  it("maps a null v2 result (unknown id) to false → route 404", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    adminRef.client = { rpc };
    expect(
      await supabasePintDropStore.report(
        "nope",
        undefined,
        reportIdentity("hash-abc"),
      ),
    ).toBe(false);
  });

  it("returns a retryable 503 when verified-account deduplication is unavailable", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "function report_pint_drop_v2 is unavailable" },
    });
    adminRef.client = { rpc };
    supaGuard.configured = true;

    const response = await signedReport("drop-1", "user-one", "spam", "device-a");

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      code: "STORE_UNAVAILABLE",
      retryable: true,
    });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("report_pint_drop_v2", expect.any(Object));
  });

});

describe("durable rate limiting (Supabase configured)", () => {
  beforeEach(() => {
    // Route writes through the Supabase store (mocked via storeCreate). The
    // route's store() picks it when isSupabaseConfigured() is true — driven by
    // the mocked flag now, not the raw env vars (kept for hashIp salting etc).
    supaGuard.configured = true;
    process.env.SUPABASE_URL = "https://stub.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "stub-key";
    storeCreate.mockReset();
    storeCreate.mockImplementation(async (drop) => ({
      ...(drop as Record<string, unknown>),
      pintPhotoUrl: null,
      venuePhotoUrl: null,
    }));
  });

  it("keys the durable limiter on handle + hashed IP, never the raw IP", async () => {
    checkRateLimitDurableDetailed.mockResolvedValue({ verdict: false });
    const form = new FormData();
    form.set("venueId", VENUE);
    form.set("handle", "Ale");
    form.set("priceGbp", "4");
    form.set("receipt_photo", jpegFile("bill.jpg"));
    const res = await POST(
      new Request(URL_BASE, {
        method: "POST",
        headers: { "x-forwarded-for": "203.0.113.7, 10.0.0.1" },
        body: form,
      }),
    );
    expect(res.status).toBe(201);
    expect(checkRateLimitDurableDetailed).toHaveBeenCalledTimes(1);
    const key = defined(checkRateLimitDurableDetailed.mock.calls[0])[0];
    expect(key).toContain("ale"); // handle (lowercased) is in the key
    expect(key).toMatch(/[0-9a-f]{64}$/); // ...plus the sha256 IP hash
    expect(key).not.toContain("203.0.113.7"); // raw IP never appears
  });

  it("429s a submission when the durable limiter says limited", async () => {
    checkRateLimitDurableDetailed.mockResolvedValue({ verdict: true });
    const res = await post({ venueId: VENUE, handle: "flooder", priceGbp: 4 });
    expect(res.status).toBe(429);
    expect(storeCreate).not.toHaveBeenCalled();
  });

  it("degrades to Math.min(limit, 3) in-memory when durable returns error", async () => {
    checkRateLimitDurableDetailed.mockResolvedValue({ verdict: null, reason: "error" });
    let last: Response | undefined;
    for (let i = 0; i < 4; i++) {
      last = await post({ venueId: VENUE, handle: "outage", priceGbp: 4 });
    }
    // Degraded budget is 3 — the 4th write is limited (fail-open, tighter).
    expect(last!.status).toBe(429);
  });

  it("degrades to Math.min(limit, 3) in-memory when durable returns missing-rpc", async () => {
    checkRateLimitDurableDetailed.mockResolvedValue({
      verdict: null,
      reason: "missing-rpc",
    });
    let last: Response | undefined;
    for (let i = 0; i < 4; i++) {
      last = await post({ venueId: VENUE, handle: "norpc", priceGbp: 4 });
    }
    // Degraded budget is 3 — the 4th write is limited (fail-open, tighter).
    expect(last!.status).toBe(429);
  });

  it("uses the full in-memory limit on no-client", async () => {
    checkRateLimitDurableDetailed.mockResolvedValue({
      verdict: null,
      reason: "no-client",
    });
    for (let i = 0; i < 8; i++) {
      const res = await post({ venueId: VENUE, handle: "noclient", priceGbp: 4 });
      expect(res.status).toBe(201);
    }
    const limited = await post({
      venueId: VENUE,
      handle: "noclient",
      priceGbp: 4,
    });
    expect(limited.status).toBe(429);
  });

  it("RATE_LIMIT_STRICT=1 returns 429 immediately when durable is unavailable", async () => {
    process.env.RATE_LIMIT_STRICT = "1";
    checkRateLimitDurableDetailed.mockResolvedValue({ verdict: null, reason: "error" });
    const res = await post({ venueId: VENUE, handle: "strict", priceGbp: 4 });
    expect(res.status).toBe(429);
    expect(storeCreate).not.toHaveBeenCalled();
  });
});

// ── A PHOTO WE CANNOT READ IS THE DRINKER'S TO FIX ────────────────────────────
//
// `uploadPhoto` refuses a file the normaliser cannot open, and it says so with
// a PhotoRefusalError. The route used to tell a refusal from an outage by the
// error's WORDS ("Photo must…"), so the one refusal whose sentence starts
// differently, the unreadable image, fell through to a RETRYABLE 503: the app
// invited a drinker to send the same bytes again, which can never work, and an
// RLS suite reading 503 over a valid permission read it as a broken rule.
//
// The class is the answer, not the sentence.
describe("a photo we cannot read", () => {
  beforeEach(() => {
    supaGuard.configured = true;
    process.env.SUPABASE_URL = "https://stub.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "stub-key";
    storeCreate.mockReset();
  });

  it("is refused in one line the drinker can act on, and never retried", async () => {
    storeCreate.mockRejectedValue(new PhotoRefusalError(UNREADABLE_PHOTO_REFUSAL));

    const res = await post({ venueId: VENUE, handle: "blurry", priceGbp: 4.2 });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: UNREADABLE_PHOTO_REFUSAL,
      code: "INVALID_REQUEST",
      retryable: false,
    });
  });

  it("is still told apart from a storage outage, which IS ours and IS retryable", async () => {
    storeCreate.mockRejectedValue(new Error("supabase storage exploded"));

    const res = await post({ venueId: VENUE, handle: "unlucky", priceGbp: 4.2 });

    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ retryable: true });
  });
});
