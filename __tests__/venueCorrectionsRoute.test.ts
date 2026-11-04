import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false, requiresSupabaseStore: () => false };
});

const identityState = vi.hoisted(() => ({
  resolution: {
    ok: true as const,
    accountId: "a1111111-1111-4111-8111-111111111111",
    actor: "profile:alice",
    handle: "alice",
  } as import("@/lib/contributionIdentity.server").ContributionIdentityResolution,
}));

vi.mock("@/lib/contributionIdentity.server", () => ({
  resolveContributionIdentity: async () => identityState.resolution,
}));

// The venue door is the shared community-write resolver; here it knows two pubs.
vi.mock("@/lib/venueWriteTarget.server", () => ({
  resolveWritableVenueId: async (venueId: string) =>
    venueId === "venue-crown" || venueId === "venue-uk-n1"
      ? { ok: true, venueId }
      : { ok: false, status: 400, error: "Pick a venue from the map." },
}));

vi.mock("@/lib/venueIndex", () => ({
  resolveStoredVenue: async (id: string) => (id === "venue-crown" ? { id, name: "The Crown" } : null),
}));

const moderatorState = vi.hoisted(() => ({ moderator: false }));

vi.mock("@/lib/adminAuth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/adminAuth")>();
  return { ...actual, isModerator: () => moderatorState.moderator, moderatorStaffRoleId: () => null };
});

import { GET as adminGET, PATCH as adminPATCH } from "@/app/api/admin/venue-corrections/route";
import { POST } from "@/app/api/venue-corrections/route";
import { __resetPintDrops } from "@/lib/pintDrops";
import { __resetVenueCorrections, memoryVenueCorrectionsStore } from "@/lib/venueCorrectionsStore";

const ALICE = "a1111111-1111-4111-8111-111111111111";

let ipCounter = 0;
function nextIp(): string {
  ipCounter += 1;
  return `203.0.113.${ipCounter % 250}`;
}

function post(body: unknown): Request {
  return new Request("http://localhost/api/venue-corrections", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": nextIp() },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function admin(method: "GET" | "PATCH", body?: unknown, query = ""): Request {
  return new Request(`http://localhost/api/admin/venue-corrections${query}`, {
    method,
    headers: { "content-type": "application/json", "x-forwarded-for": nextIp() },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  __resetVenueCorrections();
  __resetPintDrops();
  moderatorState.moderator = false;
  identityState.resolution = { ok: true, accountId: ALICE, actor: "profile:alice", handle: "alice" };
});

describe("POST /api/venue-corrections", () => {
  it("stores a note against a known pub, owned by the session and never the body", async () => {
    const res = await POST(post({ venueId: "venue-crown", kind: "closed", note: "Shut since May.", ownerUserId: "someone-else" }));
    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toContain("no-store");
    const body = await res.json();
    expect(body).toMatchObject({ stored: true, correction: { kind: "closed", status: "open" } });
    const rows = await memoryVenueCorrectionsStore.listForReview("open");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ venueId: "venue-crown", ownerUserId: ALICE, note: "Shut since May." });
  });

  it("refuses an anonymous caller with sign_in_required and writes nothing", async () => {
    identityState.resolution = {
      ok: false,
      body: { status: "sign_in_required", error: "Sign in to contribute." },
      httpStatus: 401,
    };
    const res = await POST(post({ venueId: "venue-crown", kind: "closed" }));
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ status: "sign_in_required" });
    expect(await memoryVenueCorrectionsStore.listForReview("open")).toEqual([]);
  });

  it("refuses an account with no handle with onboarding_required and writes nothing", async () => {
    identityState.resolution = {
      ok: false,
      accountId: ALICE,
      body: { status: "onboarding_required", error: "Choose a public handle before contributing." },
      httpStatus: 409,
    };
    const res = await POST(post({ venueId: "venue-crown", kind: "hours" }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ status: "onboarding_required" });
    expect(await memoryVenueCorrectionsStore.listForReview("open")).toEqual([]);
  });

  it("refuses a kind outside the closed set, a long note and a malformed body", async () => {
    const unknownKind = await POST(post({ venueId: "venue-crown", kind: "rude-barman" }));
    expect(unknownKind.status).toBe(400);
    expect(await unknownKind.json()).toMatchObject({ code: "INVALID_VENUE_CORRECTION", details: { field: "kind" } });

    const longNote = await POST(post({ venueId: "venue-crown", kind: "other", note: "x".repeat(201) }));
    expect(longNote.status).toBe(400);

    const malformed = await POST(post("{not json"));
    expect(malformed.status).toBe(400);
    expect(await memoryVenueCorrectionsStore.listForReview("open")).toEqual([]);
  });

  it("refuses a venue neither the index nor the UK base holds", async () => {
    const res = await POST(post({ venueId: "venue-made-up", kind: "closed" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Pick a venue from the map.");
    expect(await memoryVenueCorrectionsStore.listForReview("open")).toEqual([]);
  });

  it("stores nothing for a price and points the client at the log flow", async () => {
    const res = await POST(post({ venueId: "venue-crown", kind: "price" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ stored: false, next: "price_log" });
    expect(await memoryVenueCorrectionsStore.listForReview("open")).toEqual([]);
  });

  it("caps one account at ten notes an hour", async () => {
    for (let index = 0; index < 10; index += 1) {
      const res = await POST(post({ venueId: "venue-crown", kind: "other", note: `note ${index}` }));
      expect(res.status, `note ${index}`).toBe(201);
    }
    const eleventh = await POST(post({ venueId: "venue-crown", kind: "other" }));
    expect(eleventh.status).toBe(429);
    expect(await eleventh.json()).toMatchObject({ code: "RATE_LIMITED" });
    expect(await memoryVenueCorrectionsStore.listForReview("open")).toHaveLength(10);
  });
});

describe("/api/admin/venue-corrections", () => {
  it("refuses a caller who is not a moderator, at the read and the verdict", async () => {
    const created = await memoryVenueCorrectionsStore.create({
      venueId: "venue-crown",
      kind: "closed",
      note: "",
      ownerUserId: ALICE,
    });
    expect((await adminGET(admin("GET"))).status).toBe(403);
    expect((await adminPATCH(admin("PATCH", { id: created.id, status: "resolved" }))).status).toBe(403);
    expect((await memoryVenueCorrectionsStore.getById(created.id))?.status).toBe("open");
  });

  it("lists open notes newest first with the pub's name and no reporter", async () => {
    moderatorState.moderator = true;
    await memoryVenueCorrectionsStore.create({ venueId: "venue-crown", kind: "hours", note: "older", ownerUserId: ALICE }, 1_000);
    await memoryVenueCorrectionsStore.create({ venueId: "venue-uk-gone", kind: "closed", note: "newer", ownerUserId: ALICE }, 2_000);
    const res = await adminGET(admin("GET"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.corrections.map((row: { note: string }) => row.note)).toEqual(["newer", "older"]);
    expect(body.corrections[1]).toMatchObject({ venueName: "The Crown", kind: "hours" });
    expect(body.corrections[0].venueName).toBeNull();
    expect(JSON.stringify(body)).not.toContain(ALICE);
  });

  it("resolves or dismisses an open note once, and a second tap is 409", async () => {
    moderatorState.moderator = true;
    const created = await memoryVenueCorrectionsStore.create({ venueId: "venue-crown", kind: "closed", note: "", ownerUserId: ALICE });
    const resolved = await adminPATCH(admin("PATCH", { id: created.id, status: "resolved" }));
    expect(resolved.status).toBe(200);
    expect(await memoryVenueCorrectionsStore.getById(created.id)).toMatchObject({ status: "resolved", resolvedBy: "admin" });
    expect((await adminPATCH(admin("PATCH", { id: created.id, status: "dismissed" }))).status).toBe(409);

    expect((await adminPATCH(admin("PATCH", { id: created.id, status: "open" }))).status).toBe(400);
    expect((await adminPATCH(admin("PATCH", { id: "not-a-uuid", status: "resolved" }))).status).toBe(404);
  });
});
