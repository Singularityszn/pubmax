// WHERE THE THREE "CREATE" ROWS LIVE NOW.
//
// Captain, 1 Nov 2026 (docs/plans/LAUNCH_PLAN_2026-11-01.md, decision 13):
// the phone gets five tabs, Airbnb style, and the floating + button goes. It
// sat over content on most pages, the landing page's first pub card included.
// Nothing it offered was removed; each row moved to the surface it belongs to.
//
// - Post a moment: Social (signed in) and You keep a door to /moment.
// - Log a price: the venue sheet's price door, and "Log a price" in More map
//   controls, which asks which pub on the map the reader is on.
// - Start a plan: the Plan tab, which IS the composer.
//
// The routes stay: /moment and /map?log=1 still answer.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }),
}));

import MapPriceLogDoor from "@/components/map/MapPriceLogDoor";
import SocialMomentLink from "@/components/social/SocialMomentLink";
import {
  PHONE_NAV_ITEMS,
  returnToFromLocation,
  safeMomentReturnTo,
  momentHref,
} from "@/components/nav/navigationModel";
import { hasMapLogIntent } from "@/lib/mapUrlIntent";
import { priceContributionMapHref } from "@/lib/priceContributionIntent";

const ROOT = join(__dirname, "..");
const read = (relative: string): string => readFileSync(join(ROOT, relative), "utf8");

describe("the app shell carries no floating create button", () => {
  it("mounts none in the root layout and loads no stylesheet for one", () => {
    expect(read("app/layout.tsx")).not.toMatch(/CreateFab/);
    expect(read("app/root-shell.css")).not.toMatch(/createFab/);
    expect(existsSync(join(ROOT, "components/nav/CreateFab.tsx"))).toBe(false);
  });

  it("publishes no create berth in the floating stack", () => {
    const stack = read("components/nav/mobileNav.css");
    expect(stack).not.toMatch(/--create-fab-|--float-stack-top-create/);
    expect(stack).not.toMatch(/\.createFabRoot/);
  });
});

describe("Post a moment lives on Social and You", () => {
  it("gives a signed-in Social reader a door to the Moment composer that comes back to Social", () => {
    const markup = renderToStaticMarkup(createElement(SocialMomentLink));
    expect(markup).toContain('href="/moment?returnTo=%2Fsocial"');
    expect(markup).toContain(">Save a Moment<");
    // Mounted beside the signed-in reader's other ways onward.
    const social = read("app/social/SocialPageClient.tsx");
    const nightLinks = social.slice(social.indexOf('className="socialNightLinks"'));
    expect(nightLinks.slice(0, nightLinks.indexOf("</nav>"))).toContain("<SocialMomentLink />");
  });

  it("keeps the memory studio's own door on You", () => {
    expect(read("components/profile/NightMemoryStudio.tsx")).toMatch(/href="\/moment"/);
  });

  it("keeps the /moment route and its safe way back", () => {
    expect(existsSync(join(ROOT, "app/moment/page.tsx"))).toBe(true);
    const href = momentHref("/map?sel=venue-123");
    const returnTo = new URL(href, "https://pubmaxxing.com").searchParams.get("returnTo");
    expect(returnTo).toBe("/map?sel=venue-123");
    expect(safeMomentReturnTo(returnTo)).toBe("/map?sel=venue-123");
  });
});

describe("Log a price lives on the map and the venue sheet", () => {
  it("offers the door in More map controls, on the map's own server address", () => {
    const markup = renderToStaticMarkup(createElement(MapPriceLogDoor));
    expect(markup).toContain('href="/map?contribute=price"');
    expect(markup).toContain("Log a price");
    expect(read("components/PubMap.tsx")).toContain("<MapPriceLogDoor />");
  });

  it("keeps the venue sheet's one price door", () => {
    expect(read("components/map/inspector/VenueOverviewTab.tsx")).toContain('data-price-door="log"');
  });

  it("asks which pub on the map the reader is on, keeping its city and drink", () => {
    expect(priceContributionMapHref("/map", "/map")).toBe("/map?contribute=price");
    expect(priceContributionMapHref("/map?drink=wine&q=Soho", "/map")).toBe(
      "/map?drink=wine&q=Soho&contribute=price",
    );
    expect(priceContributionMapHref("/map/bristol?drink=cocktail", "/map")).toBe(
      "/map/bristol?drink=cocktail&contribute=price",
    );
    // A one-pub request or a typed figure is not carried into "which pub?".
    expect(priceContributionMapHref("/map?log=1&price=5.2&sel=venue-1", "/map")).toBe(
      "/map?sel=venue-1&contribute=price",
    );
  });

  it("sends a reader off the map to the remembered city's map", () => {
    expect(priceContributionMapHref("/places/manchester", "/map")).toBe("/map?contribute=price");
    expect(priceContributionMapHref("/tonight", "/map/manchester")).toBe("/map/manchester?contribute=price");
    // A path that only starts like the map is not the map.
    expect(priceContributionMapHref("/mapped", "/map")).toBe("/map?contribute=price");
  });

  it("keeps /map?log=1 as a route", () => {
    expect(hasMapLogIntent("?log=1")).toBe(true);
  });
});

describe("Start a plan lives on the Plan tab", () => {
  it("is one of the five phone tabs, and the tab is the composer", () => {
    expect(PHONE_NAV_ITEMS.find((item) => item.key === "plan")?.href).toBe("/plan");
    expect(read("app/plan/page.tsx")).toContain("<PlanComposer />");
  });
});

// The Map writes its selection into the URL with history.pushState, which the
// Next router never hears, so a returnTo taken from useSearchParams alone came
// back a bare /map after a reader had tapped a pin.
describe("where a composer is told to come back to", () => {
  it("takes the live address bar over the router's reading", () => {
    expect(
      returnToFromLocation({ pathname: "/map", search: "?sel=venue-123" }, "/map"),
    ).toBe("/map?sel=venue-123");
  });

  it("keeps a route with no query intact", () => {
    expect(returnToFromLocation({ pathname: "/out", search: "" }, "/map")).toBe("/out");
  });

  it("falls back to the router's reading when there is no window to read", () => {
    expect(returnToFromLocation(null, "/out?day=weekend")).toBe("/out?day=weekend");
    expect(returnToFromLocation(undefined, "/out")).toBe("/out");
    expect(returnToFromLocation({ pathname: "", search: "?a=1" }, "/out")).toBe("/out");
    // Never an off-site or scheme-relative path, whatever the location said.
    expect(returnToFromLocation({ pathname: "//evil.example", search: "" }, "/out")).toBe(
      "//evil.example",
    );
    expect(safeMomentReturnTo("//evil.example")).toBe("/map");
  });
});
