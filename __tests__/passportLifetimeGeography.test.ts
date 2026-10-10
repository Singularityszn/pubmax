import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));

import { GET } from "@/app/api/pint-drops/route";
import { buildPassport, hasPassportAreas } from "@/lib/passport";
import { __resetPintDrops, addPintDrop, type PintDrop } from "@/lib/pintDrops";
import { memoryPintDropStore } from "@/lib/pintDropsStore";
import { buildPassportShareText } from "@/lib/shareArtifacts";
import { getVenueIndex } from "@/lib/venueIndex";

const author = "local_lifetime_geography_049";
function seed(index: number, venueId: string, handle = author) {
  const drop: PintDrop = {
    id: `lifetime-geography-${index}`, venueId, handle, drink: "", priceGbp: null,
    passedDownNote: "Disposable local fixture", era: "", provenance: "anecdote",
    status: "visible", visibility: "public",
    createdAt: new Date(Date.UTC(2026, 0, 1) + index * 60000).toISOString(),
  };
  addPintDrop(drop);
}

afterEach(() => {
  __resetPintDrops();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("public author API to lifetime Passport geography", () => {
  for (const total of [500, 501, 502]) {
    it(`retains older City and Hackney areas among ${total} visible drops`, async () => {
      vi.stubGlobal("fetch", async () => { throw new Error("Local fixture forbids provider/network calls"); });
      const index = await getVenueIndex();
      expect(index.get("venue-eltcmh")?.borough).toBe("City of London");
      expect(index.get("venue-wrpmzq")?.borough).toBe("Hackney");
      expect(index.get("venue-1pfnt71")?.borough).toBe("Camden");
      for (let i = 0; i < total; i++) {
        seed(i, i === 0 ? "venue-eltcmh" : i === 1 ? "venue-wrpmzq" : "venue-1pfnt71");
      }
      const response = await GET(new Request(`http://localhost/api/pint-drops?author=${author}`));
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(hasPassportAreas(body)).toBe(true);
      const passport = buildPassport(body.drops, { areas: body.passportAreas });
      expect(body.drops).toHaveLength(Math.min(total, 500));
      expect(passport.boroughs).toEqual(["Camden", "City of London", "Hackney"]);
      expect(buildPassportShareText({
        displayName: "Local", pubs: passport.pubs, boroughs: passport.boroughs.length,
        cityVisited: passport.boroughs.includes("City of London"), pints: passport.pints,
        isEmpty: passport.isEmpty,
      })).toContain("2 boroughs + the City of London");
    });
  }

  it("keeps unrelated-author crowding out of the author-scoped API", async () => {
    seed(0, "venue-eltcmh");
    seed(1, "venue-wrpmzq");
    for (let i = 2; i < 603; i++) seed(i, "venue-1pfnt71", "unrelated_author");
    const response = await GET(new Request(`http://localhost/api/pint-drops?author=${author}`));
    const body = await response.json();
    expect(body.drops).toHaveLength(2);
    expect(body.passportAreas).toEqual(["City of London", "Hackney"]);
  });

  it("keeps the global feed bounded without declaring complete author geography", async () => {
    seed(0, "venue-eltcmh");
    const response = await GET(new Request("http://localhost/api/pint-drops"));
    expect(await response.json()).not.toHaveProperty("passportAreas");
  });

  it("fails the API read when complete geography cannot be read", async () => {
    seed(0, "venue-eltcmh");
    vi.spyOn(memoryPintDropStore, "listVisibleAuthorVenueIds").mockRejectedValueOnce(new Error("Disposable read failure"));
    const response = await GET(new Request(`http://localhost/api/pint-drops?author=${author}`));
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.code).toBe("STORE_UNAVAILABLE");
    expect(body).not.toHaveProperty("passportAreas");
  });
});
