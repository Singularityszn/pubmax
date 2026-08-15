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
vi.mock("@/lib/venueAliases", () => ({
  resolveCanonicalVenueId: async (id: string) =>
    id === "legacy-pub"
      ? "canonical-pub"
      : id === "legacy-bar"
        ? "bar-test"
        : id,
}));
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
          borough: id === "venue-oxf-16404bl" ? "Oxford" : "London",
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
vi.mock("@/lib/profileOwnership", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/profileOwnership")>();
  return {
    ...actual,
    gateHandleAction: async (_request: Request, handle: string) => ({
      allowed: true as const,
      callerUserId: null,
      handle,
    }),
  };
});

import { GET, POST } from "@/app/api/pint-drops/route";
import {
  __resetPintDrops,
  dropMatchesCityScope,
  reportPintDrop,
  type PintDropReportIdentity,
  validatePintDrop,
} from "@/lib/pintDrops";
import { supabasePintDropStore } from "@/lib/pintDropsStore";

const URL_BASE = "http://localhost/api/pint-drops";

function post(body: unknown): Promise<Response> {
  return POST(new Request(URL_BASE, { method: "POST", body: JSON.stringify(body) }));
}

function get(venueId?: string): Promise<Response> {
  const url = venueId ? `${URL_BASE}?venueId=${encodeURIComponent(venueId)}` : URL_BASE;
  return GET(new Request(url));
}

// The counted reporter identity is SERVER-DERIVED (a verified account id, else
// the salted hash of IP alone), so a `device` here is a different
// CLIENT rather than a different string in the body. The per-actor budget is 1
// report per drop per window (H1), and REPORT_HIDE_THRESHOLD (2) therefore needs
// two genuinely different clients. The body's own `actor` field decides nothing.
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
  delete process.env.RATE_LIMIT_STRICT;
});

afterAll(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/pint-drops (create)", () => {
  it("accepts a priced drop as a contributor", async () => {
    const res = await post({ venueId: VENUE, handle: "ale", priceGbp: 4.2 });
    expect(res.status).toBe(201);
    const { drop } = await res.json();
    expect(drop.provenance).toBe("contributor");
    expect(drop.status).toBe("visible");
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
    const res = await POST(
      new Request(URL_BASE, {
        method: "POST",
        body: JSON.stringify({ ...base, vibeTags: ["cheap", "nope", "hidden gem"] }),
      }),
    );
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
    const res = await POST(
      new Request(URL_BASE, {
        method: "POST",
        body: JSON.stringify({
          ...base,
          leaveByIso: leaveBy,
          lastTrainDecision: "half_pint_only",
        }),
      }),
    );
    expect(res.status).toBe(201);
    const { drop } = await res.json();
    expect(drop.leaveByIso).toBe(leaveBy);
    expect(drop.lastTrainDecision).toBe("half_pint_only");
  });
});

describe("GET + moderation", () => {
  it("lists a created drop, then hides it after report threshold (two DISTINCT actors)", async () => {
    const created = await post({ venueId: VENUE, handle: "ale", priceGbp: 4.2 });
    const { drop } = await created.json();

    const listed = await get(VENUE);
    expect(listed.status).toBe(200);
    expect((await listed.json()).drops).toHaveLength(1);

    // First actor reports.
    const reported = await report(drop.id, undefined, "device-a");
    expect(reported.status).toBe(200);

    const afterFirstReport = await get(VENUE);
    expect((await afterFirstReport.json()).drops).toHaveLength(1);

    // A DIFFERENT actor reports → threshold (2) reached → hidden.
    const secondReport = await report(drop.id, undefined, "device-b");
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

    const res = await report(id, "wrong price", "device-a");
    expect(res.status).toBe(200);

    // First report records metadata but does not let one actor take down content.
    expect((await (await get(VENUE)).json()).drops).toHaveLength(1);

    const hidden = await report(id, undefined, "device-b");
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
    await report(id, undefined, "device-a");
    await report(id, undefined, "device-b");

    const restored = await modAction("restore", id);
    expect(restored.status).toBe(200);

    // Back in the public list, gone from the queue.
    expect((await (await get(VENUE)).json()).drops).toHaveLength(1);
    expect((await (await modGet("hidden")).json()).drops).toHaveLength(0);
  });

  it("keeps a drop hidden after keep_hidden", async () => {
    const id = await createDrop();
    await report(id, undefined, "device-a");
    await report(id, undefined, "device-b");

    const kept = await modAction("keep_hidden", id);
    expect(kept.status).toBe(200);

    // Still hidden from the public list.
    expect((await (await get(VENUE)).json()).drops).toHaveLength(0);
    // But reviewed, so it is no longer in the moderation queue.
    expect((await (await modGet("hidden")).json()).drops).toHaveLength(0);
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

// The counted identity is the server's, never the caller's. One person sending
// `actor:"a"` then `actor:"b"` used to reach REPORT_HIDE_THRESHOLD on their own
// and hide anybody's drop, while the comment beside the code claimed two
// DIFFERENT actors were required.
describe("a report is counted under a SERVER-derived identity", () => {
  function reportAs(
    id: string,
    headers: Record<string, string>,
    actor: string,
  ): Promise<Response> {
    return POST(
      new Request(URL_BASE, {
        method: "POST",
        headers,
        body: JSON.stringify({ action: "report", id, actor }),
      }),
    );
  }

  it("counts ONE report when one client sends two different actor strings", async () => {
    const created = await post({ venueId: VENUE, handle: "ale", priceGbp: 4.2 });
    const { drop } = await created.json();
    const sameClient = {
      "x-forwarded-for": "203.0.113.99",
      "user-agent": "Mozilla/5.0 (one attacker)",
    };

    vi.useFakeTimers();
    try {
      expect((await reportAs(drop.id, sameClient, "a")).status).toBe(200);
      // Past the per-actor window, so only the durable identity can refuse it.
      vi.advanceTimersByTime(61_000);
      expect((await reportAs(drop.id, sameClient, "b")).status).toBe(200);

      const listed = (await (await get(VENUE)).json()).drops as Array<{
        reportCount?: number;
      }>;
      // Still visible, still one report: the drop was NOT hidden.
      expect(listed).toHaveLength(1);
      expect(listed[0].reportCount).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("counts ONE report when one IP changes its user agent", async () => {
    const created = await post({ venueId: VENUE, handle: "ale", priceGbp: 4.2 });
    const { drop } = await created.json();

    vi.useFakeTimers();
    try {
      await reportAs(drop.id, { "x-forwarded-for": "203.0.113.99", "user-agent": "one" }, "a");
      vi.advanceTimersByTime(61_000);
      await reportAs(drop.id, { "x-forwarded-for": "203.0.113.99", "user-agent": "two" }, "a");

      const listed = (await (await get(VENUE)).json()).drops as Array<{
        reportCount?: number;
      }>;
      expect(listed).toHaveLength(1);
      expect(listed[0].reportCount).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("counts two different IPs and hides the drop", async () => {
    const created = await post({ venueId: VENUE, handle: "ale", priceGbp: 4.2 });
    const { drop } = await created.json();

    vi.useFakeTimers();
    try {
      await reportAs(drop.id, { "x-forwarded-for": "203.0.113.10" }, "a");
      vi.advanceTimersByTime(61_000);
      await reportAs(drop.id, { "x-forwarded-for": "203.0.113.20" }, "a");

      expect((await (await get(VENUE)).json()).drops).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("counts once when one client reports anonymously then signs in", async () => {
    const created = await post({ venueId: VENUE, handle: "ale", priceGbp: 4.2 });
    const { drop } = await created.json();
    const sameClient = { "x-forwarded-for": "203.0.113.99" };

    vi.useFakeTimers();
    try {
      await reportAs(drop.id, sameClient, "anonymous");
      vi.advanceTimersByTime(61_000);
      reportAuth.userId = "user-one";
      await reportAs(drop.id, sameClient, "signed-in");

      const listed = (await (await get(VENUE)).json()).drops as Array<{
        reportCount?: number;
      }>;
      expect(listed).toHaveLength(1);
      expect(listed[0].reportCount).toBe(1);
    } finally {
      reportAuth.userId = null;
      vi.useRealTimers();
    }
  });

  it("counts once when one client reports signed in then anonymously", async () => {
    const created = await post({ venueId: VENUE, handle: "ale", priceGbp: 4.2 });
    const { drop } = await created.json();
    const sameClient = { "x-forwarded-for": "203.0.113.99" };

    vi.useFakeTimers();
    try {
      reportAuth.userId = "user-one";
      await reportAs(drop.id, sameClient, "signed-in");
      vi.advanceTimersByTime(61_000);
      reportAuth.userId = null;
      await reportAs(drop.id, sameClient, "anonymous");

      const listed = (await (await get(VENUE)).json()).drops as Array<{
        reportCount?: number;
      }>;
      expect(listed).toHaveLength(1);
      expect(listed[0].reportCount).toBe(1);
    } finally {
      reportAuth.userId = null;
      vi.useRealTimers();
    }
  });

  it("counts two verified accounts sharing one IP", async () => {
    const created = await post({ venueId: VENUE, handle: "ale", priceGbp: 4.2 });
    const { drop } = await created.json();
    const sharedIp = { "x-forwarded-for": "203.0.113.99" };

    vi.useFakeTimers();
    try {
      reportAuth.userId = "user-one";
      await reportAs(drop.id, sharedIp, "first-account");
      vi.advanceTimersByTime(61_000);
      reportAuth.userId = "user-two";
      await reportAs(drop.id, sharedIp, "second-account");

      expect((await (await get(VENUE)).json()).drops).toHaveLength(0);
    } finally {
      reportAuth.userId = null;
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
      const first = await report(drop.id, "wrong price", "device-a");
      expect(first.status).toBe(200);

      // New rate-limit window: the per-actor windowed budget has reset, so this
      // duplicate reaches the store — which must treat it as an idempotent no-op.
      vi.advanceTimersByTime(61_000);
      const duplicate = await report(drop.id, "wrong price", "device-a");
      expect(duplicate.status).toBe(200); // no-op, not an error

      // Count stayed at 1 (below threshold) and the drop is still visible.
      const listed = (await (await get(VENUE)).json()).drops as Array<{
        id: string;
        reportCount?: number;
      }>;
      expect(listed).toHaveLength(1);
      expect(listed[0].reportCount).toBe(1);

      // A DISTINCT actor's report is the second real one → threshold → hidden.
      vi.advanceTimersByTime(61_000);
      const second = await report(drop.id, undefined, "device-b");
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
      primaryActorHash: "hash-1",
      ipActorHash: "hash-1",
    };
    expect(reportPintDrop(drop.id, "spam", firstIdentity)).toBe(true);
    expect(reportPintDrop(drop.id, "spam", firstIdentity)).toBe(true); // idempotent, still true

    // One counted report → still visible with reportCount 1.
    const listed = (await (await get(VENUE)).json()).drops as Array<{ reportCount?: number }>;
    expect(listed).toHaveLength(1);
    expect(listed[0].reportCount).toBe(1);

    // A different actorHash is the second real report → hidden.
    expect(
      reportPintDrop(drop.id, undefined, {
        primaryActorHash: "hash-2",
        ipActorHash: "hash-2",
      }),
    ).toBe(true);
    expect((await (await get(VENUE)).json()).drops).toHaveLength(0);
  });
});

describe("supabasePintDropStore.report — v2 RPC seam", () => {
  function reportIdentity(
    primaryActorHash: string,
    ipActorHash = primaryActorHash,
  ): PintDropReportIdentity {
    return { primaryActorHash, ipActorHash };
  }

  function reportAdmin(rpc: ReturnType<typeof vi.fn>) {
    const ledger = new Map<string, { actor_hash: string; details: string | null }>();
    return {
      rpc,
      from: (table: string) =>
        table === "pint_drop_reports"
          ? {
              select: () => ({
                eq: () => ({
                  in: async (_column: string, hashes: string[]) => ({
                    data: hashes.flatMap((hash) => {
                      const row = ledger.get(hash);
                      return row ? [row] : [];
                    }),
                    error: null,
                  }),
                }),
              }),
              upsert: async (row: {
                actor_hash: string;
                details: string | null;
              }) => {
                if (!ledger.has(row.actor_hash)) ledger.set(row.actor_hash, row);
                return { error: null };
              },
            }
          : {},
    };
  }

  it("calls report_pint_drop_v2 with the actor hash", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 1, error: null });
    adminRef.client = reportAdmin(rpc);

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
    adminRef.client = reportAdmin(rpc);
    expect(
      await supabasePintDropStore.report(
        "nope",
        undefined,
        reportIdentity("hash-abc"),
      ),
    ).toBe(false);
  });

  it("falls back to report_pint_drop when the v2 RPC errors (migration 0017 not applied)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const rpc = vi
        .fn()
        .mockResolvedValueOnce({
          data: null,
          error: { message: "function report_pint_drop_v2 does not exist" },
        })
        .mockResolvedValueOnce({ data: 1, error: null });
      adminRef.client = reportAdmin(rpc);

      const ok = await supabasePintDropStore.report(
        "drop-1",
        "spam",
        reportIdentity("hash-abc"),
      );
      expect(ok).toBe(true);
      expect(rpc).toHaveBeenCalledTimes(2);
      expect(rpc.mock.calls[0][0]).toBe("report_pint_drop_v2");
      expect(rpc.mock.calls[1][0]).toBe("report_pint_drop");
      // The v1 fallback carries no actor hash (0004's signature has none).
      expect(rpc.mock.calls[1][1]).toEqual({
        p_id: "drop-1",
        p_reason: "spam",
        p_hide_threshold: 2,
      });
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("deduplicates both authentication-transition orders in the durable ledger", async () => {
    const anonymous = reportIdentity("ip-hash");
    const signedIn = reportIdentity("user-hash", "ip-hash");

    const anonymousFirstRpc = vi.fn().mockResolvedValue({ data: 1, error: null });
    adminRef.client = reportAdmin(anonymousFirstRpc);
    expect(await supabasePintDropStore.report("drop-1", undefined, anonymous)).toBe(
      true,
    );
    expect(await supabasePintDropStore.report("drop-1", undefined, signedIn)).toBe(
      true,
    );
    expect(anonymousFirstRpc).toHaveBeenCalledTimes(1);

    const signedFirstRpc = vi.fn().mockResolvedValue({ data: 1, error: null });
    adminRef.client = reportAdmin(signedFirstRpc);
    expect(await supabasePintDropStore.report("drop-1", undefined, signedIn)).toBe(
      true,
    );
    expect(await supabasePintDropStore.report("drop-1", undefined, anonymous)).toBe(
      true,
    );
    expect(signedFirstRpc).toHaveBeenCalledTimes(1);
  });

  it("counts two verified accounts that share one IP", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 1, error: null });
    adminRef.client = reportAdmin(rpc);

    await supabasePintDropStore.report(
      "drop-1",
      undefined,
      reportIdentity("user-one", "ip-hash"),
    );
    await supabasePintDropStore.report(
      "drop-1",
      undefined,
      reportIdentity("user-two", "ip-hash"),
    );

    expect(rpc).toHaveBeenCalledTimes(2);
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
    const res = await POST(
      new Request(URL_BASE, {
        method: "POST",
        headers: { "x-forwarded-for": "203.0.113.7, 10.0.0.1" },
        body: JSON.stringify({ venueId: VENUE, handle: "Ale", priceGbp: 4 }),
      }),
    );
    expect(res.status).toBe(201);
    expect(checkRateLimitDurableDetailed).toHaveBeenCalledTimes(1);
    const key = checkRateLimitDurableDetailed.mock.calls[0][0];
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

  it("uses the full in-memory limit on missing-rpc (migration may be absent)", async () => {
    checkRateLimitDurableDetailed.mockResolvedValue({
      verdict: null,
      reason: "missing-rpc",
    });
    // Default RATE_LIMIT is 8 — four writes must still succeed (not the
    // degraded cap of 3). The 9th is limited.
    for (let i = 0; i < 8; i++) {
      const res = await post({ venueId: VENUE, handle: "norpc", priceGbp: 4 });
      expect(res.status).toBe(201);
    }
    const limited = await post({ venueId: VENUE, handle: "norpc", priceGbp: 4 });
    expect(limited.status).toBe(429);
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
