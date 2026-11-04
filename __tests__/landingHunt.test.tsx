import type { Route } from "next";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it, vi } from "vitest";

vi.mock("next/dynamic", () => ({
  default: () => () => null,
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ prefetch: () => Promise.resolve() }),
}));
vi.mock("@/components/auth/SignInButton", () => ({ default: () => null }));
vi.mock("@/components/brand/PubmaxxWordmark", () => ({ default: () => null }));
vi.mock("@/components/nav/MessagesLink", () => ({ default: () => null }));
vi.mock("@/components/nav/NotificationBell", () => ({ default: () => null }));
vi.mock("@/components/ThemeToggle", () => ({ default: () => null }));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("@/lib/cityPreference", () => ({
  preferredCityMapHref: () => "/choose-city",
  readPreferredCity: () => null,
  subscribePreferredCity: () => () => {},
}));

import LandingHuntCard from "@/components/landing/LandingHuntCard";
import LandingHuntCities from "@/components/landing/LandingHuntCities";
import LandingPage from "@/components/landing/LandingPage";
import { buildCheapestHunt, type CheapestHunt, type HuntPint } from "@/lib/cheapestHunt";

// The front door's hunt, rendered (captain decisions 2 and 3, 1 Nov 2026).
// The card names the cheapest pint we can find in Britain with its price, who
// listed it and the day that source was read, and its figure line carries no
// joke (docs/VOICE.md, "Where the jokes live"). The city list gives every city
// on the map a row, and a city with no price says so and opens its own door.

function pint(overrides: Partial<HuntPint> = {}): HuntPint {
  return {
    venueId: "venue-1nt5lt9",
    pubName: "The Scolt Head",
    cityId: "london",
    placeName: "London",
    priceGbp: 2,
    publisher: { label: "thescolthead.co.uk", url: "https://www.thescolthead.co.uk/drinks" },
    observedOn: "2026-09-21",
    standing: "listed",
    lane: "uk-bundle",
    mapHref: "/map?sel=venue-1nt5lt9" as Route,
    ...overrides,
  };
}

/** The visible words of an element, tags stripped and entities read. */
function text(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function part(html: string, pattern: RegExp): string {
  const match = html.match(pattern)?.[0];
  expect(match, String(pattern)).toBeTruthy();
  return match ?? "";
}

describe("the hero's hunt card", () => {
  const html = renderToStaticMarkup(createElement(LandingHuntCard, { pint: pint() }));

  it("names the cheapest pint we can find in Britain in the captain's words", () => {
    expect(html).toContain(
      '<h2 class="lpHuntTitle" id="lp-hunt-title">The cheapest pint we can find in Britain right now</h2>',
    );
  });

  it("prints the price, the pub and the place, and nothing else, on the figure line", () => {
    const figure = part(html, /<p class="lpHuntFigure"[\s\S]*?<\/p>/);
    // Exactly these words: no aside, no pun and no exclamation beside a figure.
    expect(text(figure)).toBe("£2.00a pint at The Scolt Head, London");
    expect(figure).toMatch(/<a [^>]*href="\/map\?sel=venue-1nt5lt9"[^>]*>The Scolt Head<\/a>/);
    expect(text(figure)).not.toMatch(/[!?]|\(/);
  });

  it("names who listed it and the day that source was read", () => {
    const source = part(html, /<p class="lpHuntSource"[\s\S]*?<\/p>/);
    expect(text(source)).toBe("Listed by thescolthead.co.uk, source read 21 September 2026.");
    expect(source).toContain(
      '<a href="https://www.thescolthead.co.uk/drinks" target="_blank" rel="noopener noreferrer">thescolthead.co.uk</a>',
    );
    expect(source).toContain('<time dateTime="2026-09-21">21 September 2026</time>');
  });

  it("wears its price band, never a colour of its own", () => {
    expect(html).toMatch(/class="priceBadge priceBadge--current [^"]*"/);
  });

  it("says confirmed only for a confirmed pint", () => {
    const confirmed = renderToStaticMarkup(
      createElement(LandingHuntCard, { pint: pint({ standing: "confirmed" }) }),
    );
    expect(text(part(confirmed, /<p class="lpHuntSource"[\s\S]*?<\/p>/))).toMatch(/^Confirmed by /);
  });

  it("renders nothing when no pint may win, never an invented one", () => {
    expect(renderToStaticMarkup(createElement(LandingHuntCard, { pint: null }))).toBe("");
  });

  it("sits in the hero where the photograph stood, before the one primary", () => {
    const page = renderToStaticMarkup(
      createElement(LandingPage, { huntCard: createElement(LandingHuntCard, { pint: pint() }) }),
    );
    const hero = part(page, /<section class="screen lpHero"[\s\S]*?<\/section>/);
    expect(hero.indexOf('class="lpHuntCard"')).toBeGreaterThan(-1);
    expect(hero.indexOf('class="lpHuntCard"')).toBeLessThan(hero.indexOf("data-primary-action"));
    expect(hero).not.toContain("Tower Bridge");
  });
});

describe("Britain's cheapest pint, city by city", () => {
  const hunt: CheapestHunt = buildCheapestHunt([
    pint(),
    pint({
      venueId: "venue-bhm-abc123",
      pubName: "The Brum Tap",
      cityId: "birmingham",
      placeName: "Birmingham",
      priceGbp: 2.5,
      publisher: { label: "brumtap.co.uk", url: "https://brumtap.co.uk/menu" },
      observedOn: "2026-09-04",
      mapHref: "/map/birmingham?sel=venue-bhm-abc123" as Route,
    }),
    pint({
      venueId: "venue-uk-n2",
      pubName: "Vessel",
      cityId: null,
      placeName: "Edinburgh",
      // Cheaper than every city row, and outside every map city.
      priceGbp: 1.5,
      publisher: { label: "vesselbars.co.uk", url: "https://vesselbars.co.uk/menu.pdf" },
      observedOn: "2026-09-04",
      mapHref: "/map?sel=venue-uk-n2&at=55.9540,-3.1972" as Route,
    }),
    pint({
      venueId: "venue-3pjert",
      pubName: "Baccarat Bar",
      priceGbp: 9.5,
      publisher: { label: "Pint Prices", url: "https://www.pint-prices.com/pub/x" },
      observedOn: "2026-10-02",
      lane: "london-list",
      mapHref: "/map?sel=venue-3pjert" as Route,
    }),
  ], new Set(["oxford"] as const));
  const html = renderToStaticMarkup(createElement(LandingHuntCities, { hunt }));

  it("heads the list in its own words", () => {
    expect(html).toContain(
      '<h2 class="lpHuntCitiesTitle" id="lp-hunt-cities-title">Britain&#x27;s cheapest pint, city by city</h2>',
    );
  });

  it("prints a priced city's cheapest pint with its source and its day", () => {
    const birmingham = part(html, /<li class="lpHuntCityRow" data-city="birmingham">[\s\S]*?<\/li>/);
    expect(text(birmingham)).toBe(
      "Birmingham£2.50The Brum TapListed by brumtap.co.uk, source read 4 September 2026.",
    );
  });

  it("says a city with no price has none, and hands over that city's own price door", () => {
    const bath = part(html, /<li class="lpHuntCityRow" data-city="bath">[\s\S]*?<\/li>/);
    expect(text(bath)).toBe("BathNo prices yet. Log the first one.");
    expect(bath).toMatch(/<a [^>]*href="\/map\/bath\?log=1"[^>]*>Log the first one\.<\/a>/);
    // No figure, no date, no source on an empty row.
    expect(bath).not.toMatch(/£\d/);
    expect(bath).not.toContain("<time");
  });

  it("never calls a city empty when it holds prices that name no pint", () => {
    const oxford = part(html, /<li class="lpHuntCityRow" data-city="oxford">[\s\S]*?<\/li>/);
    expect(text(oxford)).toBe("OxfordPrices listed, but none says which pint. Log yours.");
    expect(oxford).toMatch(/<a [^>]*href="\/map\/oxford\?log=1"[^>]*>Log yours\.<\/a>/);
    expect(oxford).not.toContain("No prices yet");
    expect(oxford).not.toMatch(/£\d/);
  });

  it("renders no row, and no hero, for a pub outside every map city, however cheap", () => {
    expect(html).not.toContain('data-city="elsewhere"');
    expect(html).not.toContain("Elsewhere in Britain");
    expect(html).not.toContain("Vessel");
    expect(hunt.britain).toMatchObject({ pubName: "The Scolt Head", priceGbp: 2 });
    const hero = renderToStaticMarkup(createElement(LandingHuntCard, { pint: hunt.britain }));
    expect(hero).toContain("The Scolt Head");
    expect(hero).not.toContain("Vessel");
  });

  it("carries London's dearest pint as a press card with its source and day", () => {
    const dearest = part(html, /<article class="lpHuntDearest"[\s\S]*?<\/article>/);
    expect(dearest).toContain('id="londons-dearest-pint"');
    expect(dearest).toContain('<h3 class="lpHuntDearestTitle" id="lp-hunt-dearest-title">London&#x27;s dearest pint</h3>');
    expect(text(part(dearest, /<p class="lpHuntFigure"[\s\S]*?<\/p>/))).toBe(
      "£9.50for the cheapest pint at Baccarat Bar, London",
    );
    expect(text(part(dearest, /<p class="lpHuntSource"[\s\S]*?<\/p>/))).toBe(
      "Listed by Pint Prices, source read 2 October 2026.",
    );
  });

  it("calls no city empty on the strength of a read that failed", () => {
    const unread: CheapestHunt = { britain: null, cities: [], londonDearest: null };
    expect(renderToStaticMarkup(createElement(LandingHuntCities, { hunt: unread }))).toBe("");
  });

  it("sits below the fold, after the hero and its collage", () => {
    const page = renderToStaticMarkup(
      createElement(LandingPage, { huntCities: createElement(LandingHuntCities, { hunt }) }),
    );
    const heroEnd = page.indexOf("</section>", page.indexOf('class="screen lpHero"'));
    expect(page.indexOf('class="lpHunt"')).toBeGreaterThan(heroEnd);
  });
});
