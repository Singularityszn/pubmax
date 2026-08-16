// Price trust events: one durable unlock for the first qualifying cluster.
//
// Trust itself lives in lib/communityPrice.ts. This module only names the
// first independent observation set that crosses that gate, hashes it, and
// says who may be credited. It adds no second threshold, age window, or
// agreement rule.

import { createHash } from "node:crypto";

import {
  agreesWithinTolerance,
  COMMUNITY_PRICE_CORROBORATION_THRESHOLD,
  isCorroborated,
  isWithinMaxAge,
} from "@/lib/communityPrice";
import type { DrinkCategory } from "@/lib/drinks";

export type TrustObservation = {
  id: string;
  venueId: string;
  drinkCategory: DrinkCategory;
  priceGbp: number;
  submittedAt: number;
  actor: string | null;
  hidden?: boolean;
};

export type QualifyingCluster = {
  observationIds: string[];
  actors: string[];
};

function submitterBucket(actor: string | null): string {
  return actor === null ? "anon:*" : `a:${actor}`;
}

function visibleRows(rows: readonly TrustObservation[]): TrustObservation[] {
  return rows.filter((row) => !row.hidden && row.id);
}

function countCorroborations(
  rows: readonly TrustObservation[],
  reference: TrustObservation,
): number {
  const submitters = new Set<string>();
  for (const row of rows) {
    if (row.drinkCategory !== reference.drinkCategory) continue;
    if (!agreesWithinTolerance(reference.priceGbp, row.priceGbp)) continue;
    submitters.add(submitterBucket(row.actor));
  }
  return submitters.size;
}

function bestCorroboratedCandidate(
  rows: readonly TrustObservation[],
  now: number,
): TrustObservation | null {
  let best: TrustObservation | null = null;
  let bestCount = 0;
  for (const row of rows) {
    if (!isWithinMaxAge(row, now)) continue;
    const count = countCorroborations(rows, row);
    if (
      !best ||
      count > bestCount ||
      (count === bestCount && row.submittedAt >= best.submittedAt)
    ) {
      best = row;
      bestCount = count;
    }
  }
  return best;
}

/**
 * The earliest independent observations that first satisfy the community-price
 * trust gate. A later agreeing report is not in this set.
 */
export function firstQualifyingCluster(
  observations: readonly TrustObservation[],
  now: number = Date.now(),
): QualifyingCluster | null {
  const rows = visibleRows(observations);
  const candidate = bestCorroboratedCandidate(rows, now);
  if (!candidate) return null;
  const corroborations = countCorroborations(rows, candidate);
  if (!isCorroborated({ corroborations }) || !isWithinMaxAge(candidate, now)) {
    return null;
  }

  const agreeing = [...rows]
    .filter(
      (row) =>
        row.drinkCategory === candidate.drinkCategory &&
        agreesWithinTolerance(candidate.priceGbp, row.priceGbp),
    )
    .sort(
      (left, right) =>
        left.submittedAt - right.submittedAt || left.id.localeCompare(right.id),
    );

  const seen = new Set<string>();
  const cluster: TrustObservation[] = [];
  for (const row of agreeing) {
    const bucket = submitterBucket(row.actor);
    if (seen.has(bucket)) continue;
    seen.add(bucket);
    cluster.push(row);
    if (cluster.length >= COMMUNITY_PRICE_CORROBORATION_THRESHOLD) break;
  }
  if (cluster.length < COMMUNITY_PRICE_CORROBORATION_THRESHOLD) return null;

  const observationIds = cluster.map((row) => row.id).sort();
  const actors = cluster
    .map((row) => row.actor)
    .filter((actor): actor is string => typeof actor === "string" && actor !== "");
  return { observationIds, actors };
}

export function categoryIsTrusted(
  observations: readonly TrustObservation[],
  now: number = Date.now(),
): boolean {
  return firstQualifyingCluster(observations, now) !== null;
}

export function trustEventFingerprint(
  venueId: string,
  category: DrinkCategory,
  observationIds: readonly string[],
): string {
  const ids = [...observationIds].sort();
  return createHash("sha256")
    .update(`${venueId}\u0000${category}\u0000${ids.join("\u0000")}`)
    .digest("hex");
}

export function reversalFingerprint(originalFingerprint: string): string {
  return createHash("sha256")
    .update(`reversal\u0000${originalFingerprint}`)
    .digest("hex");
}

/** Credit binds to the account behind a profile actor, never handle text. */
export function profileIdFromActor(actor: string): string | null {
  if (!actor.startsWith("profile:")) return null;
  const id = actor.slice("profile:".length).trim();
  return id || null;
}
