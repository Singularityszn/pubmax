// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const router = vi.hoisted(() => ({ push: vi.fn() }));
const trackEvent = vi.hoisted(() => vi.fn());
const askSession = vi.hoisted(() => vi.fn());
const loadSlim = vi.hoisted(() => vi.fn());
const loadSlimResult = vi.hoisted(() => vi.fn());
const sessionAnswer = vi.hoisted(() => ({ value: null as unknown }));
const activePlan = vi.hoisted(() => ({ value: null as unknown, on: false }));
const planRead = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => router,
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) =>
    createElement("a", { href: String(href), ...props }, children),
}));
vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => ({ user: null, session: null }),
}));
vi.mock("@/components/nav/SiteNav", () => ({
  default: () => createElement("nav", null, "Navigation"),
}));
vi.mock("@/components/pal/PubPalMascot", () => ({
  PubPalMascot: () => createElement("span", null, "Pal"),
}));
vi.mock("@/components/map/useWhatsOnTonight", () => ({
  useWhatsOnTonight: () => ({ rows: [] }),
}));
vi.mock("@/lib/analytics", () => ({ trackEvent }));
vi.mock("@/lib/venuesSlim", () => ({
  loadSlimVenuesForCity: loadSlim,
  loadSlimVenuesForCityResult: loadSlimResult,
}));
vi.mock("@/lib/palChatClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/palChatClient")>()),
  createPalChatSession: () => askSession,
}));
vi.mock("@/lib/activePlan", () => ({
  readActivePlan: () => activePlan.value,
  isPlanActiveNow: () => activePlan.on,
}));
vi.mock("@/components/plan/usePlanMemberRead", () => ({
  readPlanMemberProjection: planRead,
}));

import PalChat from "@/components/pal/PalChat";
import { clearSurfaceCache } from "@/lib/surfaceDataCache";
import { defined } from "@/__tests__/helpers/defined";

let container: HTMLDivElement;
let root: Root | null = null;

const answer = {
  status: "answered" as const,
  message: "Found one venue.",
  cards: [
    {
      key: "venue-a",
      venueId: "venue-a",
      title: "The Anchor",
      place: "Brixton",
      note: "In Brixton",
      price: 4.5,
      provenance: { label: "On record", kind: "directory" as const },
    },
  ],
  proposals: [],
};

beforeEach(async () => {
  clearSurfaceCache();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  router.push.mockReset();
  trackEvent.mockReset();
  loadSlim.mockReset().mockResolvedValue([
    { id: "venue-a", name: "The Anchor", lat: 0, lng: 0, cheapestPrice: 4.5, borough: "Brixton" },
  ]);
  loadSlimResult.mockReset().mockResolvedValue({
    status: "ready",
    rows: [
      { id: "venue-a", name: "The Anchor", lat: 0, lng: 0, cheapestPrice: 4.5, borough: "Brixton" },
    ],
  });
  sessionAnswer.value = answer;
  activePlan.value = null;
  activePlan.on = false;
  planRead.mockReset().mockResolvedValue(null);
  askSession.mockReset().mockImplementation(() => Promise.resolve(sessionAnswer.value));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(createElement(PalChat));
  });
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  root = null;
  container.remove();
});

async function askPal(text: string): Promise<void> {
  const input = container.querySelector<HTMLInputElement>(".palChatInput");
  const form = container.querySelector<HTMLFormElement>("form");
  if (!input || !form) throw new Error("Pal chat form not found");
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

describe("Pal locality line", () => {
  it("names the London-wide scope above venue cards", async () => {
    await askPal("cheap pint");

    expect(container.querySelector(".palChatLocality")?.textContent).toBe(
      "Across London. No area set, so these aren't ranked by distance.",
    );
  });

  it("shows no locality line under a reply with no cards", async () => {
    sessionAnswer.value = { ...answer, message: "Hi. What kind of night are you planning?", cards: [] };
    await askPal("hi there");

    expect(container.textContent).toContain("Hi. What kind of night are you planning?");
    expect(container.querySelector(".palChatLocality")).toBeNull();
  });

  it("still names a place it could not place when no cards came back", async () => {
    sessionAnswer.value = { ...answer, message: "Name a listed pub to check a price.", cards: [] };
    await askPal("Two cheap pubs in Blackfriars for a quiet pint");

    expect(container.querySelector(".palChatLocality")?.textContent).toContain("Blackfriars");
  });
});

describe("Pal venue card navigation", () => {
  it("routes a confirmed fly-to proposal with its place through the client router", async () => {
    sessionAnswer.value = {
      ...answer,
      proposals: [{
        id: "fly-bank",
        kind: "fly_to",
        label: "Show Bank",
        lat: 51.513,
        lng: -0.089,
        place: "Bank",
      }],
    };
    const input = container.querySelector<HTMLInputElement>(".palChatInput");
    const form = container.querySelector<HTMLFormElement>("form");
    if (!input || !form) throw new Error("Pal chat form not found");

    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setValue?.call(input, "Show Bank");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    const confirm = container.querySelector<HTMLButtonElement>(".palChatProposalConfirm");
    if (!confirm) throw new Error("Fly-to proposal not found");
    await act(async () => confirm.click());

    // The map drops ?lat=&lng= for a point inside London, so a bare London
    // point opens the London map rather than a link that lands on nothing.
    expect(router.push).toHaveBeenCalledWith("/map");
    expect(trackEvent).toHaveBeenCalledWith("concierge_result_tap");
  });

  it("opens the pub a fly-to names, selected on the map", async () => {
    sessionAnswer.value = {
      ...answer,
      proposals: [{
        id: "fly:venue-a",
        kind: "fly_to",
        label: "Fly to The Anchor",
        lat: 51.46,
        lng: -0.11,
        place: "The Anchor",
        venueId: "venue-a",
      }],
    };
    await askPal("fly me to The Anchor");

    const confirm = container.querySelector<HTMLButtonElement>(".palChatProposalConfirm");
    if (!confirm) throw new Error("Fly-to proposal not found");
    await act(async () => confirm.click());

    expect(router.push).toHaveBeenCalledWith("/map?sel=venue-a");
  });

  it("routes a card press through the router and keeps tap analytics", async () => {
    const input = container.querySelector<HTMLInputElement>('.palChatInput');
    const form = container.querySelector<HTMLFormElement>("form");
    if (!input || !form) throw new Error("Pal chat form not found");

    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setValue?.call(input, "quiet near Brixton");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    const venueLink = container.querySelector<HTMLAnchorElement>(".palChatCardBody--link");
    if (!venueLink) throw new Error("Pal venue card link not found");
    await act(async () => venueLink.click());

    expect(router.push).toHaveBeenCalledWith("/map?sel=venue-a");
    expect(trackEvent).toHaveBeenCalledWith("concierge_result_tap");
  });

  it("routes an unmatched card to map browse with the map-owned notice", async () => {
    sessionAnswer.value = {
      ...answer,
      cards: [{ ...answer.cards[0], key: "venue-unknown", venueId: "venue-unknown" }],
    };
    const input = container.querySelector<HTMLInputElement>('.palChatInput');
    const form = container.querySelector<HTMLFormElement>("form");
    if (!input || !form) throw new Error("Pal chat form not found");

    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setValue?.call(input, "quiet near Brixton");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    const venueLink = container.querySelector<HTMLAnchorElement>(".palChatCardBody--link");
    if (!venueLink) throw new Error("Pal venue card link not found");
    expect(venueLink.getAttribute("href")).toBe("/map?mapNotice=unknown");
    await act(async () => {
      venueLink.dispatchEvent(new MouseEvent("click", { bubbles: true, ctrlKey: true }));
    });
    expect(router.push).not.toHaveBeenCalled();
    await act(async () => venueLink.click());

    expect(router.push).toHaveBeenCalledWith("/map?mapNotice=unknown");
    expect(new URL(defined(router.push.mock.calls[0])[0], "https://pubmaxxing.test").searchParams.has("sel")).toBe(false);
  });
});

describe("Pal map asks in the written chat", () => {
  it("opens the map when the person asks for it, without asking the Pal", async () => {
    await askPal("show me the map");

    expect(askSession).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Opening the map");
    expect(router.push).toHaveBeenCalledWith("/map");
  });

  it("opens the next stop of a planned night that is on", async () => {
    activePlan.value = { id: "plan-1", stopIndex: 0 };
    activePlan.on = true;
    planRead.mockResolvedValue({
      stops: [
        { venueId: "venue-a", venueName: "The Anchor" },
        { venueId: "venue-b", venueName: "The Crown" },
      ],
    });
    await askPal("where next?");

    expect(askSession).not.toHaveBeenCalled();
    expect(planRead).toHaveBeenCalledWith("plan-1");
    expect(container.textContent).toContain("Opening The Crown, your next stop");
    expect(router.push).toHaveBeenCalledWith("/map?sel=venue-b");
  });

  it("asks the Pal about a next stop when no night is on", async () => {
    await askPal("next stop");

    expect(askSession).toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
  });

  it("asks the Pal when the person refuses the map", async () => {
    await askPal("don't show me the map, just a cheap pint");

    expect(askSession).toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
  });
});

describe("Pal pub asks in the written chat", () => {
  it("takes \"take me there\" to the pub the Pal just carded", async () => {
    await askPal("quiet pint in Brixton");
    askSession.mockClear();
    await askPal("take me there");

    expect(askSession).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Opening The Anchor");
    expect(router.push).toHaveBeenCalledWith("/map?sel=venue-a");
  });

  it("takes \"take me there\" to the pub a proposal names before its first card", async () => {
    sessionAnswer.value = {
      ...answer,
      cards: [
        { ...answer.cards[0], key: "venue-b", venueId: "venue-b", title: "The Crown" },
        answer.cards[0],
      ],
      proposals: [{ id: "open:venue-a", kind: "open_venue", label: "Open The Anchor", venueId: "venue-a" }],
    };
    loadSlimResult.mockResolvedValue({ status: "ready", rows: [] });
    await askPal("show me The Anchor");
    await askPal("show me it on the map");

    expect(router.push).toHaveBeenCalledWith("/map?sel=venue-a");
  });

  it("reads the Pal's own words when its newest answer carried no card", async () => {
    sessionAnswer.value = { ...answer, message: "Try The Anchor, it is quiet now.", cards: [] };
    await askPal("somewhere quiet");
    askSession.mockClear();
    await askPal("take me there");

    expect(askSession).not.toHaveBeenCalled();
    expect(router.push).toHaveBeenCalledWith("/map?sel=venue-a");
  });

  it("opens a listed pub the person names", async () => {
    await askPal("where is the Anchor?");

    expect(askSession).not.toHaveBeenCalled();
    expect(router.push).toHaveBeenCalledWith("/map?sel=venue-a");
  });

  it("asks the Pal when the name is not one listed pub, or nothing was named", async () => {
    sessionAnswer.value = { ...answer, message: "Which Crown do you mean?", cards: [] };
    await askPal("where is The Crown?");
    expect(askSession).toHaveBeenCalledTimes(1);
    await askPal("take me there");
    expect(router.push).not.toHaveBeenCalled();
  });

  it("asks the Pal when the person refuses", async () => {
    await askPal("quiet pint in Brixton");
    await askPal("don't take me there yet");

    expect(askSession).toHaveBeenCalledTimes(2);
    expect(router.push).not.toHaveBeenCalled();
  });

  it("still opens the map for \"show me on the map\" when no pub is named", async () => {
    await askPal("show me on the map");

    expect(askSession).not.toHaveBeenCalled();
    expect(router.push).toHaveBeenCalledWith("/map");
  });
});
