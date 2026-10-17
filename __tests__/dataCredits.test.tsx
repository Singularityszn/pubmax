// @vitest-environment jsdom

// EVERY OUTSIDE SOURCE HAS ITS CREDIT, AND EVERY SURFACE THAT SHOWS ONE LINKS
// TO THEM ALL (owner decision, 16 Oct 2026).
//
// lib/dataCredits.ts is the one table /credits prints. A committed pack that
// declares a licence must belong to an entry by licence and publisher, so a
// source cannot ship its data without its credit; and the surfaces that print a
// source's credit carry the one link to /credits (DataCreditsLink).

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import DataCreditsPage from "@/app/credits/page";
import sitemap from "@/app/sitemap";
import PlaceIndexCredit from "@/components/city/PlaceIndexCredit";
import MapCredits from "@/components/map/MapCredits";
import VenueHygiene from "@/components/map/VenueHygiene";
import CoffeePilotSheet from "@/components/map/CoffeePilotSheet";
import DeskDataCredit from "@/components/nearme/DeskDataCredit";
import { creditForPack, DATA_CREDITS, DATA_CREDITS_PATH } from "@/lib/dataCredits";
import { READ_PHASE_DELAY_MS } from "@/lib/useStaggeredRead";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ROOT = process.cwd();

/** Every committed public/data JSON envelope that declares a licence. */
function licensedPacks(): Array<{ path: string; pack: Record<string, unknown> }> {
  const found: Array<{ path: string; pack: Record<string, unknown> }> = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        // Immutable shard generations repeat their manifest's envelope.
        if (entry.name !== "packs") walk(path);
        continue;
      }
      if (!entry.name.endsWith(".json") || statSync(path).size > 30_000_000) continue;
      let pack: unknown;
      try {
        pack = JSON.parse(readFileSync(path, "utf8"));
      } catch {
        continue;
      }
      if (!pack || typeof pack !== "object" || Array.isArray(pack)) continue;
      const record = pack as Record<string, unknown>;
      if ([record.license, record.licence, record.$licence].some((value) => typeof value === "string")) {
        found.push({ path: path.slice(ROOT.length + 1), pack: record });
      }
    }
  };
  walk(join(ROOT, "public/data"));
  return found;
}

describe("the credits table", () => {
  it("credits every committed pack that declares a licence", () => {
    const packs = licensedPacks();
    expect(packs.length).toBeGreaterThan(5);
    const uncredited = packs.filter(({ pack }) => creditForPack(pack) === null).map(({ path }) => path);
    expect(uncredited).toEqual([]);
  });

  it.each([
    // The packs the enrichment lanes write, as their builders shape them.
    [{ license: "ODbL 1.0", source: "OpenStreetMap", attribution: "© OpenStreetMap contributors" }, "openstreetmap"],
    [
      { license: "Open Government Licence v3.0", source: "Food Standards Agency, Food Hygiene Rating Scheme" },
      "fsa-fhrs",
    ],
    [
      {
        $licence: "Open Government Licence v3.0",
        $source: "Historic England — National Heritage List for England (NHLE), Listed Building points",
      },
      "historic-england-nhle",
    ],
    [{ license: "CC0 1.0", source: "Wikidata" }, "wikidata"],
  ])("places %j under its own credit", (pack, id) => {
    expect(creditForPack(pack)?.id).toBe(id);
  });

  it("credits nobody for a pack whose licence or publisher it does not hold", () => {
    expect(creditForPack({ license: "ODbL 1.0", source: "Somebody Else" })).toBeNull();
    expect(creditForPack({ license: "All rights reserved", source: "OpenStreetMap" })).toBeNull();
    expect(creditForPack({ source: "OpenStreetMap" })).toBeNull();
  });

  it("names the licence the brief asks for on each open source", () => {
    const byId = new Map(DATA_CREDITS.map((credit) => [credit.id, credit]));
    expect(byId.get("openstreetmap")?.licence?.name).toContain("ODbL");
    expect(byId.get("openstreetmap")?.attribution).toBe("© OpenStreetMap contributors");
    expect(byId.get("fsa-fhrs")?.licence?.name).toBe("Open Government Licence v3.0");
    expect(byId.get("historic-england-nhle")?.licence?.name).toBe("Open Government Licence v3.0");
    expect(byId.get("wikidata")?.licence?.name).toContain("CC0");
    expect(byId.get("tfl")?.attribution).toBe("Powered by TfL Open Data");
    expect(new Set(DATA_CREDITS.map((credit) => credit.id)).size).toBe(DATA_CREDITS.length);
    for (const credit of DATA_CREDITS) {
      if (credit.sourceUrl !== null) expect(credit.sourceUrl, credit.id).toMatch(/^https:\/\//);
      if (credit.licence) expect(credit.licence.url, credit.id).toMatch(/^https:\/\//);
    }
  });
});

describe("the published menu prices", () => {
  it("are credited to the menus they were read from, never to drinkers", () => {
    const { updates } = JSON.parse(readFileSync(join(process.cwd(), "public/data/drink_price_updates/latest.json"), "utf8")) as {
      updates: { source: { label: string; licence: string } }[];
    };
    const ids = new Set(DATA_CREDITS.map((credit) => credit.id));
    const published = updates.filter((row) => !/demo/i.test(row.source.label));
    expect(published.length).toBeGreaterThan(0);
    for (const { source } of published) {
      // Every published row is a pub's or a chain's own menu.
      expect(source.licence, source.label).toMatch(/first-party publisher/);
      expect(ids.has(/^Greene King/.test(source.label) ? "greene-king-menus" : "pub-menus"), source.label).toBe(true);
    }
  });
});

describe("/credits", () => {
  it("prints every source with its credit, its licence and a link to it", () => {
    const view = document.createElement("div");
    view.innerHTML = renderToStaticMarkup(DataCreditsPage());
    expect(view.querySelector("h1")?.textContent).toBe("Where our data comes from");
    expect(view.textContent).toContain("Data licence notice");
    const rows = [...view.querySelectorAll("[data-credit]")];
    expect(rows.map((row) => row.getAttribute("data-credit"))).toEqual(DATA_CREDITS.map((credit) => credit.id));
    for (const credit of DATA_CREDITS) {
      const row = view.querySelector(`[data-credit="${credit.id}"]`);
      expect(row?.querySelector("dt")?.textContent).toBe(credit.name);
      expect(row?.textContent).toContain(credit.attribution);
      const hrefs = [...(row?.querySelectorAll("a") ?? [])].map((link) => link.getAttribute("href"));
      if (credit.sourceUrl) expect(hrefs).toContain(credit.sourceUrl);
      else expect(row?.textContent).toContain("Each price links the page it was read from.");
      if (credit.licence) expect(hrefs).toContain(credit.licence.url);
      else expect(row?.textContent).toContain("Used under the publisher's own terms.");
    }
  });

  it("is in the sitemap", async () => {
    expect((await sitemap()).some((entry) => entry.url.endsWith(DATA_CREDITS_PATH))).toBe(true);
  });
});

describe("the surfaces that print a credit link to /credits", () => {
  function creditLinks(markup: string): string[] {
    const view = document.createElement("div");
    view.innerHTML = markup;
    return [...view.querySelectorAll("a")]
      .filter((link) => link.getAttribute("href") === DATA_CREDITS_PATH)
      .map((link) => link.textContent ?? "");
  }

  it.each([
    ["the phone map credits", () => renderToStaticMarkup(createElement(MapCredits, { provider: "openfreemap" }))],
    ["the place-index credit", () => renderToStaticMarkup(createElement(PlaceIndexCredit, { className: "x" }))],
    ["the desk credit", () => renderToStaticMarkup(createElement(DeskDataCredit))],
    [
      "the coffee pilot sheet",
      () =>
        renderToStaticMarkup(
          createElement(CoffeePilotSheet, { cafe: { id: "c1", name: "A Cafe", address: "", lat: 51.52, lng: -0.08, prices: [] } }),
        ),
    ],
  ])("%s", (_label, render) => {
    expect(creditLinks(render())).toHaveLength(1);
  });

  describe("the hygiene badge", () => {
    let root: Root;
    let container: HTMLElement;
    beforeEach(() => {
      vi.useFakeTimers();
      container = document.createElement("div");
      root = createRoot(container);
    });
    afterEach(() => {
      act(() => root.unmount());
      vi.unstubAllGlobals();
      vi.useRealTimers();
    });

    it("links to /credits beside the FSA rating, and not without one", async () => {
      const rating = { fhrsid: 1, ratingValue: 5, ratingDate: null, businessName: "The Lamb", localAuthority: null };
      let body: unknown = { rating };
      vi.stubGlobal(
        "fetch",
        vi.fn<(url: string) => Promise<Response>>(async () => new Response(JSON.stringify(body), { status: 200 })),
      );
      const settle = async () => {
        await act(async () => {
          vi.advanceTimersByTime(READ_PHASE_DELAY_MS[2]);
          await Promise.resolve();
        });
        for (let i = 0; i < 6; i += 1) await act(async () => Promise.resolve());
      };
      act(() => root.render(createElement(VenueHygiene, { venueId: "venue-a", venueName: "The Lamb", address: "WC1N 3LZ" })));
      await settle();
      expect(creditLinks(container.innerHTML)).toEqual(["Data credits"]);

      body = { rating: null };
      act(() => root.render(createElement(VenueHygiene, { venueId: "venue-b", venueName: "Nowhere", address: "WC1N 3LZ" })));
      await settle();
      expect(container.innerHTML).toBe("");
    });
  });
});
