import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  bandFromHeritageStructureProbability,
  HERITAGE_STRUCTURE_ACCEPT_THRESHOLD,
  HERITAGE_STRUCTURE_REFUSE_THRESHOLD,
  isHeritageStructureProbability,
} from "@/lib/heritageListingStructure";
import { HERITAGE_STRUCTURE_FIXTURE_CASES } from "./fixtures/typesafe/heritageStructureFixtureCases";

const FIXTURE_PROBS = path.join(
  process.cwd(),
  "__tests__/fixtures/typesafe/heritage-structure-probabilities.json",
);

describe("bandFromHeritageStructureProbability", () => {
  it.each([
    [1, "accept"],
    [HERITAGE_STRUCTURE_ACCEPT_THRESHOLD, "accept"],
    [HERITAGE_STRUCTURE_ACCEPT_THRESHOLD - 0.0001, "review"],
    [0.5, "review"],
    [HERITAGE_STRUCTURE_REFUSE_THRESHOLD + 0.0001, "review"],
    [HERITAGE_STRUCTURE_REFUSE_THRESHOLD, "refuse"],
    [0, "refuse"],
  ] as const)("puts %s in the %s band", (probability, band) => {
    expect(bandFromHeritageStructureProbability(probability)).toBe(band);
  });

  it.each([["0.95"], [95], [1.5], [true], [Number.NaN], [null], [undefined]])(
    "refuses the non-probability %p",
    (value) => {
      expect(isHeritageStructureProbability(value)).toBe(false);
      expect(bandFromHeritageStructureProbability(value)).toBe("refuse");
    },
  );
});

describe("recorded heritage-structure thresholds", () => {
  const doc = JSON.parse(readFileSync(FIXTURE_PROBS, "utf8")) as {
    caseCount: number;
    model: string;
    acceptThreshold: number;
    refuseThreshold: number;
    cases: Array<{
      id: string;
      labelListingIsPubBuilding: boolean;
      labelSource: string;
      probability: number;
      band: string;
    }>;
  };
  const hand = doc.cases.filter((row) => row.labelSource === "hand");

  it("records every hand-labelled case and names the model", () => {
    expect(doc.caseCount).toBe(HERITAGE_STRUCTURE_FIXTURE_CASES.length);
    expect(doc.cases).toHaveLength(doc.caseCount);
    expect(doc.model).not.toBe("unknown");
    expect(doc.acceptThreshold).toBe(HERITAGE_STRUCTURE_ACCEPT_THRESHOLD);
    expect(doc.refuseThreshold).toBe(HERITAGE_STRUCTURE_REFUSE_THRESHOLD);
    expect(hand.map((row) => row.id).sort()).toEqual(
      HERITAGE_STRUCTURE_FIXTURE_CASES.map((c) => c.id).sort(),
    );
    for (const row of doc.cases) {
      expect(isHeritageStructureProbability(row.probability), row.id).toBe(true);
    }
  });

  it("keeps every adjacent-structure listing clear of the accept threshold", () => {
    const adjacent = hand.filter((row) => !row.labelListingIsPubBuilding);
    expect(adjacent.length).toBeGreaterThanOrEqual(4);
    for (const row of adjacent) {
      expect(row.probability, row.id).toBeLessThan(HERITAGE_STRUCTURE_ACCEPT_THRESHOLD);
      expect(bandFromHeritageStructureProbability(row.probability), row.id).not.toBe("accept");
      expect(row.band, row.id).not.toBe("accept");
    }
  });

  it("keeps every pub-building listing clear of the refuse threshold", () => {
    const buildings = hand.filter((row) => row.labelListingIsPubBuilding);
    expect(buildings.length).toBeGreaterThanOrEqual(4);
    for (const row of buildings) {
      expect(row.probability, row.id).toBeGreaterThan(HERITAGE_STRUCTURE_REFUSE_THRESHOLD);
      expect(bandFromHeritageStructureProbability(row.probability), row.id).not.toBe("refuse");
    }
  });

  it("pins the Duke of Hamilton stables as not the pub building", () => {
    const stables = hand.find((row) => row.id === "duke-hamilton-stables");
    const gate = hand.find((row) => row.id === "gate-public-house");
    expect(stables?.labelListingIsPubBuilding).toBe(false);
    expect(gate?.labelListingIsPubBuilding).toBe(true);
    expect(bandFromHeritageStructureProbability(stables?.probability)).not.toBe("accept");
    expect(bandFromHeritageStructureProbability(gate?.probability)).toBe("accept");
  });
});
