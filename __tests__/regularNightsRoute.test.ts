// A regular night a drinker added (E4): the write door, "still on", the public
// read and the moderator queue. The contribution gate, the venue door and the
// photo journey are the shared seams, doubled here; the store is the real
// process-memory backend.

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

vi.mock("@/lib/venueIndex", () => ({
  resolveStoredVenue: async (id: string) => (id === "venue-crown" ? { id, name: "The Crown" } : null),
}));

vi.mock("@/lib/profileStore", () => ({
  profileStore: () => ({
    getHandleByUserId: async (userId: string) =>
      userId === "a1111111-1111-4111-8111-111111111111" ? "alice" : null,
  }),
}));

const mediaState = vi.hoisted(() => ({ stored: [] as string[], removed: [] as string[] }));
vi.mock("@/lib/regularNightReportMedia.server", () => {
  class RegularNightBoardError extends Error {
    constructor(public readonly code: string, message: string) {
      super(message);
    }
  }
  return {
    REGULAR_NIGHT_BOARD_MAX_BYTES: 10 * 1024 * 1024,
    RegularNightBoardError,
    storeRegularNightBoard: async (file: File, reporter: string, reportId: string) => {
      if (file.type === "application/pdf") {
        throw new RegularNightBoardError("INVALID_TYPE", "The photo must be a JPEG, PNG, or WebP image.");
      }
      const key = `regular-night-boards/${reporter}/${reportId}.jpg`;
      mediaState.stored.push(key);
      return key;
    },
    removeRegularNightBoard: async (key: string) => {
      mediaState.removed.push(key);
    },
    signRegularNightBoard: async (key: string) => `https://signed.example/${key}`,
  };
});

const moderatorState = vi.hoisted(() => ({ moderator: false }));
vi.mock("@/lib/adminAuth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/adminAuth")>();
  return { ...actual, isModerator: () => moderatorState.moderator, moderatorStaffRoleId: () => null };
});

import { GET as adminGET, PATCH as adminPATCH } from "@/app/api/admin/regular-nights/route";
import { GET, PATCH, POST } from "@/app/api/regular-nights/route";
import { __resetPintDrops } from "@/lib/pintDrops";
import {
  __resetRegularNightReports,
  memoryRegularNightReportsStore,
} from "@/lib/regularNightReportsStore";

const SIGNED_IN_ALICE: Resolution = { ok: true, accountId: ALICE, actor: "profile:alice", handle: "alice" };
const SIGNED_IN_BOB: Resolution = { ok: true, accountId: BOB, actor: "profile:bob", handle: "bob" };

let ipCounter = 0;
function nextIp(): string {
  ipCounter += 1;
  return `203.0.113.${ipCounter % 250}`;
}

function photo(type = "image/jpeg"): File {
  return new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], "board.jpg", { type });
}

function report(fields: Record<string, string | File | undefined>): Request {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) form.set(key, value);
  }
  return new Request("http://localhost/api/regular-nights", {
    method: "POST",
    headers: { "x-forwarded-for": nextIp() },
    body: form,
  });
}

const GOOD = { venueId: "venue-crown", kind: "quiz", weekday: "2", startTime: "20:00", note: "Teams of six." };

function stillOn(id: string): Request {
  return new Request("http://localhost/api/regular-nights", {
    method: "PATCH",
    headers: { "content-type": "application/json", "x-forwarded-for": nextIp() },
    body: JSON.stringify({ id }),
  });
}

function read(query: string): Request {
  return new Request(`http://localhost/api/regular-nights${query}`, { headers: { "x-forwarded-for": nextIp() } });
}

function admin(method: "GET" | "PATCH", body?: unknown): Request {
  return new Request("http://localhost/api/admin/regular-nights", {
    method,
    headers: { "content-type": "application/json", "x-forwarded-for": nextIp() },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function seed(now = Date.now(), reporter = ALICE) {
  const id = crypto.randomUUID();
  return memoryRegularNightReportsStore.create(
    {
      id,
      venueId: "venue-crown",
      kind: "quiz",
      weekday: 2,
      startTime: "20:00",
      note: "",
      photoKey: `regular-night-boards/${reporter}/${id}.jpg`,
      reporterUserId: reporter,
    },
    now,
  );
}

beforeEach(() => {
  __resetRegularNightReports();
  __resetPintDrops();
  mediaState.stored = [];
  mediaState.removed = [];
  moderatorState.moderator = false;
  identityState.resolution = SIGNED_IN_ALICE;
});

describe("POST /api/regular-nights", () => {
  it("refuses a field the form never sends, so a body cannot name the reporter", async () => {
    const res = await POST(report({ ...GOOD, reporterUserId: BOB, photo: photo() }));
    expect(res.status).toBe(400);
    expect(mediaState.stored).toEqual([]);
  });

  it("stores the session's report and its board key", async () => {
    const res = await POST(report({ ...GOOD, photo: photo() }));
    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect((await res.json()).report.status).toBe("open");
    const rows = await memoryRegularNightReportsStore.listForReview("open");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      venueId: "venue-crown",
      kind: "quiz",
      weekday: 2,
      startTime: "20:00",
      note: "Teams of six.",
      reporterUserId: ALICE,
    });
    expect(rows[0]?.photoKey).toMatch(new RegExp(`^regular-night-boards/${ALICE}/[0-9a-f-]{36}\\.jpg$`));
  });

  it.each([
    ["anonymous", { ok: false, body: { status: "sign_in_required", error: "Sign in to contribute." }, httpStatus: 401 }, 401, "sign_in_required"],
    [
      "no handle",
      { ok: false, accountId: ALICE, body: { status: "onboarding_required", error: "Choose a public handle before contributing." }, httpStatus: 409 },
      409,
      "onboarding_required",
    ],
    [
      "under 18",
      {
        ok: false,
        accountId: ALICE,
        body: { status: "adult_check_failed", error: "The date of birth on your account is under 18, so contributing is not open to you." },
        httpStatus: 409,
      },
      409,
      "adult_check_failed",
    ],
  ] as const)("refuses a caller who is %s and writes nothing", async (_label, resolution, status, gate) => {
    identityState.resolution = resolution as unknown as Resolution;
    const res = await POST(report({ ...GOOD, photo: photo() }));
    expect(res.status).toBe(status);
    expect(await res.json()).toMatchObject({ status: gate });
    expect(await memoryRegularNightReportsStore.listForReview("open")).toEqual([]);
    expect(mediaState.stored).toEqual([]);
  });

  it("refuses a kind or a weekday outside the closed sets, a bad time and a long note", async () => {
    const kind = await POST(report({ ...GOOD, kind: "bingo", photo: photo() }));
    expect(kind.status).toBe(400);
    expect(await kind.json()).toMatchObject({ code: "INVALID_REGULAR_NIGHT", details: { field: "kind" } });

    const weekday = await POST(report({ ...GOOD, weekday: "7", photo: photo() }));
    expect(weekday.status).toBe(400);
    expect(await weekday.json()).toMatchObject({ details: { field: "weekday" } });

    const time = await POST(report({ ...GOOD, startTime: "8pm", photo: photo() }));
    expect(await time.json()).toMatchObject({ details: { field: "startTime" } });

    const note = await POST(report({ ...GOOD, note: "x".repeat(121), photo: photo() }));
    expect(await note.json()).toMatchObject({ details: { field: "note" } });

    expect(await memoryRegularNightReportsStore.listForReview("open")).toEqual([]);
    expect(mediaState.stored).toEqual([]);
  });

  it("refuses a report with no photo, and a photo that is not an image", async () => {
    const none = await POST(report({ ...GOOD }));
    expect(none.status).toBe(400);
    expect(await none.json()).toMatchObject({ details: { field: "photo" } });

    const pdf = await POST(report({ ...GOOD, photo: photo("application/pdf") }));
    expect(pdf.status).toBe(400);
    expect(await pdf.json()).toMatchObject({ code: "INVALID_TYPE" });
    expect(await memoryRegularNightReportsStore.listForReview("open")).toEqual([]);
  });

  it("refuses a venue neither the index nor the UK base holds", async () => {
    const res = await POST(report({ ...GOOD, venueId: "venue-made-up", photo: photo() }));
    expect(res.status).toBe(400);
    expect(mediaState.stored).toEqual([]);
  });

  it("caps one account at ten reports an hour", async () => {
    for (let index = 0; index < 10; index += 1) {
      const res = await POST(report({ ...GOOD, photo: photo() }));
      expect(res.status, `report ${index}`).toBe(201);
    }
    const eleventh = await POST(report({ ...GOOD, photo: photo() }));
    expect(eleventh.status).toBe(429);
    expect(await eleventh.json()).toMatchObject({ code: "RATE_LIMITED" });
    expect(await memoryRegularNightReportsStore.listForReview("open")).toHaveLength(10);
  });
});

describe("PATCH /api/regular-nights (still on)", () => {
  it("lets a different account extend a report once, and never the reporter", async () => {
    const created = await seed();
    const own = await PATCH(stillOn(created.id));
    expect(own.status).toBe(409);
    expect(await own.json()).toMatchObject({ code: "OWN_REPORT" });

    identityState.resolution = SIGNED_IN_BOB;
    const first = await PATCH(stillOn(created.id));
    expect(first.status).toBe(200);
    const after = await memoryRegularNightReportsStore.getById(created.id);
    expect(Date.parse(after?.expiresAt ?? "")).toBe(Date.parse(created.expiresAt) + 90 * 24 * 60 * 60 * 1000);

    const second = await PATCH(stillOn(created.id));
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({ code: "ALREADY_STILL_ON" });
    expect((await memoryRegularNightReportsStore.getById(created.id))?.expiresAt).toBe(after?.expiresAt);
  });

  it("refuses an anonymous caller, an unknown id and a hidden report", async () => {
    const created = await seed();
    identityState.resolution = {
      ok: false,
      body: { status: "sign_in_required", error: "Sign in to contribute." },
      httpStatus: 401,
    };
    expect((await PATCH(stillOn(created.id))).status).toBe(401);

    identityState.resolution = SIGNED_IN_BOB;
    expect((await PATCH(stillOn("not-a-uuid"))).status).toBe(404);
    await memoryRegularNightReportsStore.decide(created.id, "hidden", "admin");
    expect((await PATCH(stillOn(created.id))).status).toBe(404);
  });
});

describe("GET /api/regular-nights", () => {
  it("returns live rows with the handle, and never a hidden one, an expired one, an account id or a photo key", async () => {
    const live = await seed();
    const hidden = await seed();
    await memoryRegularNightReportsStore.decide(hidden.id, "hidden", "admin");
    await seed(Date.now() - 91 * 24 * 60 * 60 * 1000);

    const res = await GET(read("?weekday=2"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reports.map((row: { id: string }) => row.id)).toEqual([live.id]);
    expect(body.reports[0]).toMatchObject({ handle: "alice", venueName: "The Crown", status: "open" });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(ALICE);
    expect(serialized).not.toContain("regular-night-boards/");
  });

  it("drops the handle once a person confirms the report", async () => {
    const created = await seed();
    await memoryRegularNightReportsStore.decide(created.id, "confirmed", "admin");
    const body = await (await GET(read("?venueId=venue-crown"))).json();
    expect(body.reports[0]).toMatchObject({ status: "confirmed", handle: null });
  });

  it("asks for a weekday or a pub, and refuses a weekday outside 0 to 6", async () => {
    expect((await GET(read(""))).status).toBe(400);
    expect((await GET(read("?weekday=9"))).status).toBe(400);
  });
});

describe("/api/admin/regular-nights", () => {
  it("refuses a caller who is not a moderator, at the read and the verdict", async () => {
    const created = await seed();
    expect((await adminGET(admin("GET"))).status).toBe(403);
    expect((await adminPATCH(admin("PATCH", { id: created.id, status: "confirmed" }))).status).toBe(403);
    expect((await memoryRegularNightReportsStore.getById(created.id))?.status).toBe("open");
  });

  it("lists open reports with the photo, the pub, the kind and the day, and no reporter", async () => {
    moderatorState.moderator = true;
    await seed();
    const body = await (await adminGET(admin("GET"))).json();
    expect(body.reports).toHaveLength(1);
    expect(body.reports[0]).toMatchObject({ venueName: "The Crown", kind: "quiz", weekday: 2, startTime: "20:00" });
    expect(body.reports[0].photoUrl).toMatch(/^https:\/\/signed\.example\//);
    expect(JSON.stringify(body)).not.toContain('"reporterUserId"');
  });

  it("confirms an open report once, hides it after, and refuses a third tap", async () => {
    moderatorState.moderator = true;
    const created = await seed();
    expect((await adminPATCH(admin("PATCH", { id: created.id, status: "confirmed" }))).status).toBe(200);
    expect(await memoryRegularNightReportsStore.getById(created.id)).toMatchObject({ status: "confirmed", confirmedBy: "admin" });
    expect((await adminPATCH(admin("PATCH", { id: created.id, status: "confirmed" }))).status).toBe(409);
    expect((await adminPATCH(admin("PATCH", { id: created.id, status: "hidden" }))).status).toBe(200);
    expect((await adminPATCH(admin("PATCH", { id: created.id, status: "hidden" }))).status).toBe(409);
    expect((await adminPATCH(admin("PATCH", { id: created.id, status: "open" }))).status).toBe(400);
  });
});
