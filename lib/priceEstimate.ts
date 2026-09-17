// The estimate engine: how a pub with no published price still gets a figure,
// and what that figure is allowed to say about itself.
//
// THE RULE IS THAT AN ESTIMATE NAMES ITS OWN EVIDENCE. Every estimate carries
// the `basis` it was modelled from, the `sampleSize` behind that basis and the
// `computedAt` it was derived on. An estimate with no sample is not a cautious
// estimate, it is a guess, so `MIN_ESTIMATE_SAMPLE` refuses it and the pub
// stays grey. Grey is a real answer here: "nobody has published this and we
// cannot model it either" is worth saying, and it is what points a drinker at
// the pubs whose price is still missing.
//
// TWO BASES, TRIED IN THAT ORDER. A pub that belongs to a chain whose menu we
// are permitted to read is modelled from that chain's own published prices. A
// pub that does not is modelled from its region's baseline. The chain basis is
// first because it is the narrower claim: it is about pubs run by the same
// operator off the same menu, rather than about pubs that happen to share a
// postcode area.
//
// NOTHING HERE IS AN OBSERVATION. An estimate may never enter the Pint Index,
// the pin price label, the cheapest-pint buckets or any current-price merge:
// `standingCarriesAuthority` in lib/priceTier.ts is the gate, and it answers
// false for every estimate. This is the same fence lib/priceHistory.ts wears,
// for the same reason.

import type { EstimatedPriceInput } from "@/lib/priceTier";

/** The two things an estimate may be modelled from. A third needs its own method. */
export const ESTIMATE_BASES = ["chain_menu", "regional_baseline"] as const;
type EstimateBasis = (typeof ESTIMATE_BASES)[number];

function isEstimateBasis(value: unknown): value is EstimateBasis {
  return typeof value === "string" && (ESTIMATE_BASES as readonly string[]).includes(value);
}

/**
 * Below this many published prices a basis is not a model. Three is the floor
 * because two prices that happen to agree still describe two pubs, and the
 * whole claim an estimate makes is that it generalises.
 */
export const MIN_ESTIMATE_SAMPLE = 3;

/** A pint's plausible band. Outside it, the row is not a pint and is dropped. */
const ESTIMATE_MIN_GBP = 2;
const ESTIMATE_MAX_GBP = 12;

/** How a region row was keyed, because the two are not interchangeable. */
const REGION_KINDS = ["london_borough", "postcode_area"] as const;
type RegionKind = (typeof REGION_KINDS)[number];

type ChainBaseline = {
  /** Stable id, e.g. `greene-king`. */
  id: string;
  label: string;
  medianGbp: number;
  sampleSize: number;
  /** OSM `operator` values, lower-cased, that name this chain. */
  operators: readonly string[];
  /** Website hosts, without `www.`, that belong to this chain. */
  hosts: readonly string[];
  /** The permitted pages the sample was read from. */
  sourceUrls: readonly string[];
};

type RegionBaseline = {
  kind: RegionKind;
  /** Borough code, or postcode-area letters. */
  code: string;
  label: string;
  medianGbp: number;
  sampleSize: number;
  /** Where the sample came from, named so a reader can weigh it. */
  provenance: string;
};

export type EstimateBaselines = {
  version: 1;
  computedAt: string;
  /** One sentence naming how these numbers were derived. */
  method: string;
  chains: readonly ChainBaseline[];
  regions: readonly RegionBaseline[];
};

/** What the engine needs to know about a pub. Every field is OSM-stated or derived from its point. */
export type EstimatablePub = {
  /** OSM `operator`, if the pub states one. */
  operator?: string | null;
  /** The pub's own website, if it states one. */
  website?: string | null;
  /** UK postcode, if the pub states one. */
  postcode?: string | null;
  /** London borough code, from the point-in-polygon classifier. Never guessed from a name. */
  londonBoroughCode?: string | null;
};

export type PriceEstimate = EstimatedPriceInput & {
  basis: EstimateBasis;
  /** The chain id or region code the basis was keyed on. */
  basisKey: string;
};

export function normaliseOperator(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’.]/g, "")
    .replace(/\b(plc|ltd|limited|inns|taverns|pub company|pubs)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function hostOf(website: string): string | null {
  try {
    const url = new URL(website.includes("//") ? website : `https://${website}`);
    return url.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/**
 * The postcode AREA: the letters before the first digit. `SW1A 1AA` is `SW`.
 * A malformed postcode answers null rather than a plausible-looking prefix,
 * because a wrong region is a wrong estimate with a confident label on it.
 */
export function postcodeArea(postcode: string): string | null {
  const match = /^([A-Z]{1,2})\d/.exec(postcode.trim().toUpperCase());
  return match ? match[1] : null;
}

function chainFor(pub: EstimatablePub, baselines: EstimateBaselines): ChainBaseline | null {
  const operator = pub.operator ? normaliseOperator(pub.operator) : null;
  const host = pub.website ? hostOf(pub.website) : null;
  for (const chain of baselines.chains) {
    if (operator && chain.operators.includes(operator)) return chain;
    if (host && chain.hosts.some((known) => host === known || host.endsWith(`.${known}`))) {
      return chain;
    }
  }
  return null;
}

function regionFor(pub: EstimatablePub, baselines: EstimateBaselines): RegionBaseline | null {
  if (pub.londonBoroughCode) {
    const borough = baselines.regions.find(
      (region) => region.kind === "london_borough" && region.code === pub.londonBoroughCode,
    );
    if (borough) return borough;
  }
  const area = pub.postcode ? postcodeArea(pub.postcode) : null;
  if (!area) return null;
  return (
    baselines.regions.find((region) => region.kind === "postcode_area" && region.code === area) ??
    null
  );
}

function usable(sampleSize: number, medianGbp: number): boolean {
  return (
    Number.isInteger(sampleSize) &&
    sampleSize >= MIN_ESTIMATE_SAMPLE &&
    Number.isFinite(medianGbp) &&
    medianGbp >= ESTIMATE_MIN_GBP &&
    medianGbp <= ESTIMATE_MAX_GBP
  );
}

/**
 * The one estimate a pub gets, or null. Chain first, then region, then nothing.
 * A basis whose sample is under the floor is skipped rather than used quietly,
 * so a thin chain does not quietly become a confident number.
 */
export function estimateForPub(
  pub: EstimatablePub,
  baselines: EstimateBaselines,
): PriceEstimate | null {
  const chain = chainFor(pub, baselines);
  if (chain && usable(chain.sampleSize, chain.medianGbp)) {
    return {
      priceGbp: chain.medianGbp,
      basis: "chain_menu",
      basisKey: chain.id,
      sampleSize: chain.sampleSize,
      computedAt: baselines.computedAt,
    };
  }
  const region = regionFor(pub, baselines);
  if (region && usable(region.sampleSize, region.medianGbp)) {
    return {
      priceGbp: region.medianGbp,
      basis: "regional_baseline",
      basisKey: region.code,
      sampleSize: region.sampleSize,
      computedAt: baselines.computedAt,
    };
  }
  return null;
}

/** What an estimate's basis is called in front of a reader. */
function estimateBasisLabel(basis: EstimateBasis): string {
  return basis === "chain_menu" ? "chain menu prices" : "prices nearby";
}

/**
 * The sentence under an estimate. It names the basis and the sample, because a
 * figure modelled from four pubs and one modelled from four hundred are not the
 * same claim and should not read the same.
 */
export function estimateBasisNote(estimate: PriceEstimate): string {
  const noun = estimate.sampleSize === 1 ? "price" : "prices";
  return `Modelled from ${estimate.sampleSize} published ${noun} (${estimateBasisLabel(estimate.basis)}).`;
}

export function isEstimateBaselines(value: unknown): value is EstimateBaselines {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  if (record.version !== 1) return false;
  if (typeof record.computedAt !== "string" || !Number.isFinite(Date.parse(record.computedAt))) return false;
  if (typeof record.method !== "string" || record.method.trim().length === 0) return false;
  if (!Array.isArray(record.chains) || !Array.isArray(record.regions)) return false;
  return true;
}
