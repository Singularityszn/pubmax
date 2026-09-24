import { runAskTool } from "@/lib/ask/tools";
import type { AskCard } from "@/lib/ask/types";

import { normativeSpecForCase } from "./normativeSpecs";
import type { PalEvalAnswerExpectations, PalEvalPublicCase } from "./types";

export async function resolveNormativeExpectations(
  caseDef: PalEvalPublicCase,
  input: {
    now: number;
    fetchImpl: typeof fetch;
    cityId?: string;
  },
): Promise<Partial<PalEvalAnswerExpectations>> {
  const spec = normativeSpecForCase(caseDef);
  if (!spec) {
    throw new Error(`Missing normative spec for case ${caseDef.id}`);
  }
  if ("empty" in spec) {
    return { expectEmpty: true };
  }

  const ctx = {
    cityId: (input.cityId ?? "london") as "london",
    query: caseDef.query,
    skipModel: true,
    now: input.now,
    fetchImpl: input.fetchImpl,
  };

  const cards: AskCard[] = [];
  let degraded = false;
  for (const call of spec.calls) {
    const result = await runAskTool(
      call.tool,
      { ...call.args, query: typeof call.args?.query === "string" ? call.args.query : caseDef.query },
      ctx,
    );
    cards.push(...result.cards);
    if (result.degraded) degraded = true;
  }


  if (spec.calls.every((call) => call.tool === "propose_map_action")) {
    return { expectEmpty: true };
  }
  if (spec.calls.every((call) => call.tool === "report_occupancy")) {
    return { expectEmpty: true };
  }

  const firstVenue = cards.find((card) => card.venueId);
  const out: Partial<PalEvalAnswerExpectations> = {};
  if (cards.length === 0) {
    out.expectEmpty = true;
  } else {
    out.minCards = 1;
    if (firstVenue) {
      out.topVenueId = firstVenue.venueId;
      if (firstVenue.price !== null) out.topPrice = firstVenue.price;
    }
  }
  if (degraded) out.expectDegraded = true;
  return out;
}

export function mergePalExpectations(
  hand: PalEvalAnswerExpectations,
  normative: Partial<PalEvalAnswerExpectations>,
): PalEvalAnswerExpectations {
  const merged: PalEvalAnswerExpectations = { ...hand };
  if (normative.topVenueId !== undefined) merged.topVenueId = normative.topVenueId;
  if (normative.topPrice !== undefined) merged.topPrice = normative.topPrice;
  if (normative.minCards !== undefined && hand.minCards === undefined) {
    merged.minCards = normative.minCards;
  }
  if (normative.expectEmpty !== undefined && hand.expectEmpty === undefined) {
    merged.expectEmpty = normative.expectEmpty;
  }
  if (normative.expectDegraded !== undefined && hand.expectDegraded === undefined) {
    merged.expectDegraded = normative.expectDegraded;
  }
  return merged;
}
