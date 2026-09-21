/**
 * Record TypeSafe Choice probabilities for Ask venue-resolution fixtures.
 * Requires TYPESAFE_API_KEY. Writes __tests__/fixtures/typesafe/venue-resolution-probabilities.json
 *
 *   node --import tsx scripts/record_venue_resolution_probs.ts
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  VENUE_RESOLUTION_CASES,
  VENUE_RESOLUTION_POOL,
} from "../__tests__/fixtures/typesafe/venueResolutionCases.ts";
import { systemOne, typesafeConfigured } from "../lib/ai/typesafe.ts";
import {
  collectVenueNameCandidates,
  intendedVenueQuestions,
  INTENDED_VENUE_FLOOR,
  toVenueResolutionCandidate,
  uniqueExactVenueNameMatch,
  venueResolutionState,
} from "../lib/ask/venueResolution.ts";

const ROOT = process.cwd();
const OUT = join(ROOT, "__tests__/fixtures/typesafe/venue-resolution-probabilities.json");

async function main(): Promise<void> {
  if (!typesafeConfigured()) {
    console.error("A judged venue-resolution fixture run requires TYPESAFE_API_KEY.");
    process.exit(1);
  }

  const recorded: Array<{
    id: string;
    query: string;
    expectedId: string | null;
    kind: string;
    skipped: boolean;
    choice: string;
    probabilities: Record<string, number>;
    model: string | null;
  }> = [];
  let model: string | null = null;

  for (const caseRow of VENUE_RESOLUTION_CASES) {
    if (uniqueExactVenueNameMatch(VENUE_RESOLUTION_POOL, caseRow.query)) {
      recorded.push({
        id: caseRow.id,
        query: caseRow.query,
        expectedId: caseRow.expectedId,
        kind: caseRow.kind,
        skipped: true,
        choice: "skipped-unique-exact",
        probabilities: {},
        model: null,
      });
      process.stderr.write(`skipped ${caseRow.id} (unique exact)\n`);
      continue;
    }

    const candidates = collectVenueNameCandidates(VENUE_RESOLUTION_POOL, caseRow.query).map(
      toVenueResolutionCandidate,
    );
    const response = await systemOne(
      venueResolutionState(caseRow.query, candidates),
      intendedVenueQuestions(candidates),
      { lane: "venue-resolution", timeoutMs: 10_000 },
    );
    if (!response) {
      console.error(`judgment failed for ${caseRow.id}`);
      process.exit(1);
    }
    model = response.model;
    const answer = response.answers.intendedVenue;
    recorded.push({
      id: caseRow.id,
      query: caseRow.query,
      expectedId: caseRow.expectedId,
      kind: caseRow.kind,
      skipped: false,
      choice: answer.choice,
      probabilities: { ...answer.probabilities },
      model: response.model,
    });
    process.stderr.write(`recorded ${caseRow.id} -> ${answer.choice}\n`);
  }

  const body = {
    recordedAt: new Date().toISOString(),
    caseCount: recorded.length,
    publishThreshold: INTENDED_VENUE_FLOOR,
    model: model ?? "unknown",
    cases: recorded,
  };
  writeFileSync(OUT, `${JSON.stringify(body, null, 2)}\n`);
  process.stderr.write(`wrote ${OUT}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
