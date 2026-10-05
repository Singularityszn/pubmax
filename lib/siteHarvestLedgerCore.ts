// Shared site-harvest ledger logic for the operator CLIs.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import {
  bundleRowSupersedes,
  ukPriceBundleCollectKey,
  type UkPriceBundleLane,
  type UkPriceBundleRow,
} from "@/lib/ukPriceBundle";

export type SiteHarvestLedgerRow = {
  venueId?: string;
  category?: string;
  priceGbp?: number;
  observedAt?: string;
  sourceUrl?: string;
  name?: string | null;
  host?: string;
  drinkLabel?: string;
  drinkName?: string;
  servingSize?: string;
  robotsDisallowed?: boolean;
};

const SITE_HARVEST_LANE: UkPriceBundleLane = "site-harvest";

const PRINTED_MEASURE_SUFFIX = /^(.*?)\s*(\d{2,3})\s*ml$/i;

/**
 * A wine row harvested before servings were read apart carries its glass
 * measure in its name ("Merlot 175ml"). Split it the way the harvester now
 * writes it ("Merlot", 175ml), so a re-read of the same page supersedes the old
 * row instead of standing beside it.
 */
export function normalizeSiteHarvestLedgerRow(row: SiteHarvestLedgerRow): SiteHarvestLedgerRow {
  if (row.category !== "wine" || row.servingSize !== undefined) return row;
  const label = row.drinkLabel ?? row.drinkName;
  if (typeof label !== "string") return row;
  const match = PRINTED_MEASURE_SUFFIX.exec(label.trim());
  const name = match?.[1]?.replace(/^[/|\s\u2013\u2014-]+/, "").trim();
  if (!match || !name) return row;
  return {
    ...row,
    ...(row.drinkLabel !== undefined ? { drinkLabel: name } : { drinkName: name }),
    servingSize: `${match[2]}ml`,
  };
}

function resolveSiteHarvestVenueId(
  row: SiteHarvestLedgerRow,
  curatedOwners: ReadonlyMap<string, string>,
): string | null {
  const osmRef =
    typeof row.venueId === "string" ? row.venueId.replace(/^venue-uk-/, "") : null;
  const venueId = (osmRef && curatedOwners.get(osmRef)) || row.venueId;
  return typeof venueId === "string" && venueId.length > 0 ? venueId : null;
}

export function siteHarvestLedgerCollectKey(
  ledgerRow: SiteHarvestLedgerRow,
  curatedOwners: ReadonlyMap<string, string>,
): string | null {
  const row = normalizeSiteHarvestLedgerRow(ledgerRow);
  const venueId = resolveSiteHarvestVenueId(row, curatedOwners);
  if (!venueId || typeof row.category !== "string" || row.category.length === 0) {
    return null;
  }
  const raw = row.drinkLabel ?? row.drinkName;
  return ukPriceBundleCollectKey({
    venueId,
    category: row.category,
    lane: SITE_HARVEST_LANE,
    drinkLabel: typeof raw === "string" ? raw : undefined,
    servingSize: row.servingSize,
  });
}

function ledgerRowAsBundleRow(
  row: SiteHarvestLedgerRow,
  curatedOwners: ReadonlyMap<string, string>,
): UkPriceBundleRow | null {
  const venueId = resolveSiteHarvestVenueId(row, curatedOwners);
  if (
    !venueId ||
    typeof row.category !== "string" ||
    typeof row.priceGbp !== "number" ||
    typeof row.observedAt !== "string"
  ) {
    return null;
  }
  return {
    venueId,
    name: row.name ?? null,
    category: row.category,
    priceGbp: row.priceGbp,
    lane: SITE_HARVEST_LANE,
    standing: "listed",
    sourceUrl: row.sourceUrl ?? null,
    publisher: row.host ?? null,
    observedAt: row.observedAt,
    basis: null,
    sampleSize: null,
    ...(typeof row.drinkLabel === "string" && row.drinkLabel.trim()
      ? { drinkLabel: row.drinkLabel.trim() }
      : {}),
    ...(row.servingSize !== undefined ? { servingSize: row.servingSize } : {}),
  };
}

/** Fold duplicate collect keys, keeping the row the bundle builder would keep. */
export function dedupeSiteHarvestLedgerRows(
  rows: readonly SiteHarvestLedgerRow[],
  curatedOwners: ReadonlyMap<string, string>,
): SiteHarvestLedgerRow[] {
  const held = new Map<string, SiteHarvestLedgerRow>();
  const bundleHeld = new Map<string, UkPriceBundleRow>();

  for (const ledgerRow of rows) {
    const row = normalizeSiteHarvestLedgerRow(ledgerRow);
    const key = siteHarvestLedgerCollectKey(row, curatedOwners);
    if (!key) continue;
    const asBundle = ledgerRowAsBundleRow(row, curatedOwners);
    if (!asBundle) continue;
    const previous = bundleHeld.get(key);
    if (!previous || bundleRowSupersedes(asBundle, previous)) {
      held.set(key, row);
      bundleHeld.set(key, asBundle);
    }
  }

  return [...held.values()].sort((a, b) => {
    const ka = siteHarvestLedgerCollectKey(a, curatedOwners) ?? "";
    const kb = siteHarvestLedgerCollectKey(b, curatedOwners) ?? "";
    return ka.localeCompare(kb);
  });
}

export function parseSiteHarvestLedgerText(text: string): SiteHarvestLedgerRow[] {
  return text
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      try {
        return JSON.parse(line) as SiteHarvestLedgerRow;
      } catch {
        return null;
      }
    })
    .filter((row): row is SiteHarvestLedgerRow => row !== null && typeof row === "object");
}

/** Curated venue id per UK-base OSM ref, matching `scripts/build_uk_price_bundle.mjs`. */
export function loadCuratedUkBaseOwners(root = process.cwd()): Map<string, string> {
  const manifestPath = path.join(root, "public/data/uk_base/manifest.json");
  if (!existsSync(manifestPath)) return new Map();
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    urlPrefix?: string;
    shards?: { id: string }[];
  };
  const owners = new Map<string, string>();
  for (const shard of manifest.shards ?? []) {
    const file = path.join(root, "public", manifest.urlPrefix ?? "data/uk_base", `${shard.id}.json`);
    if (!existsSync(file)) continue;
    const shardData = JSON.parse(readFileSync(file, "utf8")) as {
      pubs?: [string, unknown, unknown, unknown, unknown, string][];
    };
    for (const pub of shardData.pubs ?? []) {
      const osmRef = pub[0];
      const curatedVenueId = pub[5];
      if (typeof curatedVenueId === "string" && curatedVenueId.length > 0) {
        owners.set(osmRef, curatedVenueId);
      }
    }
  }
  return owners;
}

export function siteHarvestLedgerDuplicateKeys(
  rows: readonly SiteHarvestLedgerRow[],
  curatedOwners: ReadonlyMap<string, string>,
): string[] {
  const seen = new Set<string>();
  const dupes: string[] = [];
  for (const row of rows) {
    const key = siteHarvestLedgerCollectKey(row, curatedOwners);
    if (!key) continue;
    if (seen.has(key)) dupes.push(key);
    else seen.add(key);
  }
  return dupes;
}
