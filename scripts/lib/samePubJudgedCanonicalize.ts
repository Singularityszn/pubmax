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

function collectSamePubCandidatePairs(
  groupList: VenueGroup[],
  maxMetres: number = SAME_PUB_CANDIDATE_MAX_METRES,
): Array<[VenueGroup, VenueGroup]> {
  const pairs: Array<[VenueGroup, VenueGroup]> = [];
  const seen = new Set<string>();
  for (const [i, a] of groupList.entries()) {
    if (!Number.isFinite(a.lat) || !Number.isFinite(a.lng)) continue;
    for (const b of groupList.slice(i + 1)) {
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
      // The key was checked before the sweep began, so a null here is a failed
      // call: a timeout, a 5xx or a refused request. Abort rather than carry
      // on, because a partial verdict map silently refuses every pair the run
      // never reached, and a half-judged alias map is worse than none.
      throw new Error(
        `A judged same-pub pass could not reach TypeSafe for ${a.id} / ${b.id}. No aliases were written.`,
      );
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

/**
 * The review queue is committed, so it carries no clock: the same dataset and
 * the same verdicts must produce the same bytes, or every judged run dirties
 * the tree with a timestamp and hides the pairs that actually changed. Git
 * already records when the file was written.
 */
const SAME_PUB_REVIEW_NOTE =
  "Pairs in the uncertain band between the refuse and merge thresholds. Never auto-merged.";

export function samePubReviewDocument(
  review: SamePubReviewEntry[],
  note: string = SAME_PUB_REVIEW_NOTE,
): {
  version: number;
  note: string;
  pairCount: number;
  pairs: SamePubReviewEntry[];
} {
  const pairs = [...review].sort((x, y) =>
    `${x.a.id}|${x.b.id}`.localeCompare(`${y.a.id}|${y.b.id}`),
  );
  return {
    version: 1,
    note,
    pairCount: pairs.length,
    pairs,
  };
}

export async function writeSamePubReviewFile(
  review: SamePubReviewEntry[],
  rootDir: string,
  relativePath: string = path.join("data", "review", "same-pub-review.json"),
  note: string = SAME_PUB_REVIEW_NOTE,
): Promise<string> {
  const outPath = path.join(rootDir, relativePath);
  const doc = samePubReviewDocument(review, note);
  const { mkdir, writeFile } = await import("node:fs/promises");
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(doc, null, 2)}\n`, "utf8");
  return outPath;
}
