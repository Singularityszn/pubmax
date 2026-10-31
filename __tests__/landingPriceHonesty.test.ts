import { JSDOM } from "jsdom";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it, vi } from "vitest";

vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ prefetch: () => Promise.resolve() }),
}));
vi.mock("@/components/auth/SignInButton", () => ({ default: () => null }));
vi.mock("@/components/nav/MessagesLink", () => ({ default: () => null }));
vi.mock("@/components/nav/NotificationBell", () => ({ default: () => null }));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));

import LandingFaq from "@/components/landing/LandingFaq";
import LandingHero from "@/components/landing/LandingHero";
import LandingPage from "@/components/landing/LandingPage";
import type { LandingPubCardData } from "@/lib/landingPubCard";

const landing = new JSDOM(renderToStaticMarkup(createElement(LandingPage))).window.document;
const copy = landing.body.textContent ?? "";
const faqText = renderToStaticMarkup(createElement(LandingFaq))
  .replace(/<[^>]+>/g, " ")
  .replace(/&#x27;/g, "'");

const card: LandingPubCardData = {
  id: "venue-test",
  name: "The Test Arms",
  area: "City of London",
  primaryBorough: "City of London",
  priceGbp: 4.13,
  pintName: "a pint of bitter",
  drinkHref: null,
  publisher: { label: "Pub menu", url: "https://example.com/menu" },
  observedOn: "2026-10-02",
  standing: "listed",
  then: {
    priceGbp: 3.5,
    observedOn: "2013-07-14",
    source: { label: "Earlier menu", url: "https://example.com/earlier" },
  },
  movementLine: null,
  mapHref: "/map?sel=venue-test",
};

function renderCard(overrides: Partial<LandingPubCardData> = {}) {
  return new JSDOM(renderToStaticMarkup(createElement(LandingHero, {
    card: { ...card, ...overrides }, archive: {}, rail: [],
  }))).window.document;
}

describe("landing price honesty", () => {
  it("never says every price is dated or sourced", () => {
    for (const banned of [
      "cheap pints near you, live",
      "no endless listings. just",
      "each dated",
      "dated prices",
      "every one dated",
      "every price has a date",
      "a source and a date",
      "a source and the date",
      "every price names where it came from",
      "each sourced",
      "sourced prices",
    ]) {
      expect(copy.toLowerCase(), banned).not.toContain(banned);
    }
  });

  it("explains missing sources and drinker dates once, in the FAQ", () => {
    expect(faqText).toContain("Each price names its publisher when recorded, or says one is missing");
    expect(faqText).toContain("drinker reports show their date");
    expect(faqText.match(/publisher when recorded/g)).toHaveLength(1);
    expect(landing.querySelector("footer")?.textContent).toContain("Free to use. No pub can pay to rank higher.");
  });

  it("keeps the saving beat as one column of plain words", () => {
    const worth = landing.querySelector('section[aria-label="What it saves you"]');
    expect(worth).not.toBeNull();
    expect(copy).not.toContain("The cheapest listed pint near you, on one map.");
    expect(Array.from(worth?.querySelectorAll("a") ?? [], (link) => [
      link.textContent, link.getAttribute("href"),
    ])).toEqual([
      ["Browse pubs across the UK", "/map?uk=1"],
      ["Open the map", "/map"],
    ]);
    expect(worth?.querySelector("[data-primary-action]")).toBeNull();
    expect(worth?.querySelector('a[href="/plan"]')).toBeNull();
    expect(faqText).toContain("Prices can change, so check at the bar.");
  });

  it("keeps UK directory counts separate from the priced London sample", () => {
    const rendered = new JSDOM(renderToStaticMarkup(createElement(LandingPage, {
      ukCoverage: { pubListings: 6, barListings: 3 },
      averages: { sampleSize: 42, averageGbp: 6, cheapAverageGbp: 5 },
    }))).window.document;
    const directory = rendered.querySelector("[data-uk-coverage]")?.textContent;
    expect(directory).toContain("6 UK pub listings and 3 bar listings from OpenStreetMap.");
    expect(directory).toContain("A listing doesn't mean we have its prices or know it's open.");
    expect(rendered.body.textContent).toContain("42 pubs in our London pub list with a listed price is £6.00");
    expect(rendered.body.textContent).toContain("The cheapest third averages £5.00");
  });

  it("keeps UK browse available without inventing a count when metadata is unavailable", () => {
    expect(landing.querySelector("[data-uk-coverage]")).toBeNull();
    expect(landing.querySelector('a[href="/map?uk=1"]')?.textContent)
      .toBe("Browse pubs across the UK");
  });

  it("stays out of the marketing register", () => {
    expect(copy.toLowerCase()).not.toMatch(/\b(journey|unlock|seamless|curated|elevate|empower|discover)\b/u);
    expect(copy).not.toContain("!");
    expect(copy.toLowerCase()).not.toMatch(/thousands of|discord|co-founder/u);
  });

  it.each([
    [4.13, "£4.13", "cheap"],
    [7.41, "£7.41", "expensive"],
  ])("prints the supplied £%s price with its band and publisher", (priceGbp, price, band) => {
    const rendered = renderCard({ priceGbp });
    const badge = rendered.querySelector(".priceBadge--current");
    expect(badge?.textContent).toBe(price);
    expect(badge?.classList.contains(`priceBand-${band}`)).toBe(true);
    const publisher = rendered.querySelector<HTMLAnchorElement>('.lpPubCard a[href="https://example.com/menu"]');
    expect(publisher?.textContent).toBe("Pub menu");
    expect(publisher?.parentElement?.textContent).toContain("Listed by Pub menu, source read 2 October 2026.");
    expect(rendered.body.textContent).not.toContain("No publisher recorded");
  });

  it("prints the missing publisher and date honestly", () => {
    const rendered = renderCard({ publisher: null, observedOn: null });
    expect(rendered.body.textContent).toContain("No publisher recorded, read day not recorded.");
    expect(rendered.body.textContent).not.toContain("Listed by");
    expect(rendered.body.textContent).not.toContain("collected");
    expect(rendered.querySelector('a[href="https://example.com/menu"]')).toBeNull();
  });

  it("prints no pub price when no card data is available", () => {
    expect(landing.querySelector(".lpPubCard")).toBeNull();
    expect(landing.querySelector(".priceBadge--current")).toBeNull();
  });
});
