import { readFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { isFoodCategory } from "@/lib/food";
import { nightOutPlaceRowValidationErrors } from "@/lib/nightOutPlaceContract.mjs";
import { famousRowsForRebuild } from "@/scripts/build_slim_index.mjs";
import { applyVerification } from "@/scripts/verify_famous_venues.mjs";
import { famousSeedLapsedAt } from "./helpers/currentFamousVenues";
import { normalizeVenueName } from "@/scripts/lib/famousVenuePlacesMatch.mjs";
import { defined } from "@/__tests__/helpers/defined";

const ROOT = path.resolve(__dirname, "..");
const FAME_GATES = new Set([
  "recognition",
  "longevity",
  "cultural_weight",
  "distinct_experience",
]);

type FamousVenueRow = {
  id: string;
  name: string;
  address: string;
  borough: string;
  lat: number;
  lng: number;
  kind: "bar" | "food" | "restaurant";
  hasStory: true;
  fameGates: Array<{ kind: string; sourceUrl: string }>;
  category: "bar" | "late_food" | "restaurant";
  job: "late_night_bar" | "crawl_ending_food" | "near_pub_food";
  description: string;
  area: string;
  location: { lat: number; lng: number };
  sourceUrl: string;
  sourceName: string;
  observedAt: string;
  expiresAt: string;
  discoveredVia: "manual";
  extractedVia: "manual";
  anchor: {
    kind:
      | "house_cocktail"
      | "pint"
      | "wine"
      | "large_doner"
      | "signature_item"
      | "signature_dish";
    label: string;
    course?: string;
    price: number;
    observedAt: string;
    sourceUrl: string;
  };
  story: { text: string; sourceUrl: string };
  placesNameAliases?: string[];
};

function loadSeed(file: string): FamousVenueRow[] {
  return JSON.parse(
    readFileSync(path.join(ROOT, "data", "famous_venues", file), "utf8"),
  ) as FamousVenueRow[];
}

const PACKS = [
  ["bars.json", 38, "bar"],
  ["late_food.json", 25, "food"],
  ["restaurants.json", 25, "restaurant"],
] as const;

describe("famous venue seeds", () => {
  it.each([...PACKS])(
    "%s contains exactly %i contract-valid venues",
    (file, count, kind) => {
      const rows = loadSeed(file);
      expect(rows).toHaveLength(count);
      expect(new Set(rows.map((row) => row.id)).size).toBe(count);

      for (const row of rows) {
        expect(row.id).toMatch(
          /^(?:(?:bar|food|restaurant)-[a-z0-9-]+|venue-[a-z0-9]+)$/,
        );
        expect(row.name.trim().length).toBeGreaterThan(1);
        expect(row.address.trim().length).toBeGreaterThan(5);
        expect(row.borough.trim().length).toBeGreaterThan(1);
        expect(row.kind).toBe(kind);
        expect(row.category).toBe(
          kind === "bar" ? "bar" : kind === "food" ? "late_food" : "restaurant",
        );
        expect(row.job).toBe(
          kind === "bar"
            ? "late_night_bar"
            : kind === "food"
              ? "crawl_ending_food"
              : "near_pub_food",
        );
        expect(row.hasStory).toBe(true);
        expect(row.lat).toBeGreaterThanOrEqual(51.26);
        expect(row.lat).toBeLessThanOrEqual(51.72);
        expect(row.lng).toBeGreaterThanOrEqual(-0.55);
        expect(row.lng).toBeLessThanOrEqual(0.3);
        expect(
          new Set(row.fameGates.map((gate) => gate.kind)).size,
        ).toBeGreaterThanOrEqual(2);
        expect(
          row.fameGates.every(
            (gate) =>
              FAME_GATES.has(gate.kind) && /^https:\/\//.test(gate.sourceUrl),
          ),
        ).toBe(true);
        // Fame must not be self-attested: at least one gate has to cite a host
        // other than the venue's own site.
        expect(
          row.fameGates.some(
            (gate) =>
              new URL(gate.sourceUrl).hostname !==
              new URL(row.sourceUrl).hostname,
          ),
          `${row.id} has no independent fame-gate source`,
        ).toBe(true);
        expect(row.sourceUrl).toMatch(/^https:\/\//);
        expect(Number.isNaN(Date.parse(row.observedAt))).toBe(false);
        expect(row.anchor.price).toBeGreaterThan(0);
        if (kind === "restaurant") {
          expect(row.id).toMatch(/^restaurant-[a-z0-9-]+$/);
          expect(row.anchor.kind).toBe("signature_dish");
          expect(
            isFoodCategory(row.anchor.course),
            `${row.id} anchor course "${row.anchor.course}"`,
          ).toBe(true);
        } else {
          expect(row.anchor.course, `${row.id} is not a dish`).toBeUndefined();
        }
        expect(row.anchor.label.trim().length).toBeGreaterThan(2);
        expect(row.anchor.sourceUrl).toMatch(/^https:\/\//);
        expect(Number.isNaN(Date.parse(row.anchor.observedAt))).toBe(false);
        expect(row.story.text.trim().length).toBeGreaterThan(20);
        expect(row.story.sourceUrl).toMatch(/^https:\/\//);
        expect(nightOutPlaceRowValidationErrors(row)).toEqual([]);
      }
    },
  );

  it("carries every field required by the provenance registry", () => {
    const registry = JSON.parse(
      readFileSync(
        path.join(ROOT, "data", "famous_venue_provenance_registry.json"),
        "utf8",
      ),
    ) as { requiredRowFields: string[] };
    const rows = PACKS.flatMap(([file]) => loadSeed(file));

    for (const row of rows) {
      for (const field of registry.requiredRowFields) {
        expect(row, `${row.id} missing ${field}`).toHaveProperty(field);
      }
    }
  });

  it("keeps IDs unique across both packs", () => {
    const rows = PACKS.flatMap(([file]) => loadSeed(file));
    expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length);
  });

  it("keeps Places name aliases normalized and only where the name alone cannot match", () => {
    for (const row of PACKS.flatMap(([file]) => loadSeed(file))) {
      for (const alias of row.placesNameAliases ?? []) {
        expect(alias, row.id).toBe(normalizeVenueName(alias));
        expect(alias, row.id).not.toBe(normalizeVenueName(row.name));
      }
    }
  });

  describe("slim rebuild", () => {
    type SlimPayload = { generatedAt: string; rows: { id: string; kind: string }[] };
    const committedSlim = (): SlimPayload =>
      JSON.parse(
        readFileSync(path.join(ROOT, "public", "data", "venues_slim.json"), "utf8"),
      ) as SlimPayload;
    const shippedFamousIds = (payload: SlimPayload) =>
      payload.rows
        .filter((row) => ["bar", "food", "restaurant"].includes(row.kind))
        .map((row) => row.id)
        .sort();
    const keptIds = (result: { rows: { id: string }[] }) =>
      result.rows.map((row) => row.id).sort();
    const seedRows = () => PACKS.flatMap(([file]) => loadSeed(file));

    afterEach(() => {
      vi.useRealTimers();
      vi.restoreAllMocks();
    });

    it("rebuilds at the committed stamp, so a build after the seed lapses stays green", () => {
      vi.spyOn(console, "log").mockImplementation(() => {});
      const lastSlim = committedSlim();
      expect(shippedFamousIds(lastSlim).length).toBeGreaterThan(0);
      vi.useFakeTimers();
      vi.setSystemTime(new Date(famousSeedLapsedAt().getTime() + 7 * 24 * 3_600_000));
      const result = famousRowsForRebuild(seedRows(), {
        lastSlim,
        removedIds: [],
        refreshAt: null,
      });
      expect(result.builtAt.toISOString()).toBe(lastSlim.generatedAt);
      expect(keptIds(result)).toEqual(shippedFamousIds(lastSlim));
    });

    it("refuses a refresh that drops famous venues the last index shipped", () => {
      vi.spyOn(console, "log").mockImplementation(() => {});
      const lapsedAt = famousSeedLapsedAt();
      expect(() =>
        famousRowsForRebuild(seedRows(), {
          lastSlim: committedSlim(),
          removedIds: [],
          refreshAt: lapsedAt,
        }),
      ).toThrow(/slim rebuild would drop famous venue/);
      expect(() =>
        famousRowsForRebuild(seedRows(), {
          lastSlim: { generatedAt: committedSlim().generatedAt, rows: [] },
          removedIds: [],
          refreshAt: lapsedAt,
        }),
      ).toThrow(/slim rebuild would keep 0 famous venues/);
    });

    it("points a build after a seed re-verification at refresh:slim, and the refresh keeps every venue", () => {
      vi.spyOn(console, "log").mockImplementation(() => {});
      const lastSlim = committedSlim();
      const verifiedDay = new Date(Date.parse(lastSlim.generatedAt) + 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);
      const reverified = [
        ...applyVerification(
          new Map(PACKS.map(([file]) => [file, loadSeed(file)])),
          seedRows().map((row) => ({ id: row.id, outcome: "confirmed" as const })),
          verifiedDay,
        ).values(),
      ].flat() as FamousVenueRow[];
      expect(() =>
        famousRowsForRebuild(reverified, { lastSlim, removedIds: [], refreshAt: null }),
      ).toThrow(
        `observed after the committed stamp ${lastSlim.generatedAt}: ${reverified.map((row) => row.id).join(", ")}; the seed was re-verified or added after the committed stamp; run npm run refresh:slim`,
      );
      const refreshed = famousRowsForRebuild(reverified, {
        lastSlim,
        removedIds: [],
        refreshAt: new Date(`${verifiedDay}T12:00:00.000Z`),
      });
      expect(keptIds(refreshed)).toEqual(reverified.map((row) => row.id).sort());
      expect(() =>
        famousRowsForRebuild(seedRows(), {
          lastSlim,
          removedIds: [],
          refreshAt: famousSeedLapsedAt(),
        }),
      ).not.toThrow(/refresh:slim/);
    });

    it("fails a build after a famous seed row is added, naming refresh:slim instead of withholding it", () => {
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      const lastSlim = committedSlim();
      const [template] = seedRows();
      const stampMs = Date.parse(lastSlim.generatedAt);
      const dayMs = 24 * 60 * 60 * 1000;
      const observedAt = new Date(stampMs + dayMs).toISOString().slice(0, 10);
      const expiresAt = new Date(stampMs + 31 * dayMs).toISOString().slice(0, 10);
      const added = {
        ...template,
        id: `${defined(template).id}-added`,
        observedAt,
        expiresAt,
      };
      const seed = [...seedRows(), added];
      expect(() =>
        famousRowsForRebuild(seed, { lastSlim, removedIds: [], refreshAt: null }),
      ).toThrow(
        new RegExp(`${added.id}; the seed was re-verified or added after the committed stamp; run npm run refresh:slim, then commit the slim`),
      );
      expect(log).not.toHaveBeenCalled();
      const refreshed = famousRowsForRebuild(seed, {
        lastSlim,
        removedIds: [],
        refreshAt: new Date(`${observedAt}T12:00:00.000Z`),
      });
      expect(keptIds(refreshed)).toContain(added.id);
    });

    it("refuses a build-time rebuild with no committed stamp to rebuild at", () => {
      expect(() =>
        famousRowsForRebuild(seedRows(), { lastSlim: null, removedIds: [], refreshAt: null }),
      ).toThrow(/refresh:slim/);
    });

    it("lets a venue named in removed.json leave the seed and keeps the guard for the rest", () => {
      vi.spyOn(console, "log").mockImplementation(() => {});
      const lastSlim = committedSlim();
      const [gone, other] = shippedFamousIds(lastSlim);
      const seed = seedRows().filter((row) => row.id !== gone && row.id !== other);
      expect(() =>
        famousRowsForRebuild(seed, { lastSlim, removedIds: [defined(gone)], refreshAt: null }),
      ).toThrow(new RegExp(`not in data/famous_venues/removed.json: ${other}$`));
      const result = famousRowsForRebuild(
        seedRows().filter((row) => row.id !== gone),
        { lastSlim, removedIds: [defined(gone)], refreshAt: null },
      );
      expect(keptIds(result)).toEqual(shippedFamousIds(lastSlim).filter((id) => id !== gone));
      expect(() =>
        famousRowsForRebuild(seedRows(), {
          lastSlim,
          removedIds: shippedFamousIds(lastSlim),
          refreshAt: famousSeedLapsedAt(),
        }),
      ).toThrow(/not current at/);
    });

    it("names in removed.json only venues that have left the seed", () => {
      const removed = JSON.parse(
        readFileSync(path.join(ROOT, "data", "famous_venues", "removed.json"), "utf8"),
      ) as unknown[];
      expect(Array.isArray(removed)).toBe(true);
      const seedIds = new Set(seedRows().map((row) => row.id));
      for (const id of removed) {
        expect(typeof id).toBe("string");
        expect(seedIds.has(id as string), String(id)).toBe(false);
      }
    });
  });
});
