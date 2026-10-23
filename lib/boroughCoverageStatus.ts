import type { Route } from "next";

// Seed-borough coverage status for the price flywheel (PLG Wave 2).
// Status copy only: never a leaderboard, never a stranger feed, never a claim
// that a failed read means the borough is empty.

/** Soft-launch patches we densify before marketing elsewhere. */
export const SEED_BOROUGH_CAMPAIGN = [
  { slug: "westminster", name: "Soho / Westminster", mapQuery: "Soho" },
  { slug: "camden", name: "Camden", mapQuery: "Camden" },
  { slug: "lambeth", name: "Clapham / Lambeth", mapQuery: "Clapham" },
  { slug: "hackney", name: "Shoreditch / Hackney", mapQuery: "Shoreditch" },
  { slug: "islington", name: "Islington", mapQuery: "Islington" },
] as const;

/** Corroborated beer pints this month before the line reads as met. */
export const SEED_BOROUGH_MONTHLY_TARGET = 20;

type BoroughCoverageReadStatus = "ready" | "partial" | "degraded" | "unknown";

export type BoroughCoverageInput = {
  slug: string;
  name: string;
  mapQuery: string;
  /** Distinct corroborated beer (venue, category) pairs attributed to the borough. */
  corroboratedPintCount: number;
  target?: number;
  status: BoroughCoverageReadStatus;
};

/**
 * One honest status sentence. A failed or unknown read names the uncertainty;
 * it never reports a zero as proof the borough has no prices.
 */
export function boroughCoverageStatusCopy(input: BoroughCoverageInput): string {
  const target = input.target ?? SEED_BOROUGH_MONTHLY_TARGET;
  if (input.status === "degraded" || input.status === "unknown") {
    return `${input.name}: we could not count corroborated pints just now.`;
  }
  const count = Math.max(0, Math.floor(input.corroboratedPintCount));
  const remaining = Math.max(0, target - count);
  const partialNote = input.status === "partial" ? " At least, that is: the count may run higher." : "";
  if (remaining === 0) {
    return `${input.name} has met its ${target} corroborated pints for this month.${partialNote}`;
  }
  const pintWord = remaining === 1 ? "pint" : "pints";
  return `${input.name} needs ${remaining} more corroborated ${pintWord} this month.${partialNote}`;
}

export type BoroughCoverageSummary =
  /** Every borough is saying the same thing, so it is said once. */
  | { kind: "shared"; line: string }
  /** The boroughs differ, so each says its own. */
  | { kind: "per-borough" };

/**
 * One line, or one line each.
 *
 * The counts here are real and per-borough. On 30 August 2026 they were also
 * all zero, so the page printed "needs 20 more corroborated pints this month"
 * five times over, once per borough. Five identical sentences do not carry five
 * facts: they carry one, and they read as filler, which is what the audit
 * called it.
 *
 * So nothing is reworded and nothing is invented. When the boroughs genuinely
 * differ they each keep their own sentence; when they are all saying the same
 * thing it is said once, and each borough keeps its own way onto the map. The
 * moment one borough moves ahead of the others this goes back to a line each,
 * because then the repetition would be carrying real news.
 */
export function boroughCoverageSummary(
  rows: readonly BoroughCoverageInput[],
): BoroughCoverageSummary {
  const [first] = rows;
  if (!first || rows.length < 2) return { kind: "per-borough" };

  const lines = new Set<string>();
  for (const row of rows) {
    // Compare what each row would SAY with its own name taken out, so two
    // boroughs at the same count collapse and two at different counts do not.
    lines.add(boroughCoverageStatusCopy({ ...row, name: "" }));
    if (lines.size > 1) return { kind: "per-borough" };
  }

  const target = first.target ?? SEED_BOROUGH_MONTHLY_TARGET;
  if (first.status === "degraded" || first.status === "unknown") {
    return { kind: "shared", line: "We could not count corroborated pints just now." };
  }
  const partialNote =
    first.status === "partial" ? " At least, that is: the counts may run higher." : "";
  const remaining = Math.max(
    0,
    target - Math.max(0, Math.floor(first.corroboratedPintCount)),
  );
  if (remaining === 0) {
    return {
      kind: "shared",
      line: `Every borough here has met its ${target} corroborated pints for this month.${partialNote}`,
    };
  }
  const pintWord = remaining === 1 ? "pint" : "pints";
  return {
    kind: "shared",
    line: `Every borough here needs ${remaining} more corroborated ${pintWord} this month.${partialNote}`,
  };
}

/** Map href that opens the patch browse without inventing a selected pub. */
export function boroughCoverageMapHref(mapQuery: string): Route {
  return `/map?q=${encodeURIComponent(mapQuery)}`;
}
