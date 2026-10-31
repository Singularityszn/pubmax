// @vitest-environment jsdom

// The round on the plan card (review item B6): off until a member picks, then
// each stop prints its round, "not listed" where it has no figure, and the
// planner's report line sits under the stops when the device kept one.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import PlanRoundForecast from "@/components/plan/PlanRoundForecast";
import type { CrewMemberDTO } from "@/lib/crew";
import { rememberPlanReportLine } from "@/lib/planReportLine";

const PLAN_ID = "00000000-0000-4000-8000-0000000000aa";
const STOPS = [
  { venueId: "venue-a", venueName: "The Lamb", position: 1 },
  { venueId: "venue-b", venueName: "The Mitre", position: 2 },
];

function member(over: Partial<CrewMemberDTO>): CrewMemberDTO {
  return {
    id: "m1",
    name: "Sam",
    status: "in",
    joinedAt: "2026-10-30T17:00:00.000Z",
    updatedAt: "2026-10-30T17:00:00.000Z",
    ...over,
  };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  // No venue detail answers here, so every figure is "not listed".
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 503 })));
  window.localStorage.clear();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function render(crew: CrewMemberDTO[]) {
  await act(async () => {
    root.render(createElement(PlanRoundForecast, { planId: PLAN_ID, stops: STOPS, crew, onPlan: () => undefined }));
  });
}

describe("the round on the plan card", () => {
  it("asks for a usual and prints no round until somebody picks", async () => {
    await render([member({})]);
    expect(container.textContent).toContain("What’s our round here?");
    expect(container.querySelectorAll('[role="radio"]')).toHaveLength(4);
    expect(container.querySelector(".planRound__stops")).toBe(null);
  });

  it("prints each stop's round once a member has picked, and says not listed without a figure", async () => {
    await render([member({ usualDrink: "wine" }), member({ id: "m2", name: "Jo" })]);
    const stops = container.querySelectorAll(".planRound__stop");
    expect(stops).toHaveLength(2);
    expect(stops[0]?.textContent).toContain("The Lamb");
    expect(stops[0]?.textContent).toContain("Sam: Wine (175 ml), not listed");
    expect(stops[0]?.textContent).not.toContain("Jo:");
    expect(stops[0]?.textContent).toContain("None of the 1 drink is listed here");
    expect(container.textContent).toContain("Not a bill.");
  });

  it("prints the planner's report line under the stops, and nothing when none was kept", async () => {
    await render([member({})]);
    expect(container.querySelector('[data-testid="plan-report-line"]')).toBe(null);
    await act(async () => root.unmount());
    root = createRoot(container);
    rememberPlanReportLine(PLAN_ID, "Short walks: every leg is under 1.2 km.");
    await render([member({})]);
    expect(container.querySelector('[data-testid="plan-report-line"]')?.textContent)
      .toBe("Short walks: every leg is under 1.2 km.");
  });
});
