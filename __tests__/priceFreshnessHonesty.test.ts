import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import PintIndexArrival from "@/components/pintindex/PintIndexArrival";
import {
  evaluateRegistry,
  hasBreach,
  type FreshnessRegistry,
} from "@/lib/freshness";
import {
  formatPintDatasetAsOf,
  PINT_DATASET_OBSERVED_AT,
  PINT_DATASET_PRESENTATION_BUDGET_DAYS,
  PINT_DATASET_STALENESS_BUDGET_DAYS,
} from "@/lib/dataFreshness";
import { COMMUNITY_PRICE_MAX_AGE_MS } from "@/lib/communityPrice";
import { PRICE_AUTHORITY_MAX_AGE_MS } from "@/lib/priceAuthorityWindow";

const ROOT = join(__dirname, "..");
const AS_OF_LABEL = formatPintDatasetAsOf();

describe("price freshness honesty (Grok W5.7)", () => {
  const registry = JSON.parse(
    readFileSync(join(ROOT, "data", "freshness_registry.json"), "utf8"),
  ) as FreshnessRegistry;

  it("registers price_updates as a RETIRED lane with no machine staleness budget", () => {
    const entry = registry.datasets.find((dataset) => dataset.id === "price_updates");
    expect(entry).toMatchObject({
      class: "episodic",
      retired: true,
      stalenessBudgetHours: null,
      artifact: "public/data/price_updates/latest.json",
    });
  });

  it("keeps the served price_updates envelope on the pint dataset collection day", () => {
    const latest = JSON.parse(
      readFileSync(join(ROOT, "public/data/price_updates/latest.json"), "utf8"),
    ) as { generatedAt: string; updates: unknown[] };

    expect(latest.updates).toEqual([]);
    expect(new Date(latest.generatedAt).toISOString()).toBe(
      PINT_DATASET_OBSERVED_AT.toISOString(),
    );
  });

  it("reports the closed baseline lane as retired rather than merely unbudgeted", () => {
    const now = new Date("2026-08-20T12:00:00.000Z");
    const results = evaluateRegistry(
      registry,
      (dataset) => {
        if (dataset.id === "price_updates") {
          return {
            observedAt: PINT_DATASET_OBSERVED_AT.toISOString(),
            reason: null,
          };
        }
        return { observedAt: "2026-08-18T00:00:00Z", reason: null };
      },
      now,
    );

    // `untracked` was the old answer and it read as "not budgeted", which is a
    // sentence about a lane somebody might still refresh. Nobody can refresh
    // this one: the publish and its stub parser are deleted. Never a breach
    // either way, so the release gate is untouched.
    const priceUpdates = results.find((row) => row.id === "price_updates");
    expect(priceUpdates?.status).toBe("retired");
    expect(priceUpdates?.status).not.toBe("untracked");
    expect(hasBreach(results.filter((row) => row.id === "price_updates"))).toBe(
      false,
    );
  });

  // The drinker-facing question and the release-gate question have two owners
  // on purpose. These three tests pin each owner and the gap between them; a
  // change that collapses them back into one number fails here.

  it("does not let a bundled price outlive community prices in what a drinker is told", () => {
    const presentationBudgetMs =
      PINT_DATASET_PRESENTATION_BUDGET_DAYS * 24 * 60 * 60 * 1000;

    expect(presentationBudgetMs).toBeLessThanOrEqual(COMMUNITY_PRICE_MAX_AGE_MS);
    expect(presentationBudgetMs).toBe(PRICE_AUTHORITY_MAX_AGE_MS);
  });

  it("keeps the release gate on a neglect ceiling, not the drinker-facing window", () => {
    // The registry budget answers "has nobody re-collected this bundle", so it
    // is deliberately looser than the price-authority window. Tying it to that
    // window would turn the CI freshness gate red the moment the bundle passed
    // 30 days, which for a hand-collected episodic feed is ordinary, not neglect.
    const gateBudgetMs =
      PINT_DATASET_STALENESS_BUDGET_DAYS * 24 * 60 * 60 * 1000;

    expect(gateBudgetMs).toBeGreaterThan(PRICE_AUTHORITY_MAX_AGE_MS);
    expect(
      registry.datasets.find((dataset) => dataset.id === "pint_prices")
        ?.stalenessBudgetHours,
    ).toBe(PINT_DATASET_STALENESS_BUDGET_DAYS * 24);
  });

  it("does not alarm the release gate while the bundle is inside its neglect ceiling", () => {
    const observedAt = PINT_DATASET_OBSERVED_AT.toISOString();
    const justPastPriceAuthority = new Date(
      PINT_DATASET_OBSERVED_AT.getTime() +
        PRICE_AUTHORITY_MAX_AGE_MS +
        60 * 60 * 1000,
    );
    const results = evaluateRegistry(
      registry,
      () => ({ observedAt, reason: null }),
      justPastPriceAuthority,
    );

    // Past the price-authority window it is named a SNAPSHOT, never "fresh":
    // the bundle describes its collection day. That is a naming change and not
    // a breach, so the release gate stays quiet.
    const justPast = results.find((row) => row.id === "pint_prices");
    expect(justPast?.status).toBe("snapshot");
    expect(hasBreach(results.filter((row) => row.id === "pint_prices"))).toBe(
      false,
    );

    const pastNeglectCeiling = new Date(
      PINT_DATASET_OBSERVED_AT.getTime() +
        PINT_DATASET_STALENESS_BUDGET_DAYS * 24 * 60 * 60 * 1000 +
        60 * 60 * 1000,
    );
    const neglected = evaluateRegistry(
      registry,
      () => ({ observedAt, reason: null }),
      pastNeglectCeiling,
    );

    expect(neglected.find((row) => row.id === "pint_prices")?.status).toBe(
      "stale",
    );
  });

  // Structural guard, not a style rule. A reader surface that reaches for the
  // registry budget re-merges the two owners in silence: the label tightens
  // only by loosening what a drinker is told, or the release gate turns red as
  // a side effect of a copy change. This is how the two got merged the first
  // time, so the fence names the mistake rather than a file list.
  it("keeps reader surfaces off the release-gate budget", () => {
    const surfaceRoots = ["components", "app"];
    const offenders: string[] = [];

    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(entry.name)) continue;
        if (readFileSync(full, "utf8").includes("PINT_DATASET_STALENESS_BUDGET_DAYS")) {
          offenders.push(full.slice(ROOT.length + 1));
        }
      }
    };

    for (const root of surfaceRoots) walk(join(ROOT, root));

    expect(offenders).toEqual([]);
  });

  it("prints the bundled baseline as-of date on the Pint Index arrival strip", () => {
    const html = renderToStaticMarkup(
      createElement(PintIndexArrival, {
        areas: [
          {
            slug: "camden",
            name: "Camden",
            pricedCount: 12,
            cheapestGbp: 4.5,
            cheapestVenueId: "venue-camden",
          },
        ],
        surface: "index",
      }),
    );

    expect(html).toContain(AS_OF_LABEL);
  });
});
