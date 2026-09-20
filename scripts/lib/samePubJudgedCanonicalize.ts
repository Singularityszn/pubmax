/**
 * Judged same-pub pass for venue canonicalisation (requires TYPESAFE_API_KEY).
 *
 * Finds candidate pairs under the cheap gates, asks TypeSafe once per pair, and
 * returns a `samePubMatch` predicate plus review-band rows for the captain.
 */

import path from "node:path";

import {
  cheapSamePubCandidate,
  judgeSamePubPair,
  requiresTypesafeKeyMessage,
  SAME_PUB_CANDIDATE_MAX_METRES,
  snippetFromVenueGroup,
  typesafeConfigured,
} from "@/lib/samePubIdentity";
import { haversineMeters } from "./venueCanonicalization.mjs";

type VenueGroup = {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  normName: string;
};

export type SamePubReviewEntry = {
  a: { id: string; name: string; address: string };
  b: { id: string; name: string; address: string };
  distanceMetres: number;
  probability: number;
};

function pairKey(a: VenueGroup, b: VenueGroup): string {
  return a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
}

function operatorFromName(name: string): string | null {
  const m = name.match(/\s*[-–—(]\s*(jd\s+)?wetherspoons?\b/i);
  if (m) return "Wetherspoon";
  return null;
}

export function collectSamePubCandidatePairs(
  groupList: VenueGroup[],
  maxMetres: number = SAME_PUB_CANDIDATE_MAX_METRES,
): Array<[VenueGroup, VenueGroup]> {
  const pairs: Array<[VenueGroup, VenueGroup]> = [];
  const seen = new Set<string>();
  for (let i = 0; i < groupList.length; i += 1) {
    const a = groupList[i];
    if (!Number.isFinite(a.lat) || !Number.isFinite(a.lng)) continue;
    for (let j = i + 1; j < groupList.length; j += 1) {
      const b = groupList[j];
      if (
        !cheapSamePubCandidate(
          { lat: a.lat, lng: a.lng, address: a.address, normName: a.normName },
          { lat: b.lat, lng: b.lng, address: b.address, normName: b.normName },
          maxMetres,
        )
      ) {
        continue;
      }
      const key = pairKey(a, b);
      if (seen.has(key)) continue;
      seen.add(key);
      pairs.push([a, b]);
    }
  }
  return pairs;
}

export async function buildJudgedSamePubMatch(groupList: VenueGroup[]): Promise<{
  samePubMatch: (a: VenueGroup, b: VenueGroup) => boolean;
  review: SamePubReviewEntry[];
}> {
  if (!typesafeConfigured()) {
    throw new Error(requiresTypesafeKeyMessage());
  }

  const mergeAllowed = new Map<string, boolean>();
  const review: SamePubReviewEntry[] = [];

  const pairs = collectSamePubCandidatePairs(groupList);
  for (const [a, b] of pairs) {
    const distanceMetres = haversineMeters(a.lat, a.lng, b.lat, b.lng);
    const state = {
      a: snippetFromVenueGroup({
        name: a.name,
        address: a.address,
        operator: operatorFromName(a.name),
        website: null,
      }),
      b: snippetFromVenueGroup({
        name: b.name,
        address: b.address,
        operator: operatorFromName(b.name),
        website: null,
      }),
      distanceMetres: Math.round(distanceMetres),
    };
    const judged = await judgeSamePubPair(state);
    if (!judged) {
      throw new Error(requiresTypesafeKeyMessage());
    }
    const key = pairKey(a, b);
    if (judged.band === "merge") mergeAllowed.set(key, true);
    else if (judged.band === "refuse") mergeAllowed.set(key, false);
    else {
      mergeAllowed.set(key, false);
      review.push({
        a: { id: a.id, name: a.name, address: a.address },
        b: { id: b.id, name: b.name, address: b.address },
        distanceMetres: Math.round(distanceMetres),
        probability: judged.probability,
      });
    }
  }

  const samePubMatch = (a: VenueGroup, b: VenueGroup): boolean => {
    const key = pairKey(a, b);
    if (!mergeAllowed.has(key)) return false;
    return mergeAllowed.get(key) === true;
  };

  return { samePubMatch, review };
}

export async function writeSamePubReviewFile(
  review: SamePubReviewEntry[],
  rootDir: string,
): Promise<string> {
  const outPath = path.join(rootDir, "data", "review", "same-pub-review.json");
  const doc = {
    version: 1,
    generatedAt: new Date().toISOString(),
    note:
      "Pairs in the uncertain band between refuse and merge thresholds. Never auto-merged.",
    pairCount: review.length,
    pairs: review,
  };
  const { mkdir, writeFile } = await import("node:fs/promises");
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(doc, null, 2)}\n`, "utf8");
  return outPath;
}
