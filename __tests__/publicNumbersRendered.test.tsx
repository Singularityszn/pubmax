import { promises as fs } from "node:fs";
import { JSDOM } from "jsdom";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ prefetch: () => Promise.resolve() }),
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/components/auth/SignInButton", () => ({ default: () => null }));
vi.mock("@/components/nav/MessagesLink", () => ({ default: () => null }));
vi.mock("@/components/nav/NotificationBell", () => ({ default: () => null }));
vi.mock("@/components/nav/SiteNav", () => ({ default: () => null, SiteNavActions: () => null }));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("@/lib/publicPintIndexSnapshot.server", () => ({
  loadPublicPintIndexSnapshot: async () => null,
}));

import AboutPage from "@/app/about/page";
import LandingPage from "@/components/landing/LandingPage";
import { loadAboutStats, resetAboutStatsForTests } from "@/lib/aboutStats";
import { loadLandingHeroData, resetLandingHeroDataForTests } from "@/lib/landingPubCard.server";

function resetPublicLoaders() {
  resetAboutStatsForTests();
  resetLandingHeroDataForTests();
}

function text(document: Document, selector: string): string {
  return (document.querySelector(selector)?.textContent ?? "").replace(/\s+/g, " ").trim();
}

describe("Home and About render the same public price figures", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetPublicLoaders();
  });

  it.each([
    { low: 4, high: 6, average: "£5.00" },
    { low: 5, high: 7, average: "£6.00" },
  ])("renders $average from fifteen £$low pubs and fifteen £$high pubs", async ({ low, high, average }) => {
    resetPublicLoaders();
    const rows = Array.from({ length: 30 }, (_, index) => ({
      app_price_id: `fixture-price-${index}`,
      pub_name: `Fixture Arms ${index}`,
      address: `${index} Fixture Street`,
      latitude: 51.51,
      longitude: -0.12,
      primary_borough: "Camden",
      pint_name: "Guinness",
      price_gbp: index < 15 ? low : high,
      price_text: `£${index < 15 ? low : high}`,
      pub_url: `https://www.pint-prices.com/pub/fixture-${index}`,
      source_datasets: "Pint Prices",
      scraped_at_values: "2026-10-02T12:00:00Z",
    }));
    const originalRead = fs.readFile.bind(fs);
    vi.spyOn(fs, "readFile").mockImplementation((...args: Parameters<typeof fs.readFile>) => {
      if (String(args[0]).endsWith("pint_prices_app_dataset.json")) {
        return Promise.resolve(JSON.stringify(rows)) as ReturnType<typeof fs.readFile>;
      }
      return originalRead(...args);
    });

    const [, hero] = await Promise.all([loadAboutStats(), loadLandingHeroData()]);
    const home = new JSDOM(renderToStaticMarkup(<LandingPage {...hero} />)).window.document;
    const about = new JSDOM(renderToStaticMarkup(await AboutPage())).window.document;

    expect(text(home, ".lpSavingSummary")).toContain(`across 30 priced London pubs is ${average}.`);
    expect(text(about, ".aboutPriceLine")).toContain(`The average listed pint across 30 London pubs is ${average}`);
    expect(text(about, 'section[aria-labelledby="traction"]')).toContain("PUBMAXX holds a price for 30 pubs from 30 pint prices on record");
  });
});
