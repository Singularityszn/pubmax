import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

// The invite timeline and the plan card number a plan's stops the same way:
// the first stop in route order is 1, whatever its stored position says.
// Before, the invite printed `position + 1`, so a plan stored from position 1
// read 2, 3, 4 on the invite and 1, 2, 3 on the plan card.

vi.mock("@/components/plan/PlanRouteMiniMap", () => ({ default: () => null }));

import PlanRoute from "@/components/plan/PlanRoute";
import { numberPlanStops } from "@/lib/planStopNumbers";

// A three-stop plan whose stored positions do not start at 0, given out of order.
const STOPS = [
  { venueId: "v-c", venueName: "The Lamb", position: 3 },
  { venueId: "v-a", venueName: "The Dove", position: 1 },
  { venueId: "v-b", venueName: "The Ship", position: 2 },
];

function planCardNumbers(): Array<[string, number]> {
  const sorted = [...STOPS].sort((a, b) => a.position - b.position);
  const html = renderToStaticMarkup(
    createElement(PlanRoute, { planId: "plan-1", startTime: "2026-10-30T19:00:00.000Z", stops: sorted }),
  );
  const markers = [...html.matchAll(/planSummary__marker">(\d+)<\/span>.*?<strong>([^<]+)<\/strong>/g)];
  return markers.map((match) => [match[2]!, Number(match[1])]);
}

describe("stop numbers on the invite and the plan card", () => {
  it("agree for a three-stop plan", () => {
    const invite = numberPlanStops(STOPS).map((stop) => [stop.venueName, stop.number]);
    expect(invite).toEqual([
      ["The Dove", 1],
      ["The Ship", 2],
      ["The Lamb", 3],
    ]);
    expect(planCardNumbers()).toEqual(invite);
  });

  it("the invite page prints the shared number, never position + 1", () => {
    const source = readFileSync("app/invite/[token]/page.tsx", "utf8");
    expect(source).toContain("numberPlanStops(stops)");
    expect(source).not.toMatch(/position \+ 1/);
  });
});
