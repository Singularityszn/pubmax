import "server-only";

import { getLateFoodForArea, normalizeLateFoodArea, shortlistFoodHandoffs } from "@/lib/lateFood";
import { nightAreaForMapQuery } from "@/lib/nightAreas";
import { parseLateFoodQuestion } from "@/lib/ask/lateFoodQuestion";
import type { AskToolContext, AskToolResult } from "@/lib/ask/toolContract";

function emptyFoodAnswer(answerHint: string, missingEvidence: string[]): AskToolResult {
  return {
    ok: false, tool: "search_venues", data: { terminals: [], missingEvidence },
    cards: [], proposals: [], provenance: [], priceEvidence: [], answerHint,
  };
}

/** Read the existing operator evidence. No restaurant terminal becomes a pub. */
export function answerLateFoodQuestion(ctx: AskToolContext): AskToolResult | null {
  const now = ctx.now ?? Date.now();
  const question = parseLateFoodQuestion(ctx.query, now);
  if (!question) return null;
  if (ctx.cityId !== "london") return emptyFoodAnswer("I have no current late-food record for this city.", ["late_food_area"]);
  if (question.areas.length === 0) return emptyFoodAnswer("Which area do you mean for late food?", ["late_food_area"]);
  const resolvedAreas = question.areas.map((name) => normalizeLateFoodArea(name)
    ?? normalizeLateFoodArea(nightAreaForMapQuery(ctx.cityId, name)?.slug));
  const areaChoices = resolvedAreas.map((area, index) => area ?? question.areas[index]!.toLocaleLowerCase());
  if (new Set(areaChoices).size > 1) return emptyFoodAnswer("Which area do you want food in? Choose one area.", ["late_food_area"]);
  const area = resolvedAreas[0];
  if (!area) return emptyFoodAnswer(`I have no current late-food record for ${question.areas[0]}.`, ["late_food_area"]);
  if (!question.at) return emptyFoodAnswer("Which night and time do you want food?", ["requested_time"]);
  if (question.requiresPub) return emptyFoodAnswer("I have no recorded pub kitchen hours for that time.", ["pub_kitchen_hours"]);
  const terminals = shortlistFoodHandoffs(getLateFoodForArea(area, [], { now, at: question.at })
    .filter((terminal) => !question.cuisine || terminal.category === question.cuisine)
    .filter((terminal) => question.dietary.every((tag) => terminal.dietary.some((choice) => choice === tag))));
  if (terminals.length === 0) {
    return emptyFoodAnswer(
      question.dietary.length > 0
        ? "I have no current late-food record that confirms those dietary choices at that time."
        : "I have no current record of food service for that area at that time.",
      ["eligible_late_food_options", ...(question.dietary.length > 0 ? ["dietary_options"] : [])],
    );
  }
  const provenance = terminals.map((terminal) => ({
    kind: "directory" as const,
    label: `${terminal.provenance.source}: service hours recorded ${terminal.provenance.observedAt.slice(0, 10)}.`,
    url: terminal.provenance.sourceUrl,
  }));
  return {
    ok: true,
    tool: "search_venues",
    data: { area, requestedAt: question.at, terminals, missingEvidence: ["live_opening_confirmation"] },
    cards: terminals.map((terminal, index) => ({
      key: terminal.id, venueId: "", title: terminal.name, place: terminal.address, price: null,
      note: `Recorded service hours: ${terminal.hours.service} Check the hours for your requested date before you leave.`,
      provenance: provenance[index],
    })),
    proposals: [],
    priceEvidence: [],
    provenance,
    answerHint: `${terminals.map((terminal) => terminal.name).join(", ")}: recorded service hours cover that time. Check the hours for your requested date before you leave.`,
  };
}
