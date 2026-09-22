import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { lookup } from "node:dns/promises";
import { describe, expect, it, vi } from "vitest";

import {
  createPinnedHarvestLookup,
  fetchHarvestedPage,
  HarvestOutboundRefusal,
  resolvePublicHarvestAddress,
} from "@/lib/harvest/robots";

const PAGE_CALLERS = [
  "scripts/backfill_site_harvest_drink_labels.mjs",
  "scripts/editorial/poll.mjs",
  "scripts/fetch_wetherspoons_pubs.mjs",
  "scripts/harvest/uk-prices/ocr.mjs",
  "scripts/harvest/uk-prices/run.mjs",
  "scripts/harvest_chain_menu_prices.mjs",
  "scripts/refresh_drink_prices.mjs",
  "scripts/refresh_pint_price_observations.mjs",
  "scripts/spoonme/import-report.mjs",
  "scripts/whatson/commonRefresh.mjs",
  "scripts/whatson/quizRefresh.mjs",
  "scripts/whatson/scrape_greene_king_sport.mjs",
] as const;

// Direct fetches outside PAGE_CALLERS are fixed APIs, fixed dataset downloads,
// image bytes, or local QA probes. Each exception is named so a new raw fetch
// cannot silently become another harvested-page transport.
const DIRECT_FETCH_EXCEPTIONS: Readonly<Record<string, string>> = {
  "scripts/build_heritage_listings.mjs": "fixed NHLE ArcGIS feature API",
  "scripts/check_freshness.mjs": "fixed Supabase PostgREST reads",
  "scripts/clerk-auth-firefox-proof.mjs": "fixed Clerk API proof",
  "scripts/enrich_heritage.mjs": "fixed Wikidata SPARQL and Supabase APIs",
  "scripts/enrich_landmark_attribution.mjs": "fixed Wikimedia metadata API",
  "scripts/evaluate_open_pubs.mjs": "fixed official dataset archive download",
  "scripts/fetch_city_osm_pubs.mjs": "fixed Overpass API endpoint",
  "scripts/fetch_wikidata_notable_pubs.mjs": "fixed Wikidata SPARQL API",
  "scripts/gen_london_localities.mjs": "fixed Overpass API endpoint",
  "scripts/ingest_night_signal_candidates.mjs": "fixed Exa provider API",
  "scripts/integrate_wikipedia_london_pubs.mjs": "fixed Wikidata SPARQL API",
  "scripts/landing/build-landing-photos.mjs": "image bytes and fixed image metadata APIs",
  "scripts/lib/overpassClient.mjs": "fixed Overpass API endpoints",
  "scripts/perf-ab.mjs": "local application QA requests",
  "scripts/perf-baseline.mjs": "local application QA requests",
  "scripts/probe-api-budgets.mjs": "provider API budget probes",
  "scripts/pubpal/create-elevenlabs-agent.mjs": "fixed ElevenLabs provider API",
  "scripts/refresh_weather_snapshots.mjs": "fixed Open-Meteo API",
  "scripts/rls/session-harness.mjs": "fixed Supabase Auth and PostgREST APIs",
  "scripts/spoonme/import-report.mjs": "none; page fetch must use shared transport",
  "scripts/harvest/uk-prices/menu-urls.mjs": "fixed Supabase PostgREST API",
};

describe("harvested page transport", () => {
  it("refuses mixed public/private DNS answers before dialing", async () => {
    const lookupImpl = vi.fn(async () => [
      { address: "8.8.8.8", family: 4 as const },
      { address: "127.0.0.1", family: 4 as const },
    ]) as unknown as typeof lookup;

    await expect(resolvePublicHarvestAddress("menu.example", lookupImpl)).rejects.toBeInstanceOf(HarvestOutboundRefusal);
    expect(lookupImpl).toHaveBeenCalledWith("menu.example", { all: true, verbatim: true });
  });

  it("pins every socket lookup to the already-vetted address", () => {
    const callback = vi.fn();
    const lookupAddress = createPinnedHarvestLookup({ address: "8.8.8.8", family: 4 });
    lookupAddress("menu.example", { all: false }, callback);
    expect(callback).toHaveBeenCalledWith(null, "8.8.8.8", 4);

    const allCallback = vi.fn();
    lookupAddress("menu.example", { all: true }, allCallback);
    expect(allCallback).toHaveBeenCalledWith(null, [{ address: "8.8.8.8", family: 4 }]);
  });

  it("checks permission for each safe redirect before reading its bytes", async () => {
    const events: string[] = [];
    const robots = vi.fn(async (url: string) => {
      events.push(`robots:${new URL(url).pathname}`);
      return { allowed: true, reason: "allowed", evidence: "fixture" } as const;
    });
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      events.push(`fetch:${new URL(url).pathname}`);
      expect(init?.redirect).toBe("manual");
      if (url.endsWith("/start")) {
        return new Response(null, { status: 302, headers: { location: "/menu" } });
      }
      return new Response("menu text");
    });

    const result = await fetchHarvestedPage("https://menu.example/start", robots, {}, { fetchImpl: fetchImpl as typeof fetch });
    expect(result).toMatchObject({ ok: true, url: "https://menu.example/menu" });
    expect(await (result as Extract<typeof result, { ok: true }>).response.text()).toBe("menu text");
    expect(events).toEqual([
      "robots:/start",
      "fetch:/start",
      "robots:/menu",
      "fetch:/menu",
    ]);
  });

  it("refuses private redirect landings before robots or fetch can touch them", async () => {
    const robots = vi.fn(async () => ({ allowed: true, reason: "allowed", evidence: "fixture" } as const));
    const fetchImpl = vi.fn(async () => new Response(null, {
      status: 302,
      headers: { location: "http://169.254.169.254/latest/meta-data/" },
    }));

    const result = await fetchHarvestedPage("https://menu.example/start", robots, {}, { fetchImpl: fetchImpl as typeof fetch });
    expect(result).toMatchObject({ ok: false, reason: "source-policy" });
    expect(robots).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("keeps every harvested page caller on the fence and inventories raw-fetch exceptions", () => {
    for (const file of PAGE_CALLERS) {
      const source = readFileSync(file, "utf8");
      expect(source, file).toContain("fetchHarvestedPage(");
      expect(source, file).not.toMatch(/\bfetch\s*\(/);
    }

    const sources = execFileSync("rg", ["--files", "scripts", "-g", "*.mjs", "-g", "*.ts"], { encoding: "utf8" })
      .trim()
      .split("\n")
      .filter(Boolean);
    const rawFetchFiles = sources
      .filter((file) => /\bfetch\s*\(/.test(readFileSync(file, "utf8")))
      .sort();
    const exceptions = Object.keys(DIRECT_FETCH_EXCEPTIONS).sort();
    expect(rawFetchFiles.filter((file) => DIRECT_FETCH_EXCEPTIONS[file] !== "none; page fetch must use shared transport")).toEqual(exceptions.filter((file) => DIRECT_FETCH_EXCEPTIONS[file] !== "none; page fetch must use shared transport"));
    expect(DIRECT_FETCH_EXCEPTIONS["scripts/spoonme/import-report.mjs"]).toBe("none; page fetch must use shared transport");
  });
});
