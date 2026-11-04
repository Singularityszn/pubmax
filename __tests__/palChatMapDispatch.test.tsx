// @vitest-environment jsdom

import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeActivePlan } from "@/lib/activePlan";
import { clearSurfaceCache } from "@/lib/surfaceDataCache";
import { GENERIC_MAP_COMMANDS, GROUP_MAP_REQUESTS, NEXT_STOP_NOUN_REQUESTS, REFUSED_MAP_COMMANDS, SOCIAL_MAP_COMMANDS, serviceBesideMap } from "./fixtures/askMapCommands";

import { parseConciergeIntent } from "@/lib/concierge/intent";

const push = vi.hoisted(() => vi.fn());
const request = vi.hoisted(() => vi.fn());
const planRead = vi.hoisted(() => vi.fn());
const harp = { id: "venue-1bz7oic", name: "The Harp", lat: 51.5098, lng: -0.1261, borough: "Westminster", cheapestPrice: null };
const lamb = { ...harp, id: "venue-lamb", name: "The Lamb" };

vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => createElement("a", { href }, children),
}));
vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => ({ user: null, session: null }) }));
vi.mock("@/components/nav/SiteNav", () => ({ default: () => null }));
vi.mock("@/components/pal/PubPalMascot", () => ({ PubPalMascot: () => null }));
vi.mock("@/components/pal/PalChatCompanion", () => ({ default: () => null }));
vi.mock("@/components/map/useWhatsOnTonight", () => ({ useWhatsOnTonight: () => ({ rows: [] }) }));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("@/components/plan/usePlanMemberRead", () => ({ readPlanMemberProjection: planRead }));
vi.mock("@/components/map/canvas/webgl", () => ({ probeWebGl2: () => ({ hasContext: true, status: "" }) }));
vi.mock("@/components/map/PalRecommendationMapCanvas", () => ({ default: () => null }));
vi.mock("@/lib/venuesSlim", () => ({
  loadSlimVenuesForCity: async () => [harp, lamb],
  loadSlimVenuesForCityResult: async () => ({ status: "ready", rows: [harp, lamb] }),
}));
vi.mock("@/lib/authedFetch", async (original) => ({
  ...(await original<typeof import("@/lib/authedFetch")>()), authedActionFetch: request,
}));

let host: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  vi.clearAllMocks();
  clearSurfaceCache();
  localStorage.clear();
  sessionStorage.clear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("WebGL2RenderingContext", function () {});
  request.mockImplementation(async (_url, init) => Response.json(init?.method === "POST"
    ? { answer: "Service answer.", cards: [], proposals: [] }
    : { thread: null }));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const { default: PalChat } = await import("@/components/pal/PalChat");
  await act(async () => root.render(createElement(PalChat)));
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function send(text: string) {
  const input = host.querySelector("input");
  expect(input?.disabled).toBe(false);
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text);
    input!.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    const form = host.querySelector("form");
    expect(form).not.toBeNull();
    const submit = form!.querySelector<HTMLButtonElement>('button[type="submit"]');
    expect(submit?.disabled).toBe(false);
    form!.requestSubmit(submit!);
    await vi.dynamicImportSettled();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const evidence = "Show the source and date for any price you use.";
const withEvidence = (request: string) => [request, `${evidence} ${request}`, `${request.replace(/[.!?]+$/, "")}. ${evidence}`];

describe("mounted typed map dispatch", () => {
  it.each(GROUP_MAP_REQUESTS)("retains the submitted group at the intent boundary: %s", async (query) => {
    await send(query);
    expect(push).not.toHaveBeenCalled();
    const sent = request.mock.calls.filter(([url, init]) => url === "/api/pub-pal/chat" && init?.method === "POST");
    expect(sent).toHaveLength(1);
    const submitted = JSON.parse(sent[0]![1].body).query;
    expect(submitted).toBe(query);
    expect(host.textContent).toContain(query);
    const parsed = await parseConciergeIntent(submitted, { skipModel: true });
    expect(parsed.intent).toMatchObject({ groupSize: 8, area: "Soho" });
  });

  describe.each([false, true])("named target with another retained choice %s", (retained) => {
    it.each(withEvidence("Where is The Harp? Show me the map."))("opens the explicit named target: %s", async (query) => {
      if (retained) {
        request.mockImplementation(async (_url, init) => Response.json(init?.method === "POST"
          ? { answer: "Try The Lamb.", cards: [{ venueId: lamb.id, title: lamb.name, place: "Westminster", price: null }], proposals: [], toolsUsed: ["search_venues"] }
          : { thread: null }));
        await send("Find pubs in Camden");
        const map = host.querySelector<HTMLElement>(".palChatMap");
        expect(map).not.toBeNull();
        map!.scrollIntoView = vi.fn();
      }
      const before = request.mock.calls.filter(([url, init]) => url === "/api/pub-pal/chat" && init?.method === "POST").length;
      await send(query);
      expect(push).toHaveBeenCalledExactlyOnceWith(`/map?sel=${harp.id}`);
      expect(host.textContent).toContain(query);
      expect(host.textContent).toContain("Opening The Harp");
      expect(request.mock.calls.filter(([url, init]) => url === "/api/pub-pal/chat" && init?.method === "POST")).toHaveLength(before);
    });
  });

  it.each(["Date night", "Garden", "For four", "Near Soho"].flatMap((service) =>
    ["Open the map", "Show the map please", "Can you open up the pub map", "Map view", "Open the full map", "View the whole map please"].flatMap((map) => serviceBesideMap(service, map)),
  ))("separates supported map commands before service submission: %s", async (query) => {
    await send(query);
    expect(push).not.toHaveBeenCalled();
    const sent = request.mock.calls.filter(([url, init]) => url === "/api/pub-pal/chat" && init?.method === "POST");
    expect(sent).toHaveLength(1);
    expect(JSON.parse(sent[0]![1].body).query).toBe(query);
    expect(host.textContent).toContain(query);
    expect(host.textContent).toContain("Service answer.");
  });

  it.each([
    "Date night. Show the map.",
    "Any Tube delays? Show me the map. Show the source and date for any price you use.",
    ...[
      "Quiet-ish near Bank, 4 of us.", "Near Soho.", "For four.", "Garden.",
    ].flatMap((request) => [`${request} Show the map.`, `Show the map. ${request}`]),
    "Show the map. Date night.",
    "Show me the map. Any Tube delays?",
    ...["Date night", "Garden", "For four", "Near Soho", "Under £6", "Any Tube delays?"].map((service) => `${service} show me the map`),
  ].flatMap(withEvidence))("sends the original service request to chat: %s", async (query) => {
    await send(query);
    expect(push).not.toHaveBeenCalled();
    const sent = request.mock.calls.filter(([url, init]) => url === "/api/pub-pal/chat" && init?.method === "POST");
    expect(sent).toHaveLength(1);
    expect(JSON.parse(sent[0]![1].body).query).toBe(query);
    expect(host.textContent).toContain(query);
    expect(host.textContent).toContain("Service answer.");
  });

  it("focuses retained choices beside price evidence", async () => {
    request.mockImplementation(async (_url, init) => Response.json(init?.method === "POST"
      ? { answer: "Listed choice.", cards: [{ venueId: harp.id, title: harp.name, place: "Westminster", price: null }], proposals: [], toolsUsed: ["search_venues"] }
      : { thread: null }));
    await send("Find pubs in Camden");
    const map = host.querySelector<HTMLElement>(".palChatMap");
    expect(map).not.toBeNull();
    map!.scrollIntoView = vi.fn();
    await send(`Show those pubs on the map. ${evidence}`);
    expect(push).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(map);
    expect(map!.scrollIntoView).toHaveBeenCalled();
    expect(request.mock.calls.filter(([url, init]) => url === "/api/pub-pal/chat" && init?.method === "POST")).toHaveLength(1);
  });

  it.each(REFUSED_MAP_COMMANDS)("keeps retained choices still after refusal: %s", async (query) => {
    request.mockImplementation(async (_url, init) => Response.json(init?.method === "POST"
      ? { answer: "Listed choice.", cards: [{ venueId: harp.id, title: harp.name, place: "Westminster", price: null }], proposals: [], toolsUsed: ["search_venues"] }
      : { thread: null }));
    await send("Find pubs in Camden");
    const map = host.querySelector<HTMLElement>(".palChatMap");
    expect(map).not.toBeNull();
    map!.scrollIntoView = vi.fn();
    await send(query);
    expect(push).not.toHaveBeenCalled();
    expect(document.activeElement).not.toBe(map);
    expect(map!.scrollIntoView).not.toHaveBeenCalled();
    expect(planRead).not.toHaveBeenCalled();
    const sent = request.mock.calls.filter(([url, init]) => url === "/api/pub-pal/chat" && init?.method === "POST");
    expect(sent).toHaveLength(2);
    expect(JSON.parse(sent.at(-1)![1].body).query).toBe(query);
  });

  it.each(["Show me on the map", "Show those pubs on the map"].flatMap(withEvidence))(
    "opens the map when the requested retained choice is absent: %s", async (query) => {
      await send(query);
      expect(push).toHaveBeenCalledExactlyOnceWith("/map");
      expect(host.textContent).toContain(query);
      expect(request.mock.calls.filter(([url, init]) => url === "/api/pub-pal/chat" && init?.method === "POST")).toHaveLength(0);
    },
  );

  it.each([true, false])("uses the next stop only when the plan is active: %s", async (active) => {
    const planId = "11111111-1111-4111-8111-111111111111";
    writeActivePlan({ id: planId, startTime: new Date(Date.now() - (active ? 1 : 48) * 60 * 60 * 1000).toISOString(), stopIndex: 0 });
    planRead.mockResolvedValue({ stops: [{ venueId: "venue-first", venueName: "First pub" }, { venueId: harp.id, venueName: harp.name }] });
    await send(`Show me the map for the next stop. ${evidence}`);
    expect(push).toHaveBeenCalledExactlyOnceWith(active ? "/map?sel=venue-1bz7oic" : "/map");
    if (active) expect(planRead).toHaveBeenCalledExactlyOnceWith(planId);
    else expect(planRead).not.toHaveBeenCalled();
  });

  it.each([...NEXT_STOP_NOUN_REQUESTS, "What's next tonight?", "Next stop. Next stop please."])("opens the active plan after a qualified request: %s", async (query) => {
    const planId = "11111111-1111-4111-8111-111111111111";
    writeActivePlan({ id: planId, startTime: new Date(Date.now() - 60 * 60 * 1000).toISOString(), stopIndex: 0 });
    planRead.mockResolvedValue({ stops: [{ venueId: "venue-first", venueName: "First pub" }, { venueId: harp.id, venueName: harp.name }] });
    await send(query);
    expect(push).toHaveBeenCalledExactlyOnceWith("/map?sel=venue-1bz7oic");
    expect(planRead).toHaveBeenCalledExactlyOnceWith(planId);
    expect(host.textContent).toContain(query);
    expect(request.mock.calls.filter(([url, init]) => url === "/api/pub-pal/chat" && init?.method === "POST")).toHaveLength(0);
  });

  it.each([harp, lamb].flatMap((venue) => withEvidence(`Show ${venue.name} on the map.`).map((query) => ({ query, venue }))))("opens the listed named pub: $query", async ({ query, venue }) => {
    await send(query);
    expect(push).toHaveBeenCalledWith(`/map?sel=${venue.id}`);
    expect(host.textContent).toContain(query);
    expect(host.textContent).toContain(`Opening ${venue.name}`);
    expect(request.mock.calls.filter(([url, init]) => url === "/api/pub-pal/chat" && init?.method === "POST")).toHaveLength(0);
  });

  describe.each([false, true])("with prior Camden turn %s", (priorCamden) => {
    it.each(REFUSED_MAP_COMMANDS.flatMap(withEvidence))("submits a refused map command without navigation: %s", async (query) => {
      if (priorCamden) await send("Find four pubs in Camden");
      await send(query);
      expect(push).not.toHaveBeenCalled();
      const sent = request.mock.calls.filter(([url, init]) => url === "/api/pub-pal/chat" && init?.method === "POST");
      expect(JSON.parse(sent.at(-1)![1].body).query).toBe(query);
      expect(host.textContent).toContain(query);
    });

    it.each([
      "OK. Show me the map", "Alright, show me the map", "Great. Show the map",
      "That sounds good. Show me the map", "In fact, show me the map",
      "Hi. Show me the map", "Show me the map",
      ...SOCIAL_MAP_COMMANDS,
      ...GENERIC_MAP_COMMANDS,
    ].flatMap(withEvidence))("opens the generic map: %s", async (query) => {
      if (priorCamden) await send("Find four pubs in Camden");
      const before = request.mock.calls.filter(([url, init]) => url === "/api/pub-pal/chat" && init?.method === "POST").length;
      await send(query);
      expect(push).toHaveBeenCalledExactlyOnceWith("/map");
      expect(host.textContent).toContain(query);
      expect(request.mock.calls.filter(([url, init]) => url === "/api/pub-pal/chat" && init?.method === "POST")).toHaveLength(before);
    });
  });

  it.each(REFUSED_MAP_COMMANDS.flatMap(withEvidence))("does not open an active plan after refusal: %s", async (query) => {
    writeActivePlan({ id: "11111111-1111-4111-8111-111111111111", startTime: new Date(Date.now() - 60 * 60 * 1000).toISOString(), stopIndex: 0 });
    await send(query);
    expect(push).not.toHaveBeenCalled();
    expect(planRead).not.toHaveBeenCalled();
    const sent = request.mock.calls.filter(([url, init]) => url === "/api/pub-pal/chat" && init?.method === "POST");
    expect(JSON.parse(sent.at(-1)![1].body).query).toBe(query);
  });
});
