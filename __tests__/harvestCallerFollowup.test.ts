import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  fetchSourceBoundPage,
  permittedSitemapUrls,
} from "../scripts/lib/harvestCallerTransport.mjs";

const ROOT = join(process.cwd());
const read = (relativePath: string) => readFileSync(join(ROOT, relativePath), "utf8");

describe("harvest caller transport follow-up contracts", () => {
  it("binds sitemap locs to their recorded first-party publisher", () => {
    expect(read("scripts/harvest_chain_menu_prices.mjs")).toMatch(/isHarvestableChainMenuUrl/);
    expect(read("scripts/refresh_drink_prices.mjs")).toMatch(/isHarvestableDrinkUpdateUrl/);
    expect(read("scripts/refresh_pint_price_observations.mjs")).toMatch(/isHarvestableOperatorUrl/);
  });

  it("filters foreign sitemap locs before any page fetch", () => {
    const allowed = "https://www.example.test/pub-menu/allowed";
    const foreign = "https://other.example.test/pub-menu/foreign";
    expect(
      permittedSitemapUrls(
        `<urlset><loc>${allowed}</loc><loc>${foreign}</loc></urlset>`,
        (url) => new URL(url).hostname === "www.example.test",
      ),
    ).toEqual([allowed]);
  });

  it("blocks a foreign redirect before its landing page fetch", async () => {
    const requested = "https://www.example.test/pub-menu";
    const foreign = "https://other.example.test/pub-menu";
    const calls: string[] = [];
    const redirect = new Response("redirect body", {
      status: 302,
      headers: { location: foreign },
    });
    const cancel = vi.spyOn(redirect.body!, "cancel");
    const fetchImpl = async (input: string | URL) => {
      const url = String(input);
      calls.push(url);
      if (url === requested) return redirect;
      return new Response("foreign page", { status: 200 });
    };

    await expect(
      fetchSourceBoundPage(requested, async () => ({ allowed: true, reason: "allowed", evidence: "fixture" }), {
        sourcePredicate: (url) => new URL(url).hostname === "www.example.test",
        fetchImpl,
      }),
    ).rejects.toThrow(/source-specific policy refused/i);

    expect(calls).toEqual([requested]);
    expect(cancel).toHaveBeenCalled();
  });

  it("returns the final URL for a permitted same-publisher redirect", async () => {
    const requested = "https://www.example.test/pub-menu";
    const landed = "https://www.example.test/pub-menu/current";
    const calls: string[] = [];
    const result = await fetchSourceBoundPage(
      requested,
      async () => ({ allowed: true, reason: "allowed", evidence: "fixture" }),
      {
        sourcePredicate: (url) => new URL(url).hostname === "www.example.test",
        fetchImpl: async (input: string | URL) => {
          const url = String(input);
          calls.push(url);
          if (url === requested) {
            return new Response("redirect body", { status: 302, headers: { location: landed } });
          }
          return new Response("landed page", { status: 200 });
        },
      },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.url).toBe(landed);
      expect(await result.response.text()).toBe("landed page");
    }
    expect(calls).toEqual([requested, landed]);
  });

  it("retains final transport URLs in emitted provenance", () => {
    expect(read("scripts/harvest_chain_menu_prices.mjs")).toMatch(/finalUrl/);
    expect(read("scripts/refresh_drink_prices.mjs")).toMatch(/finalUrl/);
    expect(read("scripts/spoonme/import-report.mjs")).toMatch(/finalUrl/);
    expect(read("scripts/whatson/commonRefresh.mjs")).toMatch(/finalUrl/);
    expect(read("scripts/whatson/quizRefresh.mjs")).toMatch(/finalUrl/);
    expect(read("scripts/whatson/scrape_greene_king_sport.mjs")).toMatch(/finalUrl/);
  });

  it("releases non-success response bodies before retry, skip or throw", () => {
    for (const relativePath of [
      "scripts/fetch_wetherspoons_pubs.mjs",
      "scripts/harvest_chain_menu_prices.mjs",
      "scripts/refresh_drink_prices.mjs",
      "scripts/refresh_pint_price_observations.mjs",
      "scripts/spoonme/import-report.mjs",
      "scripts/whatson/quizRefresh.mjs",
      "scripts/whatson/scrape_greene_king_sport.mjs",
    ]) {
      expect(read(relativePath), relativePath).toMatch(/discardBody/);
    }
  });

  it("records a refused chain sitemap instead of treating it as an empty success", () => {
    const source = read("scripts/harvest_chain_menu_prices.mjs");
    expect(source).toMatch(/sitemap-fetch-failed/);
    expect(source).toMatch(/sourcesSkipped|skipped\.push/);
  });
});
