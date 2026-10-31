// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import PlanClueHunt from "@/components/plan/PlanClueHunt";
import PlanClueHuntLoader, { type PlanClueHuntLoaderProps } from "@/components/plan/PlanClueHuntLoader";
import { selectPlanClues } from "@/lib/planClues";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const stops = [
  { venueId: "first-pub", venueName: "First", position: 0 },
  { venueId: "second-pub", venueName: "Second", position: 1 },
];
const path: [number, number][] = [[-0.125, 51.5007], [-0.1246, 51.5007], [-0.124, 51.5007]];
const clues = selectPlanClues(stops.map((stop) => stop.venueId), [{ fromIndex: 0, toIndex: 1, source: "ors", coordinates: path }]);
const scope: PlanClueHuntLoaderProps = { planId: "plan-a", memberId: "member-a", accountId: "account-a", revision: 1, stops };

let root: Root;
let container: HTMLDivElement;
let request: ReturnType<typeof vi.fn<typeof fetch>>;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  request = vi.fn<typeof fetch>(async (input) => String(input).startsWith("/api/venue/")
    ? Response.json({ venue: { longitude: -0.1246, latitude: 51.5007 } })
    : Response.json({ source: "ors", line: { type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "LineString", coordinates: path } }] } }));
  vi.stubGlobal("fetch", request);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function click(label: string) {
  const button = Array.from(container.querySelectorAll("button")).find((node) => node.textContent === label);
  expect(button, label).toBeTruthy();
  await act(async () => button!.click());
}

describe("manual clue reveal", () => {
  it("reveals a sourced answer, allows every clue to be skipped and leaves the route untouched", async () => {
    const disabled = vi.fn();
    const before = structuredClone(stops);
    await act(async () => root.render(<PlanClueHunt planId="plan-a" clues={clues} onDisable={disabled} />));
    const reveal = container.querySelector('[aria-controls]')!;
    const answer = document.getElementById(reveal.getAttribute("aria-controls")!)!;
    expect(answer.hidden).toBe(true);
    await click("Reveal answer 1");
    expect(answer.hidden).toBe(false);
    expect(answer.textContent).toContain("Big Ben");
    expect(answer.querySelector("a")?.href).toContain("parliament.uk/");
    await click("Skip clue 1");
    expect(container.querySelector('[role="status"]')?.textContent).toBe("All clues skipped. Carry on with your route.");
    expect(stops).toEqual(before);
    expect(request).not.toHaveBeenCalled();
    expect(container.querySelector('a[href^="/moment?"]')).not.toBeNull();
    await click("Turn clues off");
    expect(disabled).toHaveBeenCalledOnce();
  });

  it("makes no location or route read before the explicit enable action", async () => {
    await act(async () => root.render(<PlanClueHuntLoader {...scope} />));
    expect(request).not.toHaveBeenCalled();
    await click("Turn clues on");
    expect(request).toHaveBeenCalledTimes(3);
    expect(container.textContent).toContain("Between stops 1 and 2");
  });

  it.each([
    { accountId: "account-b" }, { accountId: null }, { memberId: "member-b" },
    { planId: "plan-b" }, { revision: 2 }, { stops: [...stops].reverse() },
  ])("clears progress and loaded route when scope changes: %j", async (change) => {
    await act(async () => root.render(<PlanClueHuntLoader {...scope} />));
    await click("Turn clues on");
    await click("Reveal answer 1");
    const oldSignal = request.mock.calls[0]?.[1]?.signal;
    await act(async () => root.render(<PlanClueHuntLoader {...scope} {...change} />));
    expect(container.textContent).not.toContain("Answer revealed");
    expect(container.textContent).toContain("Turn clues on");
    expect(oldSignal?.aborted).toBe(true);
    expect(request).toHaveBeenCalledTimes(3);
  });

  it("keeps the normal plan available when routing can only return a straight fallback", async () => {
    request.mockImplementation(async () => Response.json({ source: "straight", venue: { longitude: -0.1246, latitude: 51.5007 } }));
    await act(async () => root.render(<><p>The original pub route</p><PlanClueHuntLoader {...scope} /></>));
    await click("Turn clues on");
    expect(container.textContent).toContain("No sourced clues are available for this walk.");
    expect(container.textContent).toContain("The original pub route");
  });
});
