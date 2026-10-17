// A pub's website link is that pub's own, never a namesake's.
//
// The Pint Prices lane gave The Marquis of Cornwallis on Bethnal Green Road the
// site of The Marquis Cornwallis on Marchmont Street, 4 km away, and gave The
// Goat Tavern in Mayfair the Greene King page of the Goat Tavern in Kensington.
// OpenStreetMap lists a different site for each (way/1059879142 and
// way/290081133), so both links were cleared on 17 October 2026 rather than
// pointed somewhere nobody had checked. This fence holds the class: one exact
// link may not belong to two pubs more than a kilometre apart, unless it is a
// small group's one site for all of its bars.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { haversineMeters } from "@/scripts/lib/venueCanonicalization.mjs";
import { groupVenuePrices, type VenuePrice } from "@/lib/venues";

const ROOT = process.cwd();

/** Farther apart than this, two pubs sharing one exact link are two different pubs. */
const SAME_PLACE_METRES = 1_000;

/** Groups that run several bars from one site, with the bars the dataset holds. */
const GROUP_SITES: Readonly<Record<string, string>> = {
  "motherkellys.co.uk": "Mother Kelly's, three bars under one name",
  "saltbeerfactory.co.uk": "SALT Woolwich and Salt Deptford",
  "truecraftlondon.co.uk": "True Craft, two bars under one name",
};

function linkKey(website: string): string | null {
  if (!/^https?:\/\//i.test(website)) return null;
  const url = new URL(website);
  const host = url.host.toLowerCase().replace(/^www\./, "");
  return `${host}${url.pathname.replace(/\/+$/, "").toLowerCase()}${url.search}`;
}

function venues() {
  const rows = JSON.parse(
    readFileSync(join(ROOT, "public", "data", "pint_prices_app_dataset.json"), "utf8"),
  ) as VenuePrice[];
  return groupVenuePrices(rows);
}

describe("a website link belongs to one pub", () => {
  it("is never shared by two pubs more than a kilometre apart", () => {
    const byLink = new Map<string, { name: string; lat: number; lng: number }[]>();
    for (const venue of venues()) {
      const key = linkKey(venue.website);
      if (!key) continue;
      byLink.set(key, [
        ...(byLink.get(key) ?? []),
        { name: venue.name, lat: venue.latitude, lng: venue.longitude },
      ]);
    }

    const borrowed: string[] = [];
    for (const [key, holders] of byLink) {
      if (holders.length < 2) continue;
      const host = key.split("/")[0] ?? "";
      if (GROUP_SITES[host]) continue;
      for (const [i, a] of holders.entries()) {
        for (const b of holders.slice(i + 1)) {
          if (haversineMeters(a.lat, a.lng, b.lat, b.lng) > SAME_PLACE_METRES) {
            borrowed.push(`${key}: ${a.name} and ${b.name}`);
          }
        }
      }
    }
    expect(borrowed).toEqual([]);
  });

  it("keeps every group site on the list in use, so the list cannot go stale", () => {
    const hosts = new Set(
      venues()
        .map((venue) => linkKey(venue.website)?.split("/")[0])
        .filter(Boolean),
    );
    for (const host of Object.keys(GROUP_SITES)) expect(hosts).toContain(host);
  });

  it("leaves the two pubs that carried a namesake's link without one", () => {
    const byName = new Map(venues().map((venue) => [`${venue.name}|${venue.address}`, venue]));
    const cornwallis = byName.get(
      "The Marquis of Cornwallis|304 Bethnal Green Rd, Bethnal Green, London E2 0AG",
    );
    const goat = byName.get("The Goat Tavern|3 Stafford St, London W1S 4RP");
    expect(cornwallis?.website).toBe("");
    expect(goat?.website).toBe("");
  });
});
