import { describe, expect, it } from "vitest";

import {
  PUB_SITE_MENU_PAGES,
  THIRD_PARTY_SITE_HOSTS,
  permittedPubSite,
  renderedMenuLinks,
  singlePubSiteTargets,
} from "../scripts/harvest/uk-prices/pubSites.mjs";

const pub = (osmId: string, name: string, website?: string) => ({
  osmId,
  name,
  postcode: "E15 1AA",
  lat: 51.54,
  lng: -0.004,
  ...(website ? { website } : {}),
});

describe("a pub's own website as a crawl input", () => {
  it("permits a pub's own site and refuses what the source table or the third-party rule refuses", () => {
    expect(permittedPubSite("tapeast.co.uk")).toEqual({
      url: "https://tapeast.co.uk",
      host: "tapeast.co.uk",
      origin: "https://tapeast.co.uk",
    });
    expect(permittedPubSite("https://www.nicholsonspubs.co.uk/restaurants/london/theshipwandsworth")).toBeNull();
    expect(permittedPubSite("https://www.facebook.com/somepub")).toBeNull();
    expect(permittedPubSite("")).toBeNull();
    expect(THIRD_PARTY_SITE_HOSTS.test("instagram.com")).toBe(true);
  });

  it("renders only a site that serves exactly one pub, within --only", () => {
    const pubs = [
      pub("node/1", "Tap East", "http://www.tapeast.co.uk/"),
      pub("node/2", "Fox & Hounds", "https://www.craftunionpubs.com/fox-and-hounds-forest-gate"),
      pub("node/3", "Little Driver", "https://www.craftunionpubs.com/little-driver-bow"),
      pub("way/4", "Lvls", "https://www.lvls.london/"),
      pub("node/5", "No Site"),
    ];
    expect(singlePubSiteTargets(pubs).map((target) => [target.host, target.venueId])).toEqual([
      ["tapeast.co.uk", "venue-uk-n1"],
      ["lvls.london", "venue-uk-w4"],
    ]);
    expect(singlePubSiteTargets(pubs, { only: ["lvls.london"] }).map((target) => target.name)).toEqual(["Lvls"]);
    expect(singlePubSiteTargets(pubs, { only: ["craftunionpubs.com"] })).toEqual([]);
  });

  it("opens only the site's own drinks links, once each, capped", () => {
    const links = [
      "https://kingeddies.co.uk/home/menu/",
      "https://kingeddies.co.uk/home/menu/#top",
      "https://kingeddies.co.uk/",
      "https://kingeddies.co.uk/drinks",
      "https://kingeddies.co.uk/privacy-policy",
      "https://www.instagram.com/kingeddies/menu",
      { href: "/wine-list" },
      "https://kingeddies.co.uk/cocktails",
    ];
    expect(renderedMenuLinks(links, "https://kingeddies.co.uk/")).toEqual([
      "https://kingeddies.co.uk/home/menu/",
      "https://kingeddies.co.uk/drinks",
      "https://kingeddies.co.uk/wine-list",
    ]);
    expect(PUB_SITE_MENU_PAGES).toBe(3);
    expect(renderedMenuLinks("not a list", "https://kingeddies.co.uk/")).toEqual([]);
  });
});
