import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mates' prices (launch review F8): the route answers a verified Social reader
// with up to three dated facts from their MUTUAL friends' public drops at one
// pub. These run on the keyless memory stores, so the follow graph, the
// profiles, the drops and the block list are the real ones.

const routeState = vi.hoisted(() => ({
  access: null as unknown,
  limited: false,
}));

vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));
vi.mock("@/lib/socialAccessServer", () => ({
  requireVerifiedSocialActor: async () => routeState.access,
}));
vi.mock("@/lib/pintDrops", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pintDrops")>();
  return { ...actual, isLimited: async () => routeState.limited };
});

import { GET } from "@/app/api/mates-prices/route";
import { __resetMemoryFollows, followStore } from "@/lib/followStore";
import { readMatesPrices } from "@/lib/matesPrices.server";
import { __resetPintDrops, addPintDrop, type PintDrop } from "@/lib/pintDrops";
import type { PintDropDTO } from "@/lib/pintDropsStore";
import { __resetMemoryProfiles, __seedMemoryOwnedProfile } from "@/lib/profileStore";
import { clearSocialMemoryBlocks, setSocialMemoryBlock } from "@/lib/socialBlockMemory";

const VENUE = "mates-prices-test-venue";
const ME = "mates_me_28";

function drop(id: string, handle: string, priceGbp: number | null, createdAt: string, extra: Partial<PintDrop> = {}): PintDrop {
  return {
    id,
    venueId: VENUE,
    handle,
    drink: "Guinness",
    priceGbp,
    passedDownNote: "",
    era: "",
    provenance: "contributor",
    status: "visible",
    visibility: "public",
    createdAt,
    ...extra,
  };
}

async function mutual(handle: string) {
  await followStore().follow(ME, handle);
  await followStore().follow(handle, ME);
}

function ask(venueId = VENUE): Promise<Response> {
  return GET(new Request(`http://localhost/api/mates-prices?venueId=${encodeURIComponent(venueId)}`));
}

let me: ReturnType<typeof __seedMemoryOwnedProfile>;

beforeEach(() => {
  me = __seedMemoryOwnedProfile(ME, "user-me-28");
  routeState.access = { ok: true, actor: { accountId: "user-me-28", profileId: me.id, handle: ME } };
  routeState.limited = false;
});

afterEach(() => {
  __resetPintDrops();
  __resetMemoryFollows();
  __resetMemoryProfiles();
  clearSocialMemoryBlocks();
});

describe("GET /api/mates-prices", () => {
  it("refuses a reader with no verified session, privately", async () => {
    routeState.access = { ok: false, error: "Sign in to use Social.", code: "SOCIAL_SIGN_IN_REQUIRED", status: 401 };
    const response = await ask();
    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("refuses a missing pub and a reader over the read limit", async () => {
    expect((await GET(new Request("http://localhost/api/mates-prices"))).status).toBe(400);
    routeState.limited = true;
    expect((await ask()).status).toBe(429);
  });

  it("answers three dated facts, one per mate, newest first", async () => {
    for (const handle of ["mate_ann_28", "mate_bo_28", "mate_cy_28", "mate_di_28"]) {
      __seedMemoryOwnedProfile(handle, `user-${handle}`);
      await mutual(handle);
    }
    addPintDrop(drop("ann-old", "mate_ann_28", 4.9, "2026-10-01T19:00:00.000Z"));
    addPintDrop(drop("ann-new", "mate_ann_28", 5.2, "2026-10-24T19:00:00.000Z"));
    addPintDrop(drop("bo", "mate_bo_28", 5.6, "2026-10-23T19:00:00.000Z", { drink: "Lager", measure: "half" }));
    addPintDrop(drop("cy", "mate_cy_28", 6.1, "2026-10-22T19:00:00.000Z"));
    addPintDrop(drop("di", "mate_di_28", 4.5, "2026-10-20T19:00:00.000Z"));

    const response = await ask();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    const body = await response.json();
    expect(body).toEqual({
      prices: [
        { handle: "mate_ann_28", priceGbp: 5.2, drink: "Guinness", measure: "pint", loggedAt: "2026-10-24T19:00:00.000Z" },
        { handle: "mate_bo_28", priceGbp: 5.6, drink: "Lager", measure: "half", loggedAt: "2026-10-23T19:00:00.000Z" },
        { handle: "mate_cy_28", priceGbp: 6.1, drink: "Guinness", measure: "pint", loggedAt: "2026-10-22T19:00:00.000Z" },
      ],
    });
    // Three facts and nothing else: no average, no count, no aggregate.
    expect(Object.keys(body)).toEqual(["prices"]);
  });

  it("shows nothing from a follower alone, someone the reader follows alone, or a stranger", async () => {
    __seedMemoryOwnedProfile("follower_28", "user-follower");
    __seedMemoryOwnedProfile("followee_28", "user-followee");
    __seedMemoryOwnedProfile("stranger_28", "user-stranger");
    await followStore().follow("follower_28", ME);
    await followStore().follow(ME, "followee_28");
    addPintDrop(drop("f1", "follower_28", 5, "2026-10-24T19:00:00.000Z"));
    addPintDrop(drop("f2", "followee_28", 5, "2026-10-24T19:00:00.000Z"));
    addPintDrop(drop("s1", "stranger_28", 5, "2026-10-24T19:00:00.000Z"));

    expect(await (await ask()).json()).toEqual({ prices: [] });
  });

  it("shows nothing across a block, whichever side made it", async () => {
    const ann = __seedMemoryOwnedProfile("mate_ann_28", "user-ann");
    const bo = __seedMemoryOwnedProfile("mate_bo_28", "user-bo");
    await mutual("mate_ann_28");
    await mutual("mate_bo_28");
    addPintDrop(drop("ann", "mate_ann_28", 5.2, "2026-10-24T19:00:00.000Z"));
    addPintDrop(drop("bo", "mate_bo_28", 5.6, "2026-10-23T19:00:00.000Z"));
    expect((await (await ask()).json()).prices).toHaveLength(2);
    setSocialMemoryBlock(me.id, ann.id, true);
    setSocialMemoryBlock(bo.id, me.id, true);

    expect(await (await ask()).json()).toEqual({ prices: [] });
  });

  it("never names a mate beside a friends-only, anonymous or unpriced drop", async () => {
    __seedMemoryOwnedProfile("mate_ann_28", "user-ann");
    await mutual("mate_ann_28");
    addPintDrop(drop("friends", "mate_ann_28", 5.2, "2026-10-24T19:00:00.000Z", { visibility: "friends" }));
    addPintDrop(drop("anon", "mate_ann_28", 5.3, "2026-10-23T19:00:00.000Z", { visibility: "anonymous" }));
    addPintDrop(drop("story", "mate_ann_28", null, "2026-10-22T19:00:00.000Z"));

    expect(await (await ask()).json()).toEqual({ prices: [] });
  });
});

describe("readMatesPrices", () => {
  const viewer = { profileId: "profile-me", handle: ME };
  const dto = (id: string, handle: string, extra: Partial<PintDropDTO> = {}): PintDropDTO => ({
    ...drop(id, handle, 5, "2026-10-24T19:00:00.000Z"),
    pintPhotoUrl: null,
    venuePhotoUrl: null,
    receiptPhotoUrl: null,
    ...extra,
  });

  it("asks nothing of the pub when the reader has no mutuals", async () => {
    const listVenueDrops = vi.fn(async () => []);
    await expect(
      readMatesPrices(viewer, VENUE, { listMutuals: async () => [], listVenueDrops }),
    ).resolves.toEqual([]);
    expect(listVenueDrops).not.toHaveBeenCalled();
  });

  it("leaves out demo drops and a mate whose pair check does not answer mutual", async () => {
    const prices = await readMatesPrices(viewer, VENUE, {
      listMutuals: async () => ["@Mate_Ann_28", "mate_bo_28"],
      listVenueDrops: async () => [
        dto("demo", "mate_ann_28", { provenance: "demo" }),
        dto("ann", "mate_ann_28", { createdAt: "2026-10-01T19:00:00.000Z" }),
        dto("bo", "mate_bo_28"),
      ],
      stillMutual: async (_viewer, handle) => handle !== "mate_bo_28",
    });
    expect(prices.map((price) => [price.handle, price.loggedAt])).toEqual([
      ["mate_ann_28", "2026-10-01T19:00:00.000Z"],
    ]);
  });
});
