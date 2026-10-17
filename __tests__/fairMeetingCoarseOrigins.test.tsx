// @vitest-environment jsdom

// A FAIR MEETING PUB IS COMPARED FROM BROAD AREAS THAT NEVER LEAVE THIS DEVICE.
//
// A crew member opts in, picks broad London night areas for the people coming
// and reads the longest and the average journey to each candidate pub on the
// plan. An area is a controlled label, never an address or a live location.
// The areas are not posted with the group picks. They do not reach a URL,
// analytics or storage. A pub that cannot be located reads as unknown, never
// as zero minutes.
//
// The expected minutes are worked by hand. Camden, Victoria and both located
// pubs sit on longitude -0.143, so each distance is the latitude gap times
// 111.195 km per degree. Minutes are that distance at 4.8 km/h, rounded up.
//   The Middle Arms at 51.5175 is 0.0215 deg from each area: 2.39 km, 30 min.
//   The Northern Tap at 51.534 is 0.005 deg from Camden: 0.56 km, 7 min.
//   The Northern Tap is 0.038 deg from Victoria: 4.23 km, 53 min.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const analytics = vi.hoisted(() => ({
  trackEvent: vi.fn(),
  trackMeaningfulCoreAction: vi.fn(),
}));

vi.mock("@/lib/analytics", () => analytics);

import PlanCollaborationPanel from "@/components/plan/PlanCollaborationPanel";
import type { PlanStopDTO } from "@/lib/plan";

const PLAN_ID = "plan-1";
const MEMBER_ID = "mate-1";
const COMPARE = "Compare journeys from broad areas";
// Either area name or either area centre latitude is a leak.
const LEAKED_AREA = /camden|victoria|51\.539|51\.496/i;

const draftStops: PlanStopDTO[] = [
  { venueId: "venue-a", venueName: "The Middle Arms", position: 0 },
  { venueId: "venue-b", venueName: "The Northern Tap", position: 1 },
  { venueId: "venue-c", venueName: "The Lost Lamb", position: 2 },
];

// The Lost Lamb has no located record, so the venue read answers 404.
const VENUE_COORDS: Record<string, { latitude: number; longitude: number }> = {
  "venue-a": { latitude: 51.5175, longitude: -0.143 },
  "venue-b": { latitude: 51.534, longitude: -0.143 },
};

type Call = { url: string; method: string; body: string };

let host: HTMLDivElement;
let root: Root;
let calls: Call[] = [];

function serve(): void {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method, body: typeof init?.body === "string" ? init.body : "" });
    if (url === `/api/plans/${PLAN_ID}/collaboration`) {
      return Response.json({ memberId: MEMBER_ID, invites: [], constraints: [], proposals: [], votes: [] });
    }
    if (url === `/api/plans/${PLAN_ID}/group-prefs`) {
      if (method !== "POST") return Response.json({ prefs: [] });
      const body = JSON.parse(String(init?.body)) as { budgetBand: string; atmosphereChip: string };
      return Response.json({
        pref: {
          mateId: MEMBER_ID,
          budgetBand: body.budgetBand,
          atmosphereChips: [body.atmosphereChip],
          zeroProof: false,
          accessibilityRequired: false,
          weatherShelterRequired: false,
        },
      }, { status: 201 });
    }
    const venue = /^\/api\/venue\/([^/?]+)$/.exec(url);
    const coords = venue ? VENUE_COORDS[decodeURIComponent(venue[1] ?? "")] : undefined;
    if (coords) return Response.json({ venue: coords });
    return Response.json({ error: "Not found." }, { status: 404 });
  }));
}

async function flush(): Promise<void> {
  for (let turn = 0; turn < 6; turn += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function mountPanel(): Promise<void> {
  await act(async () => {
    root.render(createElement(PlanCollaborationPanel, {
      planId: PLAN_ID,
      memberToken: "token",
      isHost: false,
      draftStops,
      routeRevision: null,
      canPropose: false,
      onProposalCreated: () => {},
    }));
  });
  await flush();
}

function findButton(name: string): HTMLButtonElement | null {
  return [...host.querySelectorAll<HTMLButtonElement>("button")].find(
    (candidate) => candidate.getAttribute("aria-label") === name || candidate.textContent === name,
  ) ?? null;
}

function button(name: string): HTMLButtonElement {
  const found = findButton(name);
  if (!found) throw new Error(`Button not found: ${name}`);
  return found;
}

async function press(name: string): Promise<void> {
  await act(async () => button(name).click());
  await flush();
}

function areaPicker(): HTMLSelectElement | null {
  return host.querySelector<HTMLSelectElement>('select[aria-label="Broad starting area"]');
}

async function addArea(slug: string): Promise<void> {
  const picker = areaPicker();
  if (!picker) throw new Error("The broad starting area picker is not on screen.");
  await act(async () => {
    picker.value = slug;
    picker.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await press("Add area");
}

function journeyRows(): string[] {
  const list = host.querySelector('[aria-label="Journey comparison"]');
  if (!list) return [];
  return [...list.querySelectorAll("li")].map((row) => (row.textContent ?? "").replace(/\s+/g, " ").trim());
}

function storedText(): string {
  return [window.localStorage, window.sessionStorage]
    .flatMap((storage) => Array.from({ length: storage.length }, (_, index) => {
      const key = storage.key(index) ?? "";
      return `${key}=${storage.getItem(key) ?? ""}`;
    }))
    .join("\n");
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.localStorage.clear();
  window.sessionStorage.clear();
  analytics.trackEvent.mockClear();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("fair meeting from broad starting areas", () => {
  it("stays off until a crew member opts in, and reads no pub location before that", async () => {
    serve();
    await mountPanel();

    expect(button(COMPARE).getAttribute("aria-pressed")).toBe("false");
    expect(areaPicker()).toBeNull();
    expect(journeyRows()).toEqual([]);
    expect(calls.some((call) => call.url.startsWith("/api/venue/"))).toBe(false);
  });

  it("compares the longest and the average journey to each candidate pub", async () => {
    serve();
    await mountPanel();
    await press(COMPARE);

    expect(button(COMPARE).getAttribute("aria-pressed")).toBe("true");
    expect(host.textContent).toContain("They stay on this device and are never shared with the plan.");
    const options = [...(areaPicker()?.options ?? [])].map((option) => option.textContent);
    expect(options).toEqual(expect.arrayContaining(["Camden", "Victoria", "Brixton"]));
    // No area yet means nothing to compare, not a row of zeros.
    expect(journeyRows()).toEqual([]);

    await addArea("camden");
    await addArea("victoria");

    expect(journeyRows()).toEqual([
      "The Middle Arms: longest 30 min, average 30 min",
      "The Northern Tap: longest 53 min, average 30 min",
      "The Lost Lamb: journey time unknown",
    ]);
  });

  it("reads a pub it cannot locate as unknown and names the straight-line basis", async () => {
    serve();
    await mountPanel();
    await press(COMPARE);
    await addArea("camden");

    const rows = journeyRows();
    expect(rows).toEqual([
      "The Middle Arms: longest 30 min, average 30 min",
      "The Northern Tap: longest 7 min, average 7 min",
      "The Lost Lamb: journey time unknown",
    ]);
    expect(rows.join(" ")).not.toMatch(/\b0 min/);
    expect(host.textContent).toContain("Straight-line walking estimates from each area's centre.");
    expect(host.textContent).toContain("Not a routed walk, and not step-free evidence.");
    // The comparison asks no route provider for anything.
    expect(calls.some((call) => call.url.includes("walk-route"))).toBe(false);
  });

  it("keeps broad areas out of the shared picks, URLs, analytics and storage", async () => {
    serve();
    await mountPanel();
    await press(COMPARE);
    await addArea("camden");
    await addArea("victoria");
    await press("Under £6");
    await press("Cosy corners");

    const posts = calls.filter((call) => call.method === "POST");
    expect(posts).toHaveLength(1);
    const [post] = posts;
    if (!post) throw new Error("expected one shared-picks write");
    expect(Object.keys(JSON.parse(post.body) as Record<string, unknown>).sort()).toEqual([
      "accessibilityRequired",
      "atmosphereChip",
      "budgetBand",
      "weatherShelterRequired",
      "zeroProof",
    ]);
    for (const call of calls) {
      expect(call.url).not.toMatch(LEAKED_AREA);
      expect(call.body).not.toMatch(LEAKED_AREA);
    }
    // The only location reads are the candidate pubs themselves.
    expect(
      [...new Set(calls.filter((call) => call.url.startsWith("/api/venue/")).map((call) => call.url))].sort(),
    ).toEqual(["/api/venue/venue-a", "/api/venue/venue-b", "/api/venue/venue-c"]);
    expect(window.location.href).not.toMatch(LEAKED_AREA);
    expect(JSON.stringify(analytics.trackEvent.mock.calls)).not.toMatch(LEAKED_AREA);
    expect(storedText()).not.toMatch(LEAKED_AREA);
    expect(journeyRows()).toHaveLength(3);
  });

  it("drops one area on request and forgets every area when the member opts out", async () => {
    serve();
    await mountPanel();
    await press(COMPARE);
    await addArea("camden");
    await addArea("victoria");
    await press("Remove Victoria");

    expect(journeyRows()).toEqual([
      "The Middle Arms: longest 30 min, average 30 min",
      "The Northern Tap: longest 7 min, average 7 min",
      "The Lost Lamb: journey time unknown",
    ]);

    await press(COMPARE);
    expect(button(COMPARE).getAttribute("aria-pressed")).toBe("false");
    expect(areaPicker()).toBeNull();
    expect(journeyRows()).toEqual([]);
    expect(host.textContent).not.toContain("longest");

    await press(COMPARE);
    expect(findButton("Remove Camden")).toBeNull();
    expect(journeyRows()).toEqual([]);
  });
});
