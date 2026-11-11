import { describe, expect, it } from "vitest";

import { ledgerStreet, ledgerTitleName } from "@/lib/ledgerTitle";
import { lookupVenueDetail } from "@/lib/venueDetailIndex";
import { getVenueIndex } from "@/lib/venueIndex";
import { getPricedVenues } from "@/lib/venuePriceIndex";

type Ref = { id: string; name: string; borough?: string; retired?: true; address?: string };

const index = (refs: Ref[]) => new Map(refs.map((ref) => [ref.id, ref]));

const titleName = (
  venue: Parameters<typeof ledgerTitleName>[0],
  refs: ReadonlyMap<string, Ref>,
) => ledgerTitleName(venue, refs, async (id) => {
  const ref = refs.get(id);
  return ref
    ? { status: "found", venue: { ...ref, primaryBorough: ref.borough } }
    : { status: "missing" };
});

describe("ledger titles for pubs that share a name", () => {
  const refs = index([
    { id: "venue-a", name: "The Crown" },
    { id: "venue-b", name: "The Crown" },
    { id: "venue-c", name: "The Lamb" },
  ]);

  it("adds the pub's own area when another venue has the same name", async () => {
    await expect(titleName({ id: "venue-a", name: "The Crown", locality: "Islington" }, refs)).resolves.toBe("The Crown, Islington");
    await expect(titleName({ id: "venue-a", name: "The Crown", locality: "London", primaryBorough: "Hackney" }, refs)).resolves.toBe(
      "The Crown, Hackney",
    );
  });

  it("keeps a unique name bare", async () => {
    await expect(titleName({ id: "venue-c", name: "The Lamb", locality: "Bloomsbury", address: "1 Lamb Street, WC1N 1AA" }, refs)).resolves.toBe("The Lamb");
  });

  it("matches names regardless of case and spacing", async () => {
    const mixed = index([
      { id: "venue-a", name: "The  Crown" },
      { id: "venue-b", name: "the crown" },
    ]);
    await expect(titleName({ id: "venue-a", name: "The Crown", primaryBorough: "Camden" }, mixed)).resolves.toBe("The Crown, Camden");
  });

  it("reads an operator suffix as part of the same name", async () => {
    const suffixed = index([
      { id: "venue-a", name: "The Moon Under Water" },
      { id: "venue-b", name: "The Moon Under Water - JD Wetherspoon" },
    ]);
    await expect(titleName({ id: "venue-a", name: "The Moon Under Water", locality: "Barnet" }, suffixed)).resolves.toBe(
      "The Moon Under Water, Barnet",
    );
  });

  it("does not count a pub that left the map", async () => {
    const withRetired = index([
      { id: "venue-a", name: "The Crown" },
      { id: "venue-b", name: "The Crown", retired: true },
    ]);
    await expect(titleName({ id: "venue-a", name: "The Crown", locality: "Islington" }, withRetired)).resolves.toBe("The Crown");
  });
});

describe("ledger titles for pubs that share a name and a borough", () => {
  const refs = index([
    { id: "venue-a", name: "The Queens Head", borough: "Camden" },
    { id: "venue-b", name: "The Queens Head", borough: "Camden" },
    { id: "venue-c", name: "The Queens Head", borough: "Hackney" },
  ]);

  it("adds the pub's own street before the area", async () => {
    const actonSt = { id: "venue-a", name: "The Queens Head", primaryBorough: "Camden", address: "66 Acton St, London WC1X 9NB, UK" };
    await expect(titleName(actonSt, refs)).resolves.toBe("The Queens Head, Acton St, Camden");
  });

  it("keeps the area alone when no other pub of that name shares the borough", async () => {
    const hackney = { id: "venue-c", name: "The Queens Head", primaryBorough: "Hackney", address: "1 Mare St, London E8" };
    await expect(titleName(hackney, refs)).resolves.toBe("The Queens Head, Hackney");
  });

  it("keeps the area alone when the address names no street", async () => {
    const bare = { id: "venue-a", name: "The Queens Head", primaryBorough: "Camden", address: "Camden, Greater London" };
    await expect(titleName(bare, refs)).resolves.toBe("The Queens Head, Camden");
  });
});

describe("postcode districts for otherwise shared titles", () => {
  it("adds only each pub's own district when the street and area still match", async () => {
    const refs = index([
      { id: "venue-a", name: "The Crown", borough: "Hillingdon", address: "1 High Street, UB10 1AA" },
      { id: "venue-b", name: "The Crown", borough: "Hillingdon", address: "2 High Street, UB8 1BB" },
    ]);
    await expect(titleName({ ...refs.get("venue-a")!, primaryBorough: "Hillingdon" }, refs))
      .resolves.toBe("The Crown, High Street, Hillingdon UB10");
    await expect(titleName({ ...refs.get("venue-b")!, primaryBorough: "Hillingdon" }, refs))
      .resolves.toBe("The Crown, High Street, Hillingdon UB8");
  });

  it.each(["London N12 8NR, UK", "N128NR", "n12 8nr", "N12"])(
    "uses a district from %s when the address names no street",
    async (address) => {
      const refs = index([
        { id: "venue-a", name: "The Elephant Inn", borough: "Barnet", address },
        { id: "venue-b", name: "The Elephant Inn", borough: "Barnet", address: "Barnet, Greater London" },
      ]);
      await expect(titleName({ ...refs.get("venue-a")!, primaryBorough: "Barnet" }, refs))
        .resolves.toBe("The Elephant Inn, Barnet N12");
      await expect(titleName({ ...refs.get("venue-b")!, primaryBorough: "Barnet" }, refs))
        .resolves.toBe("The Elephant Inn, Barnet");
    },
  );

  it("keeps a distinct street title without a postcode suffix", async () => {
    const refs = index([
      { id: "venue-a", name: "The Crown", borough: "Camden", address: "1 High Street, NW1 1AA" },
      { id: "venue-b", name: "The Crown", borough: "Camden", address: "2 Church Road, NW3 1BB" },
    ]);
    await expect(titleName({ ...refs.get("venue-a")!, primaryBorough: "Camden" }, refs))
      .resolves.toBe("The Crown, High Street, Camden");
  });
});

describe("ledgerStreet", () => {
  const street = (name: string, address: string, primaryBorough = "Newham") =>
    ledgerStreet({ name, address, primaryBorough });

  it("skips a bare house number and the pub's own name", () => {
    expect(street("The Ship", "116, Wardour Street, London, W1F 0TT")).toBe("Wardour Street");
    expect(street("The Boogaloo", "The Boogaloo, 312 Archway Rd, London N6 5AT, UK")).toBe("Archway Rd");
  });

  it("ends a run-on address line at the street", () => {
    expect(street("The Beckton Arms", "1 Beckton Road Canning Town Royal Docks E16 1PU")).toBe("Beckton Road");
    expect(street("The Duke of York", "2 St Ann's Terrace, London NW8 6PJ, UK")).toBe("St Ann's Terrace");
  });

  it("finds no street in an address that only names the area", () => {
    expect(street("The Angel", "Hillingdon, Greater London", "Hillingdon")).toBeNull();
  });
});

describe("every Ledger page in the sitemap", () => {
  it("shares titles only for the approved pairs with no postcode", async () => {
    const approvedExceptions = [
      ["venue-d81nvz", "venue-7dqmn6"],
      ["venue-16ga1jj", "venue-1cbx68v"],
      ["venue-1ow070n", "venue-q92xb4"],
      ["venue-1xky4gf", "venue-1gpckx6"],
      ["venue-dzidk0", "venue-1rmjqfw"],
      ["venue-1dzgxpa", "venue-1ux9oxk"],
    ].map((ids) => ids.sort()).sort();
    const [venues, refs] = await Promise.all([getPricedVenues(), getVenueIndex()]);
    const byTitle = new Map<string, Set<string>>();
    for (const { id } of venues) {
      const read = await lookupVenueDetail(id);
      if (read.status !== "found") continue;
      const title = await ledgerTitleName(read.venue, refs, lookupVenueDetail);
      const pages = byTitle.get(title) ?? new Set<string>();
      pages.add(read.venue.id);
      byTitle.set(title, pages);
    }
    const shared = [...byTitle.values()]
      .filter((pages) => pages.size > 1)
      .map((pages) => [...pages].sort())
      .sort();
    expect(byTitle.size).toBeGreaterThan(1000);
    expect(shared).toEqual(approvedExceptions);
  });
});
