import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it, vi } from "vitest";

vi.mock("next/dynamic", () => ({
  default: () => () => null,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ prefetch: () => Promise.resolve() }),
}));
vi.mock("@/components/auth/SignInButton", () => ({ default: () => null }));
vi.mock("@/components/brand/PubmaxxWordmark", () => ({ default: () => null }));
vi.mock("@/components/city/CityChooser", () => ({ default: () => null }));
vi.mock("@/components/nav/MessagesLink", () => ({ default: () => null }));
vi.mock("@/components/nav/NotificationBell", () => ({ default: () => null }));
vi.mock("@/components/ThemeToggle", () => ({ default: () => null }));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("@/lib/cityPreference", () => ({
  preferredCityMapHref: () => "/choose-city",
  readPreferredCity: () => null,
  subscribePreferredCity: () => () => {},
}));

import LandingPage from "@/components/landing/LandingPage";

// The landing hierarchy is permanent and no flag decides it (captain
// 2026-09-03, issue #1354; 2026-09-04, issue #1357): ONE primary action, the
// price receipt door, with the Pal as the quiet second door. With a real pub
// behind the document the door is "Still £X?" into that pub's Pint Drop
// composer; with no card it is the plain receipt door. Every other route off
// the page is a text link below the hero or a directory link in the footer.

const landingTsx = readFileSync(
  join(process.cwd(), "components/landing/LandingPage.tsx"),
  "utf8",
);
const landingCss = readFileSync(
  join(process.cwd(), "components/landing/landing.css"),
  "utf8",
);
const pageTsx = readFileSync(join(process.cwd(), "app/page.tsx"), "utf8");
const pintDropStrip = readFileSync(
  join(process.cwd(), "components/landing/PintDropStrip.tsx"),
  "utf8",
);

import type { LandingPubCardData } from "@/lib/landingPubCard";

const card: LandingPubCardData = {
  id: "venue-test",
  name: "The Blackfriar",
  area: "City of London",
  priceGbp: 6.5,
  pintName: "a pint of Pravha",
  publisher: { label: "Pint Prices", url: "https://www.pint-prices.com/pub/x" },
  collectedOn: "2026-07-03",
  standing: "listed",
  then: {
    priceGbp: 3.6,
    observedOn: "2013-07-14",
    source: { label: "beerintheevening.com", url: "https://www.beerintheevening.com/pubs/x" },
  },
  movementLine: "Up £2.90 in 13 years.",
  mapHref: "/map?sel=venue-test",
};

function render(withCard = true): string {
  return renderToStaticMarkup(createElement(LandingPage, withCard ? { card } : {}));
}

function hero(rendered: string): string {
  const match = rendered.match(/<section class="screen lpHero"[\s\S]*?<\/section>/)?.[0];
  expect(match, "landing hero present").toBeTruthy();
  return match ?? "";
}

describe("landing hierarchy: the price receipt door", () => {
  it("keeps the hierarchy permanent without a landing flag", () => {
    expect(pageTsx).not.toMatch(/readTrustedHandoffFlags/);
    expect(pageTsx).not.toMatch(/landingFindMyPint/);
    expect(landingTsx).not.toMatch(/landingFindMyPint/);
    // The client landing component reads no environment at all, whatever a
    // future flag is called. Kept from the flag era on purpose.
    expect(landingTsx).not.toMatch(/process\.env/);
    expect(landingTsx).not.toMatch(/PUBMAX_LANDING_FIND_MY_PINT/);
  });

  it("uses the pub's own Pint Drop door as the only primary action, the Pal as the second door", () => {
    const h = hero(render());
    expect(h).toMatch(
      /data-primary-action=""><a[^>]*href="\/map\?sel=venue-test&amp;log=1"[^>]*>Still £6\.50\?<\/a>/,
    );
    expect(h.match(/data-primary-action/g)).toHaveLength(1);
    expect(h).toMatch(/class="screenSecondary"><a[^>]*href="\/pal"[^>]*>Meet your Pub Pal<\/a>/);
    // No card behind the document: the plain receipt door, still the one primary.
    const bare = hero(render(false));
    expect(bare).toMatch(
      /data-primary-action=""><a[^>]*href="\/near\?locate=1"[^>]*>Log what you paid<\/a>/,
    );
    expect(bare.match(/data-primary-action/g)).toHaveLength(1);
    expect(bare).not.toContain("lpPubCard");
    // The old landing button family is gone, so nothing else can wear coral.
    expect(h).not.toContain("lpButton");
    expect(landingTsx).not.toMatch(/lpHeroActions--mapFirst|lpHeroActions--findMyPint|lpButtonPrimary/);
  });

  it("asks for location only from the receipt door, never the footer", () => {
    const rendered = render(false);
    const footerNav = rendered.match(/<nav class="lpFooterNav"[^>]*>[\s\S]*?<\/nav>/)?.[0];
    expect(footerNav, "footer nav present").toBeTruthy();
    expect(footerNav).toMatch(/href="\/near"/);
    expect(footerNav).not.toMatch(/locate=1/);
    expect(rendered.match(/href="\/near\?locate=1"/g)).toHaveLength(1);
    // With a card the door is the pub's own, and the card's Near me control
    // asks in the browser on a tap; nothing on the page carries locate=1.
    expect(render()).not.toMatch(/locate=1/);
  });

  it("counts the landing's own calls to action: one primary, one second door, one text link", () => {
    const rendered = render();
    expect(rendered.match(/data-primary-action/g)).toHaveLength(1);
    expect(rendered.match(/class="screenSecondary"/g)).toHaveLength(1);
    const textLinks = [...rendered.matchAll(/<a[^>]*class="lpTextLink"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => m[1]);
    expect(textLinks).toEqual(["Open the map"]);
  });

  it("opens the Map directly for a stranger and keeps city choice explicit", () => {
    const rendered = render();
    const landingNav = rendered.match(/<nav class="lpPrimaryNav"[^>]*>[\s\S]*?<\/nav>/)?.[0];
    expect(landingNav, "landing navigation present").toBeTruthy();
    expect(landingNav).toMatch(/href="\/map"[^>]*>Map<\/a>/);

    const openMapLinks = [
      ...rendered.matchAll(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g),
    ].filter((match) => match[2].includes("Open the map"));
    expect(openMapLinks.length).toBeGreaterThan(0);
    expect(openMapLinks.every((match) => match[1] === "/map")).toBe(true);
    expect(rendered).toMatch(/href="\/choose-city"[^>]*>Pick your city<\/a>/);
  });

  it("CSS: the hero fills the viewport and the desktop only widens the phone order", () => {
    expect(landingCss).toMatch(/\.lpHero\s*{[^}]*min-height:\s*100dvh/);
    expect(landingCss).toMatch(/@media \(min-width: 960px\)\s*{\s*\.lpHero\s*{[^}]*grid-template-columns/);
    // The desktop seats things on a grid by AREA; nothing is reordered with
    // `order`, so the DOM order stays the phone order.
    expect(landingCss).not.toMatch(/\.lpHero[^{]*{[^}]*\border:\s*-?\d/);
    // No decoration behind the copy, no glass, no dot grid, no photo card.
    expect(landingCss).not.toMatch(/orbit|scanline|backdrop-filter|radial-gradient|thamesHero|cinema/i);
  });

  it("preserves Pint Drop eight-second fail-soft hang path (do not rework)", () => {
    expect(pintDropStrip).toMatch(/8_000|8000/);
    expect(pintDropStrip).toMatch(/hangTimer/);
    expect(pintDropStrip).toMatch(/current === "loading" \? "empty"/);
    expect(pintDropStrip).toMatch(/status === "hidden" \|\| status === "empty"/);
  });
});
