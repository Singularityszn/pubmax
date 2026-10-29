import { promises as fs } from "node:fs";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/components/nav/SiteNav", () => ({ default: () => null }));
vi.mock("@/lib/publicPintIndexSnapshot.server", () => ({ loadPublicPintIndexSnapshot: async () => null }));
vi.mock("@/lib/ogCardRateLimit", () => ({ ogCardRateLimitedResponse: async () => null }));
vi.mock("next/og", () => ({
  ImageResponse: class {
    constructor(element: ReactNode, options?: ResponseInit) {
      return new Response(renderToStaticMarkup(element), options);
    }
  },
}));

import AboutPage from "@/app/about/page";
import { GET } from "@/app/api/home-card/route";
import { resetAboutStatsForTests } from "@/lib/aboutStats";

const rows = Array.from({ length: 30 }, (_, i) => ({
  pub_name: `Recovery Arms ${i}`, address: `${i} Recovery Street`,
  latitude: 51.51, longitude: -0.12, primary_borough: "Camden",
  pint_name: "Guinness", price_gbp: 5, price_text: "£5.00",
  pub_url: `https://www.pint-prices.com/pub/recovery-${i}`,
  source_datasets: "Pint Prices", scraped_at_values: "2026-10-02T12:00:00Z",
}));

beforeEach(resetAboutStatsForTests);
afterEach(() => { vi.restoreAllMocks(); resetAboutStatsForTests(); });

function failFirstRead(kind: "EIO" | "malformed") {
  const original = fs.readFile.bind(fs);
  let reads = 0;
  vi.spyOn(fs, "readFile").mockImplementation((...args: Parameters<typeof fs.readFile>) => {
    if (!String(args[0]).endsWith("pint_prices_app_dataset.json")) return original(...args);
    reads += 1;
    if (reads === 1 && kind === "EIO") return Promise.reject(Object.assign(new Error("Temporary read failure"), { code: "EIO" }));
    return Promise.resolve(reads === 1 ? "{broken" : JSON.stringify(rows)) as ReturnType<typeof fs.readFile>;
  });
  return () => reads;
}

describe.each(["EIO", "malformed"] as const)("public statistics entry recovery after %s", (kind) => {
  it("renders About without false figures, then recovers on the next request", async () => {
    const reads = failFirstRead(kind);
    const initial = renderToStaticMarkup(await AboutPage());
    expect(initial).toContain("temporarily unavailable");
    expect(initial).not.toMatch(/(?:for|across) 0 pubs|£0\.00/);
    const recovered = renderToStaticMarkup(await AboutPage());
    expect(recovered).toContain("30 pubs");
    expect(recovered).toContain("£5.00");
    expect(reads()).toBe(2);
  });

  it("serves an uncached share card without false figures, then recovers", async () => {
    const reads = failFirstRead(kind);
    const initial = await GET(new Request("http://localhost/api/home-card"));
    expect(initial.status).toBe(200);
    expect(initial.headers.get("cache-control")).toContain("no-store");
    expect(await initial.text()).not.toMatch(/0 pubs|0 prices|£0\.00/);
    const recovered = await GET(new Request("http://localhost/api/home-card"));
    expect(recovered.status).toBe(200);
    expect(await recovered.text()).toContain("30 pubs tracked");
    expect(reads()).toBe(2);
  });
});
