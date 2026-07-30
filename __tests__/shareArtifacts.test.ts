import { describe, expect, it } from "vitest";

import {
  buildBarTabShareText,
  buildCrawlShareText,
  buildHistoricPubShareText,
  buildPassportShareText,
  buildPintDropShareText,
  buildPlanInviteShareText,
  buildSavedListShareText,
  buildVenueShareText,
  whatsappShareHref,
} from "@/lib/shareArtifacts";

describe("buildPlanInviteShareText", () => {
  it("carries title, stop count and start clock", () => {
    expect(
      buildPlanInviteShareText({ title: "Friday in Soho", stopCount: 3, startClock: "19:00" }),
    ).toBe("Friday in Soho · 3 stops · starts 19:00. Open the link and tap I'm in.");
  });

  it("singularises one stop", () => {
    expect(
      buildPlanInviteShareText({ title: "Quick one", stopCount: 1, startClock: "18:30" }),
    ).toContain("1 stop ·");
  });

  it("omits the start clause when the start time is unknown — never invented", () => {
    const text = buildPlanInviteShareText({ title: "Friday in Soho", stopCount: 2, startClock: null });
    expect(text).toBe("Friday in Soho · 2 stops. Open the link and tap I'm in.");
    expect(text).not.toContain("starts");
  });
});

describe("buildPintDropShareText", () => {
  it("names the finder and price when both are known", () => {
    expect(
      buildPintDropShareText({ venueName: "The Test Tavern", priceGbp: 4.5, handle: "@old_ken" }),
    ).toBe("@old_ken logged a pint at The Test Tavern, £4.50. Logged on PUBMAXX.");
  });

  it("reads first-person without a handle", () => {
    expect(buildPintDropShareText({ venueName: "The Test Tavern", priceGbp: 4.5 })).toBe(
      "Logged a pint at The Test Tavern, £4.50. Logged on PUBMAXX.",
    );
  });

  it.each([null, undefined, 0, -1, Number.NaN])(
    "omits the price for dishonest/unknown value %s",
    (priceGbp) => {
      expect(buildPintDropShareText({ venueName: "The Test Tavern", priceGbp })).toBe(
        "Logged a pint at The Test Tavern. Logged on PUBMAXX.",
      );
    },
  );
});

describe("buildCrawlShareText", () => {
  it("includes the round total when the stops carry prices", () => {
    expect(buildCrawlShareText({ title: "Soho Loop", stopCount: 4, totalGbp: 21.4 })).toBe(
      "Soho Loop. 4 stops, £21.40 a round. Listed on PUBMAXX.",
    );
  });

  it("drops the money line when no stop was priced", () => {
    expect(buildCrawlShareText({ title: "Soho Loop", stopCount: 1, totalGbp: 0 })).toBe(
      "Soho Loop. 1 stop. Listed on PUBMAXX.",
    );
  });
});

describe("buildVenueShareText", () => {
  it("leads with the cheapest pint when known", () => {
    expect(buildVenueShareText({ name: "The Red Lion", cheapestPintGbp: 4.2 })).toBe(
      "The Red Lion. Pints from £4.20. On the PUBMAXXING map.",
    );
  });

  it("stays honest with no price", () => {
    expect(buildVenueShareText({ name: "The Red Lion" })).toBe(
      "The Red Lion, on the PUBMAXXING map.",
    );
  });
});

describe("buildBarTabShareText", () => {
  it("frames the venue recap", () => {
    expect(buildBarTabShareText({ venueName: "The Red Lion" })).toBe(
      "Recent pints logged at The Red Lion on PUBMAXX.",
    );
  });
});

describe("buildPassportShareText", () => {
  it("summarises a stamped passport", () => {
    expect(
      buildPassportShareText({ displayName: "Old Ken", pubs: 12, boroughs: 3, pints: 40, isEmpty: false }),
    ).toBe("Old Ken · 12 pubs · 3 boroughs · 40 pints on PUBMAXXING");
  });

  it("singularises a one-of-each passport", () => {
    expect(
      buildPassportShareText({ displayName: "Old Ken", pubs: 1, boroughs: 1, pints: 1, isEmpty: false }),
    ).toBe("Old Ken · 1 pub · 1 borough · 1 pint on PUBMAXXING");
  });

  it("invites rather than boasts when the passport is empty", () => {
    expect(
      buildPassportShareText({ displayName: "Old Ken", pubs: 0, boroughs: 0, pints: 0, isEmpty: true }),
    ).toBe("Start a Pint Passport on PUBMAXXING. Every pint stamps a page.");
  });
});

describe("buildSavedListShareText", () => {
  it("carries owner, list type and neutral venue count", () => {
    expect(buildSavedListShareText({ owner: "old_ken", listType: "favourites", venueCount: 5 })).toBe(
      "old_ken's favourites list. 5 venues on PUBMAXXING.",
    );
  });
});

describe("buildHistoricPubShareText", () => {
  it("prefers the editorial hook", () => {
    expect(
      buildHistoricPubShareText({ name: "Ye Olde Mitre", hook: "Hidden down an alley since 1546." }),
    ).toBe("Hidden down an alley since 1546.");
  });

  it("falls back honestly when the hook is blank", () => {
    expect(buildHistoricPubShareText({ name: "Ye Olde Mitre", hook: "   " })).toBe(
      "Ye Olde Mitre. A historic London pub.",
    );
  });
});

describe("whatsappShareHref", () => {
  it("encodes text plus url in the wa.me idiom", () => {
    expect(whatsappShareHref("A proper pint.", "https://pubmaxxing.com/p/abc")).toBe(
      `https://wa.me/?text=${encodeURIComponent("A proper pint. https://pubmaxxing.com/p/abc")}`,
    );
  });

  it("supports self-contained messages with no url", () => {
    expect(whatsappShareHref("Last train home: 23:42.")).toBe(
      `https://wa.me/?text=${encodeURIComponent("Last train home: 23:42.")}`,
    );
  });
});
