import { beforeEach, describe, expect, it } from "vitest";

import Image from "@/app/u/[handle]/lists/[listType]/opengraph-image";
import SavedListPage, { generateMetadata } from "@/app/u/[handle]/lists/[listType]/page";
import { defined } from "@/__tests__/helpers/defined";
import { OG_CACHE_HEADERS } from "@/lib/ogBrand";
import { __resetMemoryProfiles, profileStore } from "@/lib/profileStore";
import { __resetMemorySavedListFollows, __resetMemorySavedPubs, savedPubsStore } from "@/lib/savedPubsStore";
import { readPublicSavedList, savedListCardPubs } from "@/lib/savedListShare.server";
import { lookupCanonicalVenue, getVenueIndex } from "@/lib/venueIndex";

// A saved list worth sharing (WEEK1_HYGIENE_BUILD, "Tags and labels"): the
// card shows the list's name, its count and up to five pubs with the plaque
// the map prints. Public lists only: a private account's list is the same
// not-found on the card, the page and its metadata.

const NOT_FOUND = { digest: "NEXT_HTTP_ERROR_FALLBACK;404" };

beforeEach(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  __resetMemoryProfiles();
  __resetMemorySavedPubs();
  __resetMemorySavedListFollows();
});

async function saveSix(handle: string): Promise<string[]> {
  const ids = [...(await getVenueIndex()).keys()].slice(0, 6);
  for (const venueId of ids) {
    await savedPubsStore().toggleSaved({ handle, venueId, listType: "Cheap Pint" });
  }
  return ids;
}

function props(handle: string) {
  return { params: Promise.resolve({ handle, listType: "Cheap%20Pint" }) };
}

describe("the saved list share card", () => {
  it("renders a PNG for a public list, with the live-card cache header", async () => {
    await saveSix("sam");
    const response = await Image(props("sam"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe(OG_CACHE_HEADERS["cache-control"]);
    expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(1000);
  });

  it("names at most five pubs, each with the map's plaque figure or none", async () => {
    await saveSix("sam");
    const read = await readPublicSavedList("sam", "Cheap%20Pint");
    expect(read.status).toBe("ok");
    const venues = read.status === "ok" ? read.venues : [];
    expect(venues).toHaveLength(6);
    const pubs = await savedListCardPubs(venues);
    expect(pubs).toHaveLength(5);
    for (const pub of pubs) {
      const lookup = await lookupCanonicalVenue(pub.venueId);
      const expected = lookup.status === "found" ? lookup.slimVenue.cheapestPrice : null;
      expect(pub.priceGbp).toBe(expected && expected > 0 ? expected : null);
      expect(pub.name.length).toBeGreaterThan(0);
    }
  });

  it("is a 404 on the card, the page and the metadata for a private account", async () => {
    await saveSix("priv");
    await profileStore().ensure("priv");
    defined(await profileStore().update("priv", { visibility: "private" }));

    await expect(Image(props("priv"))).rejects.toMatchObject(NOT_FOUND);
    await expect(SavedListPage(props("priv"))).rejects.toMatchObject(NOT_FOUND);
    await expect(generateMetadata(props("priv"))).rejects.toMatchObject(NOT_FOUND);
  });

  it("still answers a public account's list after the change", async () => {
    await saveSix("pub");
    await profileStore().ensure("pub");
    const metadata = await generateMetadata(props("pub"));
    expect(metadata.title).toBe("@pub's Cheap Pint");
  });
});
