import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// Drop visibility & privacy (issue #29, PRD § "The Spill"). Covers:
//   • the pure model: cleanVisibility, visibilityOf, the friends direction, the
//     canViewOnPublicSurface gate;
//   • the STORE seam applying visibility server-side (memory backend);
//   • the anonymity DTO-leak audit — the real handle must never serialize;
//   • default-public safety for old rows / demo seeds.
//
// FORCE the memory path: clear Supabase env so the store + lookup use the
// in-memory backend deterministically offline (repo convention — see
// pintDropLookup.test.ts). Every assertion here runs without a live project.
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

afterAll(() => {
  vi.unstubAllEnvs();
});

import {
  ANON_HANDLE_LABEL,
  DEFAULT_VISIBILITY,
  __resetPintDrops,
  addPintDrop,
  canViewOnPublicSurface,
  cleanVisibility,
  isAuthor,
  qualifiesForFriends,
  validatePintDrop,
  visibilityOf,
  type PintDrop,
  type ViewerContext,
} from "@/lib/pintDrops";
import { memoryPintDropStore, toDTO, type PersistableDrop } from "@/lib/pintDropsStore";
import { getPintDropById } from "@/lib/pintDropLookup";
import { GET as getPintDrops } from "@/app/api/pint-drops/route";
import { callerUserId } from "@/lib/authServer";
import { resolveViewerContextFromRequest } from "@/lib/pintDropViewer";
import { followStore } from "@/lib/followStore";
import { memoryProfileStore } from "@/lib/profileStore";

beforeEach(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  vi.stubEnv("NODE_ENV", "test");
  vi.mocked(callerUserId).mockReset();
  vi.mocked(callerUserId).mockResolvedValue(null);
});

// A base drop for gate/DTO tests — override per case.
function makeDrop(overrides: Partial<PintDrop> = {}): PintDrop {
  return {
    id: "d1",
    venueId: "the-crown",
    handle: "author_ale",
    drink: "Guinness",
    priceGbp: 5.2,
    passedDownNote: "",
    era: "",
    provenance: "contributor",
    status: "visible",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const author: ViewerContext = { handle: "author_ale" };
const follower: ViewerContext = { handle: "mate_bob", followingHandles: new Set(["author_ale"]) };
const stranger: ViewerContext = { handle: "rando", followingHandles: new Set(["someone_else"]) };
const anonViewer: ViewerContext | undefined = undefined;

// ── Model: validation + coercion ─────────────────────────────────────────────
describe("visibility model — validation", () => {
  it("defaults to public when visibility is omitted", () => {
    const r = validatePintDrop({ venueId: "v", handle: "h", priceGbp: 4 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.visibility).toBe("public");
    expect(DEFAULT_VISIBILITY).toBe("public");
  });

  it("accepts each of the four lanes", () => {
    for (const v of ["public", "friends", "legacy", "anonymous"] as const) {
      const r = validatePintDrop({ venueId: "v", handle: "h", priceGbp: 4, visibility: v });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value.visibility).toBe(v);
    }
  });

  it("collapses an off-allowlist / garbage visibility to public (never throws)", () => {
    expect(cleanVisibility("everyone")).toBe("public");
    expect(cleanVisibility(42)).toBe("public");
    expect(cleanVisibility(null)).toBe("public");
    expect(cleanVisibility(undefined)).toBe("public");
    const r = validatePintDrop({ venueId: "v", handle: "h", priceGbp: 4, visibility: "world" });
    expect(r.ok && r.value.visibility).toBe("public");
  });

  it("visibilityOf treats an old row (no field) as public", () => {
    expect(visibilityOf({ visibility: undefined })).toBe("public");
    expect(visibilityOf({ visibility: "friends" })).toBe("friends");
  });
});

// ── Model: friends direction + gate ──────────────────────────────────────────
describe("visibility gate — canViewOnPublicSurface", () => {
  it("public: everyone sees it", () => {
    const d = makeDrop({ visibility: "public" });
    expect(canViewOnPublicSurface(d, anonViewer)).toBe(true);
    expect(canViewOnPublicSurface(d, stranger)).toBe(true);
  });

  it("anonymous: everyone sees it (handle withheld at DTO, not here)", () => {
    const d = makeDrop({ visibility: "anonymous" });
    expect(canViewOnPublicSurface(d, anonViewer)).toBe(true);
    expect(canViewOnPublicSurface(d, stranger)).toBe(true);
  });

  it("friends: author + the author's followers only", () => {
    const d = makeDrop({ visibility: "friends" });
    // FRIENDS DIRECTION: a follower of the author is a viewer who FOLLOWS the
    // author (author is in the viewer's followingHandles).
    expect(qualifiesForFriends(d, follower)).toBe(true);
    expect(qualifiesForFriends(d, stranger)).toBe(false);
    expect(canViewOnPublicSurface(d, author)).toBe(true); // author sees own
    expect(canViewOnPublicSurface(d, follower)).toBe(true);
    expect(canViewOnPublicSurface(d, stranger)).toBe(false);
    expect(canViewOnPublicSurface(d, anonViewer)).toBe(false);
  });

  it("legacy: author only on public surfaces (ledger-only otherwise)", () => {
    const d = makeDrop({ visibility: "legacy" });
    expect(canViewOnPublicSurface(d, author)).toBe(true);
    expect(canViewOnPublicSurface(d, follower)).toBe(false);
    expect(canViewOnPublicSurface(d, stranger)).toBe(false);
    expect(canViewOnPublicSurface(d, anonViewer)).toBe(false);
  });

  it("isAuthor matches on normalised handles, never on a blank viewer", () => {
    expect(isAuthor({ handle: "author_ale" }, { handle: "@Author_Ale" })).toBe(true);
    expect(isAuthor({ handle: "author_ale" }, { handle: "" })).toBe(false);
    expect(isAuthor({ handle: "author_ale" }, undefined)).toBe(false);
  });
});

// ── Store seam: per-visibility read filtering (memory backend) ────────────────
describe("store.listVisible — server-side visibility filtering", () => {
  beforeEach(() => __resetPintDrops());

  // Seed one drop of each lane at the same venue, all by author_ale.
  function seedAllLanes() {
    addPintDrop(makeDrop({ id: "pub", visibility: "public", createdAt: "2026-01-05T00:00:00.000Z" }));
    addPintDrop(makeDrop({ id: "anon", visibility: "anonymous", createdAt: "2026-01-04T00:00:00.000Z" }));
    addPintDrop(makeDrop({ id: "fr", visibility: "friends", createdAt: "2026-01-03T00:00:00.000Z" }));
    addPintDrop(makeDrop({ id: "leg", visibility: "legacy", createdAt: "2026-01-02T00:00:00.000Z" }));
  }

  it("an anonymous viewer sees public + anonymous only (no friends, no legacy)", async () => {
    seedAllLanes();
    const dtos = await memoryPintDropStore.listVisible("the-crown");
    const ids = dtos.map((d) => d.id).filter((id) => id !== undefined);
    expect(ids).toContain("pub");
    expect(ids).toContain("anon");
    expect(ids).not.toContain("fr");
    expect(ids).not.toContain("leg");
  });

  it("a follower of the author additionally sees the friends drop (never legacy)", async () => {
    seedAllLanes();
    const dtos = await memoryPintDropStore.listVisible("the-crown", follower);
    const ids = dtos.map((d) => d.id);
    expect(ids).toEqual(expect.arrayContaining(["pub", "anon", "fr"]));
    expect(ids).not.toContain("leg");
  });

  it("the author sees own public/anonymous/friends, but NOT legacy on the public surface", async () => {
    seedAllLanes();
    const dtos = await memoryPintDropStore.listVisible("the-crown", author);
    const ids = dtos.map((d) => d.id);
    expect(ids).toEqual(expect.arrayContaining(["pub", "anon", "fr"]));
    // Legacy is ledger-only — even the author reads it via listLegacyForVenue.
    expect(ids).not.toContain("leg");
  });

  it("legacy reads ONLY via listLegacyForVenue", async () => {
    seedAllLanes();
    const legacy = await memoryPintDropStore.listLegacyForVenue("the-crown");
    expect(legacy.map((d) => d.id)).toEqual(["leg"]);
    // And a public read at the same venue never includes it, for any viewer.
    const pub = await memoryPintDropStore.listVisible("the-crown", follower);
    expect(pub.map((d) => d.id)).not.toContain("leg");
  });
});

// ── Anonymity: DTO-leak audit ────────────────────────────────────────────────
describe("anonymity — the real handle NEVER leaks through a DTO", () => {
  const secret = "secretalice";

  it("toDTO withholds the handle for an anonymous drop", () => {
    const dto = toDTO(makeDrop({ handle: secret, visibility: "anonymous" }) as PersistableDrop);
    expect(dto.handle).toBe(ANON_HANDLE_LABEL);
    // The real handle appears nowhere in the serialized DTO.
    expect(JSON.stringify(dto)).not.toContain(secret);
  });

  it("toDTO keeps the real handle for public/friends/legacy (not anonymised)", () => {
    for (const v of ["public", "friends", "legacy"] as const) {
      const dto = toDTO(makeDrop({ handle: secret, visibility: v }) as PersistableDrop);
      expect(dto.handle).toBe(secret);
    }
  });

  it("listVisible never serializes an anonymous author's real handle", async () => {
    __resetPintDrops();
    addPintDrop(makeDrop({ id: "anon", handle: secret, visibility: "anonymous" }));
    const dtos = await memoryPintDropStore.listVisible("the-crown");
    const serialized = JSON.stringify(dtos);
    expect(serialized).not.toContain(secret);
    expect(serialized).toContain(ANON_HANDLE_LABEL);
  });
});

// ── Permalink gating (getPintDropById) ───────────────────────────────────────
describe("permalink — getPintDropById respects visibility", () => {
  beforeEach(() => __resetPintDrops());
  const secret = "secretalice";

  it("anonymous drop resolves with the handle withheld", async () => {
    addPintDrop(makeDrop({ id: "anon1", handle: secret, visibility: "anonymous" }));
    const drop = await getPintDropById("anon1");
    expect(drop).not.toBeNull();
    expect(drop!.handle).toBe(ANON_HANDLE_LABEL);
    expect(JSON.stringify(drop)).not.toContain(secret);
  });

  it("friends drop: null (honest block) for a stranger, resolves for a follower/author", async () => {
    addPintDrop(makeDrop({ id: "fr1", visibility: "friends" }));
    expect(await getPintDropById("fr1")).toBeNull(); // anonymous viewer
    expect(await getPintDropById("fr1", stranger)).toBeNull();
    expect(await getPintDropById("fr1", follower)).not.toBeNull();
    expect(await getPintDropById("fr1", author)).not.toBeNull();
  });

  it("legacy drop: null on the permalink for everyone but the author", async () => {
    addPintDrop(makeDrop({ id: "leg1", visibility: "legacy" }));
    expect(await getPintDropById("leg1")).toBeNull();
    expect(await getPintDropById("leg1", follower)).toBeNull();
    expect(await getPintDropById("leg1", author)).not.toBeNull();
  });

  it("public drop resolves for any viewer (default-public safety)", async () => {
    addPintDrop(makeDrop({ id: "pub1", visibility: "public" }));
    // A drop with NO visibility field (old row) is treated as public too.
    addPintDrop(makeDrop({ id: "old1", visibility: undefined }));
    expect(await getPintDropById("pub1")).not.toBeNull();
    expect(await getPintDropById("old1", stranger)).not.toBeNull();
  });
});

// ── JWT-derived viewer: spoofed ?viewer= must not unlock friends in production ─
describe("friends visibility — verified viewer only in production", () => {
  beforeEach(() => __resetPintDrops());

  it("resolveViewerContextFromRequest ignores spoofed ?viewer= in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    addPintDrop(makeDrop({ id: "fr-spoof", visibility: "friends" }));
    await followStore().follow("mate_bob", "author_ale");

    const viewer = await resolveViewerContextFromRequest(
      new Request("http://localhost/api/pint-drops"),
      "mate_bob",
    );
    expect(viewer).toBeUndefined();
    expect(await getPintDropById("fr-spoof", viewer)).toBeNull();
  });

  it("resolveViewerContextFromRequest uses JWT profile handle in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    addPintDrop(makeDrop({ id: "fr-jwt", visibility: "friends" }));
    await memoryProfileStore.ensure("mate_bob");
    await memoryProfileStore.linkUser("mate_bob", "user-bob");
    await followStore().follow("mate_bob", "author_ale");

    vi.mocked(callerUserId).mockResolvedValueOnce("user-bob");

    const viewer = await resolveViewerContextFromRequest(
      new Request("http://localhost/api/pint-drops", {
        headers: { Authorization: "Bearer fake.jwt.token" },
      }),
      "rando",
    );
    expect(viewer?.handle).toBe("mate_bob");
    expect(viewer?.followingHandles?.has("author_ale")).toBe(true);
    expect(await getPintDropById("fr-jwt", viewer)).not.toBeNull();
  });

  it("GET /api/pint-drops omits friends drops when only ?viewer= is spoofed in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    addPintDrop(makeDrop({ id: "fr-api", visibility: "friends" }));
    addPintDrop(makeDrop({ id: "pub-api", visibility: "public" }));
    await followStore().follow("mate_bob", "author_ale");

    const res = await getPintDrops(
      new Request("http://localhost/api/pint-drops?viewer=mate_bob"),
    );
    expect(res.status).toBe(200);
    const { drops } = await res.json();
    const ids = drops.map((d: { id: string }) => d.id);
    expect(ids).toContain("pub-api");
    expect(ids).not.toContain("fr-api");
  });
});
