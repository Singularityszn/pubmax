import { describe, expect, it } from "vitest";

import { ledgerPlacePhrase, ledgerStreet, ledgerTitleName } from "@/lib/ledgerTitle";
import { lookupVenueDetail } from "@/lib/venueDetailIndex";
import { getVenueIndex } from "@/lib/venueIndex";
import { getPricedVenues } from "@/lib/venuePriceIndex";

type Ref = { id: string; name: string; borough?: string; retired?: true };

const index = (refs: Ref[]) => new Map(refs.map((ref) => [ref.id, ref]));

describe("ledger titles for pubs that share a name", () => {
  const refs = index([
    { id: "venue-a", name: "The Crown" },
    { id: "venue-b", name: "The Crown" },
    { id: "venue-c", name: "The Lamb" },
  ]);

  it("adds the pub's own area when another venue has the same name", () => {
    expect(ledgerTitleName({ name: "The Crown", locality: "Islington" }, refs)).toBe("The Crown, Islington");
    expect(ledgerTitleName({ name: "The Crown", locality: "London", primaryBorough: "Hackney" }, refs)).toBe(
      "The Crown, Hackney",
    );
  });

  it("keeps a unique name bare", () => {
    expect(ledgerTitleName({ name: "The Lamb", locality: "Bloomsbury" }, refs)).toBe("The Lamb");
  });

  it("matches names regardless of case and spacing", () => {
    const mixed = index([
      { id: "venue-a", name: "The  Crown" },
      { id: "venue-b", name: "the crown" },
    ]);
    expect(ledgerTitleName({ name: "The Crown", primaryBorough: "Camden" }, mixed)).toBe("The Crown, Camden");
  });

  it("reads an operator suffix as part of the same name", () => {
    const suffixed = index([
      { id: "venue-a", name: "The Moon Under Water" },
      { id: "venue-b", name: "The Moon Under Water - JD Wetherspoon" },
    ]);
    expect(ledgerTitleName({ name: "The Moon Under Water", locality: "Barnet" }, suffixed)).toBe(
      "The Moon Under Water, Barnet",
    );
  });

  it("does not count a pub that left the map", () => {
    const withRetired = index([
      { id: "venue-a", name: "The Crown" },
      { id: "venue-b", name: "The Crown", retired: true },
    ]);
    expect(ledgerTitleName({ name: "The Crown", locality: "Islington" }, withRetired)).toBe("The Crown");
  });
});

describe("ledger titles for pubs that share a name and a borough", () => {
  const refs = index([
    { id: "venue-a", name: "The Queens Head", borough: "Camden" },
    { id: "venue-b", name: "The Queens Head", borough: "Camden" },
    { id: "venue-c", name: "The Queens Head", borough: "Hackney" },
  ]);

  it("adds the pub's own street before the area", () => {
    const actonSt = { name: "The Queens Head", primaryBorough: "Camden", address: "66 Acton St, London WC1X 9NB, UK" };
    expect(ledgerTitleName(actonSt, refs)).toBe("The Queens Head, Acton St, Camden");
    expect(ledgerPlacePhrase(actonSt, refs)).toBe("on Acton St in Camden");
  });

  it("keeps the area alone when no other pub of that name shares the borough", () => {
    const hackney = { name: "The Queens Head", primaryBorough: "Hackney", address: "1 Mare St, London E8" };
    expect(ledgerTitleName(hackney, refs)).toBe("The Queens Head, Hackney");
    expect(ledgerPlacePhrase(hackney, refs)).toBe("in Hackney");
  });

  it("keeps the area alone when the address names no street", () => {
    const bare = { name: "The Queens Head", primaryBorough: "Camden", address: "Camden, Greater London" };
    expect(ledgerTitleName(bare, refs)).toBe("The Queens Head, Camden");
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
  it("has a title of its own unless no address tells the pubs apart", async () => {
    const [venues, refs] = await Promise.all([getPricedVenues(), getVenueIndex()]);
    const byTitle = new Map<string, { id: string; street: string | null }[]>();
    for (const { id } of venues) {
      const read = await lookupVenueDetail(id);
      if (read.status !== "found") continue;
      const title = ledgerTitleName(read.venue, refs);
      byTitle.set(title, [...(byTitle.get(title) ?? []), { id, street: ledgerStreet(read.venue) }]);
    }
    const toldApartButShared = [...byTitle].filter(
      ([, pages]) => pages.length > 1 && new Set(pages.map((page) => page.street)).size > 1,
    );
    expect(byTitle.size).toBeGreaterThan(1000);
    expect(toldApartButShared).toEqual([]);
  });
});
