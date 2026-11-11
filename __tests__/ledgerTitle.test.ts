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
) => ledgerTitleName(venue, refs, [...refs.values()].map((ref) => ({
  ...ref,
  primaryBorough: ref.borough,
})));

describe("ledger titles for pubs that share a name", () => {
  const refs = index([
    { id: "venue-a", name: "The Crown" },
    { id: "venue-b", name: "The Crown" },
    { id: "venue-c", name: "The Lamb" },
  ]);

  it("adds the pub's own area when another venue has the same name", () => {
    expect(titleName({ id: "venue-a", name: "The Crown", locality: "Islington" }, refs)).toBe("The Crown, Islington");
    expect(titleName({ id: "venue-a", name: "The Crown", locality: "London", primaryBorough: "Hackney" }, refs)).toBe(
      "The Crown, Hackney",
    );
  });

  it("keeps a unique name bare", () => {
    expect(titleName({ id: "venue-c", name: "The Lamb", locality: "Bloomsbury", address: "1 Lamb Street, WC1N 1AA" }, refs)).toBe("The Lamb");
  });

  it("matches names regardless of case and spacing", () => {
    const mixed = index([
      { id: "venue-a", name: "The  Crown" },
      { id: "venue-b", name: "the crown" },
    ]);
    expect(titleName({ id: "venue-a", name: "The Crown", primaryBorough: "Camden" }, mixed)).toBe("The Crown, Camden");
  });

  it("reads an operator suffix as part of the same name", () => {
    const suffixed = index([
      { id: "venue-a", name: "The Moon Under Water" },
      { id: "venue-b", name: "The Moon Under Water - JD Wetherspoon" },
    ]);
    expect(titleName({ id: "venue-a", name: "The Moon Under Water", locality: "Barnet" }, suffixed)).toBe(
      "The Moon Under Water, Barnet",
    );
  });

  it("does not count a pub that left the map", () => {
    const withRetired = index([
      { id: "venue-a", name: "The Crown" },
      { id: "venue-b", name: "The Crown", retired: true },
    ]);
    expect(titleName({ id: "venue-a", name: "The Crown", locality: "Islington" }, withRetired)).toBe("The Crown");
  });
});

describe("ledger titles for pubs that share a name and a borough", () => {
  const refs = index([
    { id: "venue-a", name: "The Queens Head", borough: "Camden" },
    { id: "venue-b", name: "The Queens Head", borough: "Camden" },
    { id: "venue-c", name: "The Queens Head", borough: "Hackney" },
  ]);

  it("adds the pub's own street before the area", () => {
    const actonSt = { id: "venue-a", name: "The Queens Head", primaryBorough: "Camden", address: "66 Acton St, London WC1X 9NB, UK" };
    expect(titleName(actonSt, refs)).toBe("The Queens Head, Acton St, Camden");
  });

  it("keeps the area alone when no other pub of that name shares the borough", () => {
    const hackney = { id: "venue-c", name: "The Queens Head", primaryBorough: "Hackney", address: "1 Mare St, London E8" };
    expect(titleName(hackney, refs)).toBe("The Queens Head, Hackney");
  });

  it("keeps the area alone when the address names no street", () => {
    const bare = { id: "venue-a", name: "The Queens Head", primaryBorough: "Camden", address: "Camden, Greater London" };
    expect(titleName(bare, refs)).toBe("The Queens Head, Camden");
  });
});

describe("postcode districts for otherwise shared titles", () => {
  it("adds only each pub's own district when the street and area still match", () => {
    const refs = index([
      { id: "venue-a", name: "The Crown", borough: "Hillingdon", address: "1 High Street, UB10 1AA" },
      { id: "venue-b", name: "The Crown", borough: "Hillingdon", address: "2 High Street, UB8 1BB" },
    ]);
    expect(titleName({ ...refs.get("venue-a")!, primaryBorough: "Hillingdon" }, refs))
      .toBe("The Crown, High Street, Hillingdon UB10");
    expect(titleName({ ...refs.get("venue-b")!, primaryBorough: "Hillingdon" }, refs))
      .toBe("The Crown, High Street, Hillingdon UB8");
  });

  it.each(["London N12 8NR, UK", "N128NR", "n12 8nr", "N12"])(
    "uses a district from %s when the address names no street",
    (address) => {
      const refs = index([
        { id: "venue-a", name: "The Elephant Inn", borough: "Barnet", address },
        { id: "venue-b", name: "The Elephant Inn", borough: "Barnet", address: "Barnet, Greater London" },
      ]);
      expect(titleName({ ...refs.get("venue-a")!, primaryBorough: "Barnet" }, refs))
        .toBe("The Elephant Inn, Barnet N12");
      expect(titleName({ ...refs.get("venue-b")!, primaryBorough: "Barnet" }, refs))
        .toBe("The Elephant Inn, Barnet");
    },
  );

  it.each([
    ["1 Beckton Road Canning Town Royal Docks E16 1PU", "1, Beckton Road, London, E16 1PY"],
    ["1 Beckton Road, e161pu", "1 Beckton Road, E16 1PY"],
  ])("uses full postcodes when the districts still collide", (first, second) => {
    const refs = index([
      { id: "venue-a", name: "The Beckton Arms", borough: "Newham", address: first },
      { id: "venue-b", name: "The Beckton Arms", borough: "Newham", address: second },
    ]);
    expect(titleName({ ...refs.get("venue-a")!, primaryBorough: "Newham" }, refs))
      .toBe("The Beckton Arms, Beckton Road, Newham E16 1PU");
    expect(titleName({ ...refs.get("venue-b")!, primaryBorough: "Newham" }, refs))
      .toBe("The Beckton Arms, Beckton Road, Newham E16 1PY");
  });

  it("ignores retired siblings when comparing bundled titles", () => {
    const refs = index([
      { id: "venue-a", name: "The Crown", borough: "Camden", address: "86 Highgate High St, London N6 5HX" },
      { id: "venue-b", name: "The Crown", borough: "Hillingdon", address: "1 High Street, UB10 1AA" },
      { id: "venue-c", name: "The Crown", borough: "Camden", address: "86 Highgate High St, London N6 5HX", retired: true },
    ]);
    expect(titleName({ ...refs.get("venue-a")!, primaryBorough: "Camden" }, refs))
      .toBe("The Crown, Camden");
  });

  it("keeps a distinct street title without a postcode suffix", () => {
    const refs = index([
      { id: "venue-a", name: "The Crown", borough: "Camden", address: "1 High Street, NW1 1AA" },
      { id: "venue-b", name: "The Crown", borough: "Camden", address: "2 Church Road, NW3 1BB" },
    ]);
    expect(titleName({ ...refs.get("venue-a")!, primaryBorough: "Camden" }, refs))
      .toBe("The Crown, High Street, Camden");
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
      const title = ledgerTitleName(read.venue, refs, venues);
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
