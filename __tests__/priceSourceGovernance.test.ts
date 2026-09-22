// TWO GOVERNANCE TABLES, ONE ANSWER, AND THE NARROWER ONE BINDS.
//
// `data/price_sources.json` is the allowlist the refresh scripts read.
// `lib/harvest/sourcePolicy.ts` is the permission table the harvest reads. They
// disagreed in production: the allowlist marked Nicholson's permissible while
// sourcePolicy refused the Mitchells & Butlers estate on `robots-unreadable`,
// and 1,914 Nicholson's rows shipped on the refused side of that contradiction.
//
// Nothing reconciles two tables by remembering to. This does it on every run.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  HARVEST_SOURCES,
  HARVEST_SKIP_REASONS,
  isRefusedOnPermission,
  type HarvestSource,
} from "@/lib/harvest/sourcePolicy";

const ROOT = join(__dirname, "..");

type PriceSource = {
  id: string;
  label: string;
  url: string;
  kind: string;
  permissible?: boolean;
  licence?: string;
  notes?: string;
};

const priceSources = JSON.parse(
  readFileSync(join(ROOT, "data/price_sources.json"), "utf8"),
) as { sources: PriceSource[]; drinkSources: PriceSource[] };

const hostOf = (url: string): string | null => {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
};

/** Hosts sourcePolicy says we may not read at all. */
const refusedHosts = new Set(
  HARVEST_SOURCES.filter(isRefusedOnPermission)
    .map((source) => hostOf(source.url))
    .filter((host): host is string => host !== null),
);

const allPriceSources = [...priceSources.sources, ...priceSources.drinkSources];

describe("the two price governance tables", () => {
  it("never marks a host permissible that sourcePolicy refuses on permission", () => {
    for (const source of allPriceSources) {
      const host = hostOf(source.url);
      if (!host) continue;
      const refused = [...refusedHosts].some(
        (denied) => host === denied || host.endsWith(`.${denied}`),
      );
      if (!refused) continue;
      expect(
        source.permissible === false,
        `${source.id} (${host}) is refused by sourcePolicy and must not be permissible here`,
      ).toBe(true);
    }
  });

  it("keeps a refused source in the table rather than deleting it, so the gap stays visible", () => {
    const nicholsons = allPriceSources.filter((source) =>
      hostOf(source.url)?.endsWith("nicholsonspubs.co.uk"),
    );
    expect(nicholsons.length).toBeGreaterThan(0);
    for (const source of nicholsons) {
      expect(source.permissible).toBe(false);
      expect(source.notes ?? "").toMatch(/refused/i);
    }
  });

  it("keeps refused Nicholson rows out of every published update snapshot and bundle", () => {
    const updatesDir = join(ROOT, "public/data/drink_price_updates");
    const updateFiles = readdirSync(updatesDir).filter((file) => file.endsWith(".json"));
    const refusedUpdateRows = updateFiles.flatMap((file) => {
      const payload = JSON.parse(readFileSync(join(updatesDir, file), "utf8")) as {
        updates?: Array<{ source?: { url?: string } }>;
      };
      return (payload.updates ?? []).filter((row) =>
        hostOf(row.source?.url ?? "")?.endsWith("nicholsonspubs.co.uk"),
      );
    });
    const bundle = JSON.parse(
      readFileSync(join(ROOT, "public/data/uk_prices/rows.json"), "utf8"),
    ) as Array<{ sourceUrl?: string }>;

    expect(refusedUpdateRows).toHaveLength(0);
    expect(
      bundle.filter((row) => hostOf(row.sourceUrl ?? "")?.endsWith("nicholsonspubs.co.uk")),
    ).toHaveLength(0);
  });

  it("gives every refusal a reason from the closed set", () => {
    for (const source of HARVEST_SOURCES) {
      if (source.access.allowed) continue;
      expect(HARVEST_SKIP_REASONS).toContain(source.access.reason);
      expect(source.access.evidence.trim().length).toBeGreaterThan(0);
      expect(source.access.checkedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("does not treat an empty source as a host we may not read", () => {
    // Greene King and Wetherspoon both gave permission and both publish no web
    // price. Folding that into a permission refusal would bar their own pub
    // pages from every other lane, which would be a false statement about hosts
    // that said yes.
    const empties = HARVEST_SOURCES.filter(
      (source): source is HarvestSource & { access: { allowed: false; reason: string } } =>
        !source.access.allowed && source.access.reason === "publishes-no-web-price",
    );
    expect(empties.length).toBeGreaterThan(0);
    for (const source of empties) {
      expect(isRefusedOnPermission(source)).toBe(false);
    }
  });

  it("records a live robots re-read for every chain menu-price source", () => {
    const priceRows = HARVEST_SOURCES.filter((source) => source.kind === "chain-menu-prices");
    expect(priceRows.length).toBeGreaterThanOrEqual(3);
    for (const source of priceRows) {
      expect(source.firstParty, `${source.id} must be first party`).toBe(true);
      expect(source.access.evidence).toMatch(/robots\.txt/i);
      // A price source is a claim about money, so its permission is re-read
      // rather than inherited from the events sweep.
      expect(source.access.checkedOn >= "2026-09-03").toBe(true);
    }
  });

  it("binds permitted chain menu sources to permissible drinkSources hosts", () => {
    for (const source of HARVEST_SOURCES.filter(
      (candidate) => candidate.kind === "chain-menu-prices" && candidate.access.allowed,
    )) {
      const host = hostOf(source.url);
      const matches = priceSources.drinkSources.filter(
        (candidate) => hostOf(candidate.url) === host,
      );
      expect(matches.length, `${source.id} must have a drinkSources row for ${host}`).toBeGreaterThan(0);
      for (const match of matches) {
        expect(match.permissible, `${match.id} contradicts ${source.id}`).toBe(true);
      }
    }
  });

  it.each(["youngs-menu-prices", "stonegate-menu-prices", "brewdog-menu-prices"])(
    "%s records the day its robots evidence was re-read",
    (sourceId) => {
      const source = HARVEST_SOURCES.find((candidate) => candidate.id === sourceId);
      expect(source?.access.checkedOn).toBe("2026-09-22");
      expect(source?.access.evidence).toContain("robots.txt re-read 2026-09-22");
    },
  );
});
