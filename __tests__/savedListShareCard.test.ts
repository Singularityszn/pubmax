import { beforeEach, describe, expect, it } from "vitest";

import Image from "@/app/u/[handle]/lists/[listType]/opengraph-image";
import SavedListPage, { generateMetadata } from "@/app/u/[handle]/lists/[listType]/page";
import { defined } from "@/__tests__/helpers/defined";
import { OG_CACHE_HEADERS } from "@/lib/ogBrand";
import { __resetMemoryProfiles, __tombstoneMemoryProfile, profileStore } from "@/lib/profileStore";
import {
  __resetMemorySavedListFollows,
  __resetMemorySavedLists,
  __resetMemorySavedPubs,
  savedListFollowsStore,
  savedListsStore,
  savedPubsStore,
} from "@/lib/savedPubsStore";
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
  __resetMemorySavedLists();
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

  it("is a 404 on the card, the page and the metadata for a deleted account", async () => {
    await saveSix("gone");
    await profileStore().ensure("gone");
    defined(__tombstoneMemoryProfile("gone"));

    expect(await readPublicSavedList("gone", "Cheap%20Pint")).toEqual({ status: "hidden" });
    await expect(Image(props("gone"))).rejects.toMatchObject(NOT_FOUND);
    await expect(SavedListPage(props("gone"))).rejects.toMatchObject(NOT_FOUND);
    await expect(generateMetadata(props("gone"))).rejects.toMatchObject(NOT_FOUND);
  });

  it("still answers a public account's list after the change", async () => {
    await saveSix("pub");
    await profileStore().ensure("pub");
    const metadata = await generateMetadata(props("pub"));
    expect(metadata.title).toBe("@pub's Cheap Pint");
  });

  it("hides a deleted owner's saves, custom names and followed-list copies", async () => {
    for (const handle of ["gone", "live", "alice"]) await profileStore().ensure(handle);
    await saveSix("gone");
    await savedListsStore().createList("gone", "Private memories");
    await savedListsStore().createList("live", "Friday pubs");
    await savedListFollowsStore().followList("alice", "gone", "Private memories");
    await savedListFollowsStore().followList("alice", "live", "Friday pubs");
    defined(__tombstoneMemoryProfile("gone"));

    for (const ownHandle of [undefined, "alice", "gone"]) {
      expect(await savedPubsStore(ownHandle).listSaved({ handle: "gone" })).toEqual([]);
      expect((await savedPubsStore(ownHandle).readSavedByHandles({ handles: ["gone"] })).get("gone"))
        .toEqual({ status: "ready", rows: [] });
      expect(await savedListsStore(ownHandle).listCustom("gone")).toEqual([]);
      expect(await savedListsStore(ownHandle).listCustom("live")).toEqual(["Friday pubs"]);
      const follows = savedListFollowsStore(ownHandle);
      expect(await follows.listFollowedBy("alice")).toMatchObject([
        { ownerHandle: "live", listType: "Friday pubs" },
      ]);
      expect(await follows.isFollowingList("alice", "gone", "Private memories")).toBe(false);
      expect(await follows.counts("gone", "Private memories")).toEqual({ followers: 0, savedPubs: 0 });
      expect(await follows.followList("alice", "gone", "Private memories")).toBe(false);
    }
  });
});
