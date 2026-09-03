import { describe, expect, it } from "vitest";

import {
  ESTIMATE_BASES,
  MIN_ESTIMATE_SAMPLE,
  estimateBasisNote,
  estimateForPub,
  hostOf,
  isEstimateBaselines,
  normaliseOperator,
  postcodeArea,
  type EstimateBaselines,
} from "@/lib/priceEstimate";
import { estimateBaselines } from "@/lib/priceEstimateBaselines";
import { priceStandingFor } from "@/lib/priceTier";

const COMPUTED_AT = "2026-09-03T00:00:00.000Z";

const baselines: EstimateBaselines = {
  version: 1,
  computedAt: COMPUTED_AT,
  method: "test",
  chains: [
    {
      id: "greene-king",
      label: "Greene King",
      medianGbp: 5.5,
      sampleSize: 40,
      operators: ["greene king"],
      hosts: ["greeneking.co.uk"],
      sourceUrls: ["https://www.greeneking.co.uk/pubs/x/menu"],
    },
    {
      id: "thin-chain",
      label: "Thin chain",
      medianGbp: 4,
      sampleSize: MIN_ESTIMATE_SAMPLE - 1,
      operators: ["thin chain"],
      hosts: ["thin.example"],
      sourceUrls: ["https://thin.example/menu"],
    },
  ],
  regions: [
    {
      kind: "london_borough",
      code: "camden",
      label: "Camden",
      medianGbp: 6.6,
      sampleSize: 120,
      provenance: "test",
    },
    {
      kind: "postcode_area",
      code: "BS",
      label: "Postcode area BS",
      medianGbp: 4.9,
      sampleSize: 12,
      provenance: "test",
    },
  ],
};

describe("estimate engine", () => {
  it("names exactly two bases", () => {
    expect(ESTIMATE_BASES).toEqual(["chain_menu", "regional_baseline"]);
  });

  it("matches a chain on its OSM operator whatever the spelling", () => {
    for (const operator of ["Greene King", "greene king plc", "GREENE KING LTD"]) {
      const estimate = estimateForPub({ operator }, baselines);
      expect(estimate?.basis).toBe("chain_menu");
      expect(estimate?.basisKey).toBe("greene-king");
      expect(estimate?.priceGbp).toBe(5.5);
    }
  });

  it("matches a chain on the pub's own website host, subdomains included", () => {
    expect(estimateForPub({ website: "https://www.greeneking.co.uk/pubs/x" }, baselines)?.basisKey).toBe("greene-king");
    expect(estimateForPub({ website: "https://menus.greeneking.co.uk/x" }, baselines)?.basisKey).toBe("greene-king");
    expect(estimateForPub({ website: "https://greeneking.co.uk.evil.example/x" }, baselines)).toBeNull();
  });

  it("prefers the chain basis over the region, because it is the narrower claim", () => {
    const estimate = estimateForPub(
      { operator: "Greene King", londonBoroughCode: "camden" },
      baselines,
    );
    expect(estimate?.basis).toBe("chain_menu");
  });

  it("falls back to the region when no chain matches", () => {
    expect(estimateForPub({ londonBoroughCode: "camden" }, baselines)?.basis).toBe("regional_baseline");
    expect(estimateForPub({ postcode: "BS1 4ST" }, baselines)?.basisKey).toBe("BS");
  });

  it("skips a basis under the sample floor rather than modelling from it quietly", () => {
    expect(estimateForPub({ operator: "Thin chain" }, baselines)).toBeNull();
  });

  it("answers nothing for a pub with no chain and no modelled region", () => {
    expect(estimateForPub({ postcode: "ZZ99 9ZZ" }, baselines)).toBeNull();
    expect(estimateForPub({}, baselines)).toBeNull();
  });

  it("carries basis, sample size and computed day on every estimate it makes", () => {
    const estimate = estimateForPub({ londonBoroughCode: "camden" }, baselines);
    expect(estimate).toMatchObject({ basis: "regional_baseline", sampleSize: 120, computedAt: COMPUTED_AT });
  });

  it("reads a postcode area only from a real postcode", () => {
    expect(postcodeArea("SW1A 1AA")).toBe("SW");
    expect(postcodeArea("bs1 4st")).toBe("BS");
    expect(postcodeArea("LONDON")).toBeNull();
    expect(postcodeArea("")).toBeNull();
  });

  it("refuses a website that is not a URL", () => {
    expect(hostOf("not a url")).toBeNull();
    expect(normaliseOperator("Young & Co's Brewery")).toBe("young and cos brewery");
  });

  it("names the sample in the note, so four prices and four hundred do not read the same", () => {
    const estimate = estimateForPub({ londonBoroughCode: "camden" }, baselines);
    expect(estimate && estimateBasisNote(estimate)).toBe(
      "Modelled from 120 published prices (prices nearby).",
    );
  });

  it("hands the standing module an estimate it accepts", () => {
    const estimate = estimateForPub({ londonBoroughCode: "camden" }, baselines);
    expect(priceStandingFor({ estimate }).standing).toBe("estimate");
  });
});

describe("the shipped basis", () => {
  it("survives its own validator", () => {
    expect(isEstimateBaselines(estimateBaselines())).toBe(true);
  });

  it("holds no basis under the sample floor, so no shipped estimate is a guess", () => {
    const shipped = estimateBaselines();
    expect(shipped).not.toBeNull();
    for (const row of [...(shipped?.chains ?? []), ...(shipped?.regions ?? [])]) {
      expect(row.sampleSize).toBeGreaterThanOrEqual(MIN_ESTIMATE_SAMPLE);
    }
  });

  it("makes every chain basis answerable by naming the pages it read", () => {
    for (const chain of estimateBaselines()?.chains ?? []) {
      expect(chain.sourceUrls.length).toBeGreaterThan(0);
      for (const url of chain.sourceUrls) expect(url.startsWith("https://")).toBe(true);
    }
  });

  it("makes every region basis name its provenance", () => {
    for (const region of estimateBaselines()?.regions ?? []) {
      expect(region.provenance.trim().length).toBeGreaterThan(0);
    }
  });
});
