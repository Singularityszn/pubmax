import type { AskResponseBody } from "@/lib/ask/types";

import type { PalEvalAnswerExpectations } from "./types";
import type { PalEvalVenueIndex } from "./venueIndex";

export type GradeOutcome = {
  pass: boolean;
  checks: Array<{ name: string; pass: boolean; detail: string }>;
  inventedVenues: number;
};

function push(
  checks: Array<{ name: string; pass: boolean; detail: string }>,
  name: string,
  pass: boolean,
  detail: string,
): void {
  checks.push({ name, pass, detail });
}

function gradeInventedVenues(
  body: AskResponseBody,
  index: PalEvalVenueIndex,
): { inventedVenues: number; details: string[] } {
  const details: string[] = [];
  let inventedVenues = 0;
  for (const card of body.cards) {
    if (!card.venueId) continue;
    if (!index.ids.has(card.venueId)) {
      inventedVenues += 1;
      details.push(`unknown venueId ${card.venueId} (${card.title})`);
    }
  }
  return { inventedVenues, details };
}

export function gradePalCase(
  body: AskResponseBody,
  expect: PalEvalAnswerExpectations,
  index: PalEvalVenueIndex,
  routeTools: string[] = [],
): GradeOutcome {
  const checks: Array<{ name: string; pass: boolean; detail: string }> = [];
  const { inventedVenues, details } = gradeInventedVenues(body, index);
  push(
    checks,
    "invented_venues",
    inventedVenues === 0,
    inventedVenues === 0 ? "none" : details.join("; "),
  );

  if (expect.expectedTools?.length) {
    const used = body.toolsUsed;
    const ok = expect.toolOrderMatters
      ? JSON.stringify(used) === JSON.stringify(expect.expectedTools)
      : expect.expectedTools.every((tool) => used.includes(tool));
    push(checks, "tool_routing", ok, `used=${used.join(",")} expected=${expect.expectedTools.join(",")}`);
  }

  if (expect.anyTools?.length) {
    const ok = expect.anyTools.some((tool) => body.toolsUsed.includes(tool));
    push(checks, "tool_any", ok, `used=${body.toolsUsed.join(",")}`);
  }

  if (expect.expectedRouteTools?.length) {
    const ok = JSON.stringify(routeTools) === JSON.stringify(expect.expectedRouteTools);
    push(
      checks,
      "route_trace",
      ok,
      `route=${routeTools.join(",")} expected=${expect.expectedRouteTools.join(",")}`,
    );
  }

  if (expect.expectEmpty) {
    push(checks, "empty_answer", body.cards.length === 0, `cards=${body.cards.length}`);
  }

  if (expect.minCards !== undefined) {
    push(checks, "min_cards", body.cards.length >= expect.minCards, `cards=${body.cards.length}`);
  }

  if (expect.maxCards !== undefined) {
    push(checks, "max_cards", body.cards.length <= expect.maxCards, `cards=${body.cards.length}`);
  }

  if (expect.expectDegraded) {
    push(checks, "degraded", body.status === "degraded", `status=${body.status}`);
  }

  for (const fragment of expect.answerIncludes ?? []) {
    push(
      checks,
      `answer_includes:${fragment}`,
      body.answer.toLowerCase().includes(fragment.toLowerCase()),
      body.answer.slice(0, 120),
    );
  }

  for (const fragment of expect.answerExcludes ?? []) {
    push(
      checks,
      `answer_excludes:${fragment}`,
      !body.answer.toLowerCase().includes(fragment.toLowerCase()),
      body.answer.slice(0, 120),
    );
  }

  const firstVenueCard = body.cards.find((c) => c.venueId);
  if (expect.topVenueId) {
    push(
      checks,
      "top_venue_id",
      firstVenueCard?.venueId === expect.topVenueId,
      `got=${firstVenueCard?.venueId ?? "none"}`,
    );
  }

  if (expect.topPrice !== undefined && firstVenueCard) {
    const tol = expect.priceTolerance ?? 0.02;
    const price = firstVenueCard.price;
    push(
      checks,
      "top_price",
      price !== null && Math.abs(price - expect.topPrice) <= tol,
      `got=${price} expected=${expect.topPrice}`,
    );
  }

  for (const card of body.cards) {
    if (!card.venueId || card.price === null) continue;
    const recorded = index.priceById.get(card.venueId);
    if (recorded === undefined) continue;
    const tol = expect.priceTolerance ?? 0.02;
    push(
      checks,
      `price_data:${card.venueId}`,
      Math.abs(recorded - card.price) <= tol,
      `card=${card.price} index=${recorded}`,
    );
  }

  return { pass: checks.every((c) => c.pass), checks, inventedVenues };
}
