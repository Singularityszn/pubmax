// The two doors a confirmation may come through, at the route (#1354).
//
// A confirmation is what turns a Pint Drop into something the public Index may
// cite, so who is allowed to mint one matters as much as when. A drinker's own
// report can complete a pair and never mint one on demand; the moderator door
// is a moderator door.
//
// FORCE the memory path: clear Supabase env so the store uses the in-memory
// backend deterministically offline (repo convention, see dropVisibility.test.ts).

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return {
    ...actual,
    isSupabaseConfigured: () => false,
    requiresSupabaseStore: () => false,
  };
});
vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));
vi.mock("@/lib/authServer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authServer")>();
  return {
    ...actual,
    callerUserId: vi.fn().mockResolvedValue(null),
  };
});
// The real gate opens in dev/test when ADMIN_TOKEN is unset, which would make
// "a stranger is refused" untestable. Read the header directly instead.
vi.mock("@/lib/adminAuth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/adminAuth")>();
  return {
    ...actual,
    isModerator: (request: Request): boolean =>
      request.headers.get("x-admin-token") === "moderator-token",
  };
});

import { GET, POST } from "@/app/api/pint-drops/route";
import { __resetPintDrops, addPintDrop, type PintDrop } from "@/lib/pintDrops";

const VENUE = "venue-confirm-route";

function drop(overrides: Partial<PintDrop> & { id: string }): PintDrop {
  return {
    venueId: VENUE,
    handle: "karan",
    drink: "Pint",
    priceGbp: 4.2,
    passedDownNote: "",
    era: "",
    provenance: "contributor",
    status: "visible",
    visibility: "public",
    createdAt: new Date().toISOString(),
    ...overrides,
  } as PintDrop;
}

function post(body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return POST(
    new Request("http://localhost/api/pint-drops", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  __resetPintDrops();
});

afterAll(() => {
  vi.unstubAllEnvs();
});

describe("the moderator confirm door", () => {
  it("mints an id for a moderator and refuses a stranger", async () => {
    addPintDrop(drop({ id: "solo", authorityKey: "key-one" }));

    const refused = await post({ action: "confirm", id: "solo" });
    expect(refused.status).toBe(403);

    const allowed = await post(
      { action: "confirm", id: "solo" },
      { "x-admin-token": "moderator-token" },
    );
    expect(allowed.status).toBe(200);
    const body = (await allowed.json()) as {
      confirmation: { confirmationId: string; basis: string; confirmingDropId?: string };
    };
    expect(body.confirmation.basis).toBe("moderator");
    expect(body.confirmation.confirmationId).toMatch(/[0-9a-f-]{36}/);
    expect(body.confirmation.confirmingDropId).toBeUndefined();
  });

  it("refuses a second confirmation and an unknown drop the same way", async () => {
    addPintDrop(drop({ id: "solo", authorityKey: "key-one" }));
    const headers = { "x-admin-token": "moderator-token" };
    expect((await post({ action: "confirm", id: "solo" }, headers)).status).toBe(200);
    // Nothing left to decide is a 409, not a silent 200 that would read as a
    // fresh decision in the moderator's own log.
    expect((await post({ action: "confirm", id: "solo" }, headers)).status).toBe(409);
    expect((await post({ action: "confirm", id: "nobody" }, headers)).status).toBe(409);
  });
});

describe("the confirmed review lane", () => {
  it("is a moderator read, and lists the confirmed rows", async () => {
    addPintDrop(drop({ id: "solo", authorityKey: "key-one" }));
    await post({ action: "confirm", id: "solo" }, { "x-admin-token": "moderator-token" });

    const stranger = await GET(
      new Request("http://localhost/api/pint-drops?status=confirmed"),
    );
    expect(stranger.status).toBe(403);

    const moderator = await GET(
      new Request("http://localhost/api/pint-drops?status=confirmed", {
        headers: { "x-admin-token": "moderator-token" },
      }),
    );
    expect(moderator.status).toBe(200);
    const body = (await moderator.json()) as {
      drops: Array<{ id: string; confirmation?: { basis: string } }>;
    };
    expect(body.drops.map((row) => row.id)).toEqual(["solo"]);
    expect(body.drops[0]?.confirmation?.basis).toBe("moderator");
  });
});
