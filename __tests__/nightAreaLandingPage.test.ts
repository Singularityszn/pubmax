import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

vi.mock("next/navigation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/navigation")>();
  return {
    ...actual,
    useRouter: () => ({
      back: () => undefined,
      forward: () => undefined,
      refresh: () => undefined,
      push: () => undefined,
      replace: () => undefined,
      prefetch: () => Promise.resolve(),
    }),
  };
});

import NightAreaLandingPage, {
  generateMetadata,
  generateStaticParams,
} from "@/app/area/[slug]/page";

describe("governed area landing page", () => {
  it("prebuilds only the four eligible area slugs", async () => {
    await expect(generateStaticParams()).resolves.toEqual([
      { slug: "clapham" },
      { slug: "victoria" },
      { slug: "piccadilly-soho" },
      { slug: "canary-wharf" },
    ]);
  });

  it("publishes canonical metadata from the governed landing model", async () => {
    await expect(generateMetadata({ params: Promise.resolve({ slug: "victoria" }) })).resolves.toMatchObject({
      title: "Cheapest pints in Victoria · PUBMAXXING",
      alternates: { canonical: "/area/victoria" },
      openGraph: { url: "/area/victoria" },
    });
  });

  it("renders ranked prices with collection date and exact publisher links", async () => {
    const page = await NightAreaLandingPage({
      params: Promise.resolve({ slug: "clapham" }),
    });
    const html = renderToStaticMarkup(createElement(() => page));

    expect(html).toContain("Cheapest pints in Clapham");
    expect(html).toContain("35 pubs with listed Pint Prices");
    expect(html).toContain("Collected 3 July 2026");
    expect(html).toContain("The Hand in Hand");
    expect(html).toContain("£3.10");
    expect(html).toContain("Pint Prices");
    expect(html).toContain("https://www.pint-prices.com/pub/");
    expect(html).toContain("href=\"/map?q=Clapham\"");
    expect(html).toContain("href=\"/plan\"");
    expect(html).toContain("<table");
    expect(html).toContain("Cheapest pint");
    expect(html).toContain("Publisher");
    expect(html).not.toContain("Night Area");
    expect(html).not.toContain("route-ready");
  });

  it("returns not found for an unpublished area", async () => {
    await expect(NightAreaLandingPage({
      params: Promise.resolve({ slug: "camden" }),
    })).rejects.toThrow(/NEXT_HTTP_ERROR_FALLBACK;404/);
  });
});
