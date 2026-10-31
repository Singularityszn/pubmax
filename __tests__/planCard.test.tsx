// @vitest-environment jsdom

// THE PLAN AS ONE CARD (PlanAstra 7.4). A member opens /plan/[id] on a phone
// and reads the night before the route: the first stop's photograph (or the
// placeholder tinted by its kind), the plan's name, the start in words, the
// crew, and three actions. Only the capability-gated member read draws it, so
// a preview answer draws nothing and the privacy preview stands alone.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const active = vi.hoisted(() => ({ ref: null as null | { id: string; startTime: string; role: string } }));

vi.mock("@/lib/activePlan", () => ({
  readActivePlan: () => active.ref,
  isPlanActiveNow: (ref: unknown) => Boolean(ref),
  subscribeActivePlan: () => () => undefined,
  setActivePlanRole: vi.fn(),
  markActivePlan: vi.fn(),
}));
vi.mock("@/lib/planSessionCapability", () => ({
  parsePlanCapabilitySnapshot: () => ({ token: "member-token", collaborationAuthorized: true, role: "host" }),
  planCapabilityEvent: (id: string) => `pubmax:plan-capability:${id}`,
  readPlanCapabilitySnapshot: () => "member-token|1|host",
  restorePlanCapability: vi.fn().mockResolvedValue(null),
  writePlanCapability: vi.fn(),
}));
vi.mock("@/components/media/VenueImage", () => ({
  default: ({ sources, alt }: { sources: Array<{ url: string }>; alt: string }) =>
    createElement("img", { "data-testid": "plan-card-photo", src: sources[0]?.url, alt }),
}));

import PlanCard, { planStartInWords } from "@/components/plan/PlanCard";
import { clearPlanMemberProjectionRead } from "@/components/plan/usePlanMemberRead";
import { clearSurfaceCache } from "@/lib/surfaceDataCache";
import { NIGHT_CRAWL_ENGAGE_EVENT } from "@/lib/nightCrawlEngage";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PLAN = "6ab5ca40-836b-4970-9477-d1779fdd31ab";

function memberBody(overrides: Record<string, unknown> = {}) {
  return {
    plan: {
      id: PLAN,
      title: "Sam's leaving do",
      // Friday 17 July 2026, 19:00 in London (BST).
      startTime: "2026-07-17T18:00:00.000Z",
      createdAt: "2026-07-11T12:00:00.000Z",
      routeRevision: 1,
      ...overrides,
    },
    stops: [
      { venueId: "v-second", venueName: "The Second", position: 2 },
      { venueId: "v-first", venueName: "The Lamb", position: 1 },
    ],
    crew: [
      { id: "c2", name: "jo", status: "in", joinedAt: "2026-07-11T13:00:00.000Z", updatedAt: "2026-07-11T13:00:00.000Z" },
      { id: "c1", name: "sam", status: "in", joinedAt: "2026-07-11T12:00:00.000Z", updatedAt: "2026-07-11T12:00:00.000Z" },
    ],
    context: null,
  };
}

const previewBody = {
  visibility: "preview",
  hostDisplayName: "sam",
  areaName: "Soho",
  startLabel: "19:00",
  stopCount: 2,
  vibeLabel: null,
  accessibilitySummary: null,
  routeReady: true,
};

let root: Root;
let container: HTMLDivElement;
let planBody: unknown;
let venueBody: unknown;
const venueReads: string[] = [];

function respond(body: unknown, ok = true): Response {
  return new Response(JSON.stringify(body), { status: ok ? 200 : 404, headers: { "content-type": "application/json" } });
}

beforeEach(() => {
  clearPlanMemberProjectionRead(PLAN);
  clearSurfaceCache();
  active.ref = null;
  planBody = memberBody();
  venueBody = { venue: { id: "v-first", imageUrl: "https://example.com/lamb.jpg", kind: "pub" } };
  venueReads.length = 0;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith(`/api/plans/${PLAN}`)) return respond(planBody);
    if (url.startsWith("/api/venue/")) {
      venueReads.push(url);
      return venueBody === null ? respond({ error: "gone" }, false) : respond(venueBody);
    }
    return respond({}, false);
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

async function render(completed = false) {
  await act(async () => root.render(createElement(PlanCard, { planId: PLAN, completed })));
  for (let i = 0; i < 6; i += 1) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  }
}

function card(): HTMLElement | null {
  return container.querySelector<HTMLElement>('[data-testid="plan-card"]');
}

function actionLabels(): string[] {
  return Array.from(card()!.querySelectorAll(".planCard__actions a, .planCard__actions button")).map((node) => node.textContent ?? "");
}

describe("planStartInWords", () => {
  it("says the day and the hour the way a person texts it, in London time", () => {
    expect(planStartInWords("2026-07-17T18:00:00.000Z")).toBe("Friday, 7pm");
    expect(planStartInWords("2026-07-18T18:30:00.000Z")).toBe("Saturday, 7:30pm");
    expect(planStartInWords("2026-12-04T12:00:00.000Z")).toBe("Friday, 12pm");
    expect(planStartInWords("not a time")).toBeNull();
  });
});

describe("PlanCard", () => {
  it("draws the member card: cover, name, start in words, crew handles and the actions", async () => {
    await render();
    const drawn = card()!;
    expect(drawn).not.toBeNull();
    expect(drawn.querySelector("h1")?.textContent).toBe("Sam's leaving do");
    expect(drawn.querySelector(".planCard__when")?.textContent).toBe("Friday, 7pm");
    // The first stop by position, not by array order.
    expect(venueReads[0]).toContain("/api/venue/v-first");
    const photo = drawn.querySelector<HTMLImageElement>('[data-testid="plan-card-photo"]')!;
    expect(photo.getAttribute("src")).toBe("https://example.com/lamb.jpg");
    expect(drawn.querySelector(".planCard__firstStop")?.textContent).toBe("First up: The Lamb");
    // Handles in the order they joined; names only, never faces.
    expect(Array.from(drawn.querySelectorAll(".planCard__handle")).map((node) => node.textContent)).toEqual(["sam", "jo"]);
    expect(drawn.querySelector("img:not([data-testid])")).toBeNull();
    expect(actionLabels()).toEqual(["Send to the crew", "Who’s in"]);
  });

  it("spends coral once: Send is the one primary, Who's in is ink and lands on the crew", async () => {
    await render();
    const send = card()!.querySelector<HTMLAnchorElement>(".planCard__primary")!;
    expect(send.textContent).toBe("Send to the crew");
    expect(send.className).toContain("uiButton--primary");
    expect(send.getAttribute("href")).toBe("#share");
    const secondaries = Array.from(card()!.querySelectorAll<HTMLElement>(".planCard__secondary"));
    expect(secondaries.every((node) => node.className.includes("uiButton--secondary"))).toBe(true);
    expect(secondaries[0]!.getAttribute("href")).toBe("#crew");
  });

  it("offers Night mode only while the night is on, and opens the existing night crawl mode", async () => {
    active.ref = { id: PLAN, startTime: "2026-07-17T18:00:00.000Z", role: "host" };
    await render();
    expect(actionLabels()).toEqual(["Send to the crew", "Who’s in", "Night mode"]);
    const engaged: unknown[] = [];
    const onEngage = (event: Event) => engaged.push((event as CustomEvent).detail);
    window.addEventListener(NIGHT_CRAWL_ENGAGE_EVENT, onEngage);
    const nightMode = Array.from(card()!.querySelectorAll("button")).find((node) => node.textContent === "Night mode")!;
    await act(async () => nightMode.click());
    window.removeEventListener(NIGHT_CRAWL_ENGAGE_EVENT, onEngage);
    expect(engaged).toEqual([{ planId: PLAN }]);
  });

  it("paints the placeholder tinted by the pub's kind when the first stop has no photo", async () => {
    venueBody = { venue: { id: "v-first", imageUrl: "", kind: "bar" } };
    await render();
    expect(card()!.querySelector('[data-testid="plan-card-photo"]')).toBeNull();
    expect(card()!.querySelector('[data-testid="plan-card-placeholder"]')).not.toBeNull();
    expect(card()!.querySelector(".planCard__cover")?.getAttribute("data-kind")).toBe("bar");
  });

  it("keeps the placeholder when the venue read does not land", async () => {
    venueBody = null;
    await render();
    expect(card()!.querySelector('[data-testid="plan-card-placeholder"]')).not.toBeNull();
    expect(card()!.querySelector(".planCard__cover")?.getAttribute("data-kind")).toBe("pub");
  });

  it("draws nothing for a non-member: the preview answer leaves the privacy preview alone", async () => {
    planBody = previewBody;
    await render();
    expect(card()).toBeNull();
    expect(container.textContent).toBe("");
    expect(venueReads).toHaveLength(0);
  });

  it("draws nothing once the night is over", async () => {
    await render(true);
    expect(card()).toBeNull();
    planBody = memberBody({ status: "completed" });
    clearPlanMemberProjectionRead(PLAN);
    await act(async () => root.unmount());
    root = createRoot(container);
    await render();
    expect(card()).toBeNull();
  });
});
