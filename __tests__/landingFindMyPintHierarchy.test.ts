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
vi.mock("@/components/landing/ThamesHero", () => ({ default: () => null }));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("@/lib/cityPreference", () => ({
  preferredCityMapHref: () => "/choose-city",
  readPreferredCity: () => null,
  subscribePreferredCity: () => () => {},
}));

import LandingPage from "@/components/landing/LandingPage";

// One primary action is permanent; Plan, Map, Tonight and location stay visible
// as text links.

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

describe("landing Pub Pal hierarchy", () => {
  it("keeps the hierarchy permanent without a landing flag", () => {
    expect(pageTsx).not.toMatch(/readTrustedHandoffFlags/);
    expect(pageTsx).not.toMatch(/landingFindMyPint/);
    expect(landingTsx).not.toMatch(/landingFindMyPint/);
    // The client landing component reads no environment at all, whatever a
    // future flag is called. Kept from the flag era on purpose.
    expect(landingTsx).not.toMatch(/process\.env/);
    expect(landingTsx).not.toMatch(/PUBMAX_LANDING_FIND_MY_PINT/);
  });

  it("uses Meet your Pub Pal as the only primary action", () => {
    const rendered = renderToStaticMarkup(createElement(LandingPage));
    const hero = rendered.match(/<section class="lpHero"[\s\S]*?<\/section>/)?.[0];
    expect(hero, "landing hero present").toBeTruthy();
    expect(hero).toMatch(
      /class="lpButton lpButtonPrimary"[^>]*href="\/pal"[^>]*>[\s\S]*?Meet your Pub Pal/,
    );
    expect(hero?.match(/class="lpButton lpButtonPrimary"/g)).toHaveLength(1);
    expect(hero).toContain("Sign in to keep it");
    expect(landingTsx).not.toMatch(/lpHeroActions--mapFirst/);
    expect(landingTsx).not.toMatch(/lpHeroActions--findMyPint/);
  });

  it("asks for location only from the two deliberate CTAs, never the footer", () => {
    const rendered = renderToStaticMarkup(createElement(LandingPage));
    const footerNav = rendered.match(
      /<nav class="lpFooterNav"[^>]*>[\s\S]*?<\/nav>/,
    )?.[0];
    expect(footerNav, "footer nav present").toBeTruthy();
    expect(footerNav).toMatch(/href="\/near"/);
    expect(footerNav).not.toMatch(/locate=1/);
    expect(rendered.match(/href="\/near\?locate=1"/g)).toHaveLength(2);
  });

  it("keeps Plan, Map, Tonight and Find my pint visible as lower-weight text links", () => {
    const rendered = renderToStaticMarkup(createElement(LandingPage));
    const secondaryBlock = rendered.match(
      /<div class="lpHeroSecondaryRow">[\s\S]*?<\/div>/,
    )?.[0];
    expect(secondaryBlock, "secondary action row present").toBeTruthy();
    expect(secondaryBlock).toMatch(/href="\/plan"[\s\S]*Plan tonight together/);
    expect(secondaryBlock).toMatch(/href="\/map"[\s\S]*Open the map/);
    expect(secondaryBlock).toMatch(/href="\/tonight"[\s\S]*Tonight/);
    expect(secondaryBlock).toMatch(/href="\/near\?locate=1"[\s\S]*Find my pint/);
    expect(secondaryBlock).not.toMatch(/lpButtonQuiet/);
  });

  it("opens the Map directly for a stranger and keeps city choice explicit", () => {
    const rendered = renderToStaticMarkup(createElement(LandingPage));
    const landingNav = rendered.match(
      /<nav class="lpPrimaryNav"[^>]*>[\s\S]*?<\/nav>/,
    )?.[0];
    expect(landingNav, "landing navigation present").toBeTruthy();
    expect(landingNav).toMatch(/href="\/map"[^>]*>Map<\/a>/);

    const openMapLinks = [
      ...rendered.matchAll(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g),
    ].filter((match) => match[2].includes("Open the map"));
    expect(openMapLinks.length).toBeGreaterThan(0);
    expect(openMapLinks.every((match) => match[1] === "/map")).toBe(true);
    expect(rendered).toMatch(/href="\/choose-city"[^>]*>Pick your city<\/a>/);
  });

  it("CSS scopes dominant primary and high-contrast secondary text", () => {
    expect(landingCss).toMatch(/\.lpHeroActions\s*\{/);
    expect(landingCss).toMatch(/\.lpHeroSecondaryRow\s*\{/);
    expect(landingCss).toMatch(
      /\.lpHeroSecondaryRow \.lpTextLink\s*\{[\s\S]*?color:\s*var\(--ink\)/,
    );
    expect(landingCss).toMatch(
      /\.lpButtonPrimary\s*\{[\s\S]*?color:\s*var\(--color-on-accent\)/,
    );
    // Mobile: no equal-weight Pal/Plan/Map button group.
    expect(landingCss).toMatch(
      /\.lpHeroActions\s*\{[^}]*grid-template-columns:\s*1fr/,
    );
  });

  it("preserves Pint Drop eight-second fail-soft hang path (do not rework)", () => {
    expect(pintDropStrip).toMatch(/8_000|8000/);
    expect(pintDropStrip).toMatch(/hangTimer/);
    expect(pintDropStrip).toMatch(/current === "loading" \? "empty"/);
    expect(pintDropStrip).toMatch(/status === "hidden" \|\| status === "empty"/);
  });
});
