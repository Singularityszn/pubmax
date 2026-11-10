// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { deriveNightModeSheetRouteModel } from "@/components/night/nightModeSheetModel";
import NightCrawlMode from "@/components/plan/NightCrawlMode";
import { markActivePlan } from "@/lib/activePlan";
import { guestsArrived, type CrewMemberDTO, type CrewPresenceStatus } from "@/lib/crew";
import type { PlanState } from "@/lib/plan";
import { clearPlanCapability, PLAN_HTTP_ONLY_SESSION, writePlanCapability } from "@/lib/planSessionCapability";

const EXPECTED: Record<CrewPresenceStatus, { guestArrived: boolean; sheetArrived: boolean; chip: [label: string, tone: string] | null }> = {
  in: { guestArrived: false, sheetArrived: false, chip: null },
  on_the_way: { guestArrived: false, sheetArrived: true, chip: ["on the way", "ahead"] },
  here: { guestArrived: true, sheetArrived: true, chip: ["here", "here"] },
  running_late: { guestArrived: false, sheetArrived: false, chip: ["lagging", "late"] },
  start_without_me: { guestArrived: false, sheetArrived: false, chip: ["catching up", "late"] },
};
const STATUSES = Object.keys(EXPECTED) as CrewPresenceStatus[];

const planId = "11111111-1111-4111-8111-111111111111";
const now = new Date().toISOString();
const member = (id: string, status: CrewPresenceStatus): CrewMemberDTO => ({ id, name: id, status, joinedAt: now, updatedAt: now });
const planWith = (crew: CrewMemberDTO[]): PlanState => ({
  plan: { id: planId, title: "Tonight", startTime: now, createdAt: now },
  stops: [{ venueId: "first", venueName: "First Arms", position: 0 }, { venueId: "second", venueName: "Second Arms", position: 1 }],
  crew, actions: [],
});

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  localStorage.clear();
  sessionStorage.clear();
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  clearPlanCapability(planId);
  vi.unstubAllGlobals();
});

describe("each crew presence status means the same thing everywhere", () => {
  it.each(STATUSES)("%s", async (status) => {
    const expected = EXPECTED[status];
    expect(guestsArrived([member("host", "here"), member("guest", status)])).toBe(expected.guestArrived ? 1 : 0);

    const sheet = deriveNightModeSheetRouteModel({ plan: planWith([member("mate", status)]), report: null, stopIndex: 0, coords: null, lastTrain: null });
    expect(sheet.arrived.map((entry) => entry.id)).toEqual(expected.sheetArrived ? ["mate"] : []);

    const plan = planWith([member("mate", status)]);
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(plan)));
    markActivePlan(planId, plan.plan.startTime);
    writePlanCapability(planId, { token: PLAN_HTTP_ONLY_SESSION, role: "host", collaborationAuthorized: true });
    await act(async () => root.render(createElement(NightCrawlMode, { planId, initialState: plan })));
    const chip = host.querySelector<HTMLElement>(".nightCrawl__who");
    expect(chip ? [chip.querySelector(".nightCrawl__whoState")?.textContent, chip.dataset.tone] : null).toEqual(expected.chip);
  });

  it("a status this build does not know reads as a plain in", async () => {
    const unknown = { ...member("mate", "in"), status: "gone_home" as CrewPresenceStatus };
    expect(guestsArrived([member("host", "here"), unknown])).toBe(0);
    expect(deriveNightModeSheetRouteModel({ plan: planWith([unknown]), report: null, stopIndex: 0, coords: null, lastTrain: null }).arrived).toEqual([]);
    const plan = planWith([unknown]);
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(plan)));
    markActivePlan(planId, plan.plan.startTime);
    writePlanCapability(planId, { token: PLAN_HTTP_ONLY_SESSION, role: "host", collaborationAuthorized: true });
    await act(async () => root.render(createElement(NightCrawlMode, { planId, initialState: plan })));
    expect(host.querySelector(".nightCrawl__who")).toBeNull();
  });
});
