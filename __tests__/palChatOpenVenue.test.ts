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
vi.mock("@/lib/palChatClient", () => ({
  createPalChatSession: () => askSession,
}));
vi.mock("@/lib/conciergeAskClient", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/conciergeAskClient")>(),
  createAskSession: () => askSession,
}));

import PalChat from "@/components/pal/PalChat";
import MapConciergeAsk from "@/components/map/MapConciergeAsk";
import { ASK_PLAN_DRAFT_STORAGE_KEY, type AskProposal } from "@/lib/ask/types";

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
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  router.push.mockReset();
  trackEvent.mockReset();
  sessionStorage.clear();
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
  askSession.mockReset().mockImplementation(() => Promise.resolve(sessionAnswer.value));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(createElement(PalChat));
  });
});

async function showProposal(surface: "chat" | "map", proposal: AskProposal) {
  sessionAnswer.value = { ...answer, cards: [], proposals: [proposal], responseStatus: "ready" };
  if (surface === "map") {
    await act(async () => {
      root?.render(createElement(MapConciergeAsk, { cityId: "london", onSelectVenue: vi.fn() }));
    });
    const open = container.querySelector<HTMLButtonElement>(".mapConciergeAskPill");
    if (!open) throw new Error("Map Ask button not found");
    await act(async () => open.click());
    const example = container.querySelector<HTMLButtonElement>(".mapConciergeAskChip");
    if (!example) throw new Error("Map example ask not found");
    await act(async () => example.click());
  } else {
    const input = container.querySelector<HTMLInputElement>(".palChatInput");
    const form = container.querySelector<HTMLFormElement>("form");
    if (!input || !form) throw new Error("Pal chat form not found");
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, "Help with tonight");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
  }
  const confirm = container.querySelector<HTMLButtonElement>(
    surface === "map" ? ".mapConciergeAskProposalConfirm" : ".palChatProposalConfirm",
  );
  if (!confirm) throw new Error("Proposal confirm button not found");
  expect(router.push).not.toHaveBeenCalled();
  return confirm;
}

describe("Pal proposal navigation", () => {
  it("keeps coordinates and the place name when opening the map", async () => {
    const confirm = await showProposal("chat", {
      id: "fly", kind: "fly_to", label: "Show on map", lat: 51.5074, lng: -0.1278, place: "King's Cross & St Pancras",
    });
    await act(async () => confirm.click());

    expect(router.push).toHaveBeenCalledTimes(1);
    const target = new URL(router.push.mock.calls[0][0], "https://pubmaxxing.test");
    expect(target.pathname).toBe("/map");
    expect(Object.fromEntries(target.searchParams)).toEqual({ lat: "51.5074", lng: "-0.1278", place: "King's Cross & St Pancras" });
    expect(trackEvent).toHaveBeenCalledWith("concierge_result_tap");
  });

  it("saves the map's proposed draft before navigating to Plan", async () => {
    const proposal: AskProposal = {
      id: "draft", kind: "draft_plan", label: "Open in Plan", query: "Plan a crawl in Soho for 4",
      stopIds: ["venue-a", "venue-b"], stopNames: ["The Anchor", "The Ship"],
    };
    const confirm = await showProposal("map", proposal);
    router.push.mockImplementation(() => {
      expect(JSON.parse(sessionStorage.getItem(ASK_PLAN_DRAFT_STORAGE_KEY) ?? "null")).toEqual({
        query: proposal.query, stopIds: proposal.stopIds, stopNames: proposal.stopNames, createdAt: expect.any(String),
      });
    });
    await act(async () => confirm.click());

    expect(router.push).toHaveBeenCalledExactlyOnceWith("/plan");
  });

  it.each(["chat", "map"] as const)("keeps the %s return path when a report needs sign-in", async (surface) => {
    const confirm = await showProposal(surface, {
      id: "occupancy", kind: "report_occupancy", label: "Report full", venueId: "venue-a", level: "full",
    });
    await act(async () => confirm.click());

    expect(router.push).toHaveBeenCalledExactlyOnceWith(
      `/login?mode=signin&from=${surface === "chat" ? "/pal/chat" : "/map"}`,
    );
  });
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  root = null;
  container.remove();
});

describe("Pal venue card navigation", () => {
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
    expect(new URL(router.push.mock.calls[0][0], "https://pubmaxxing.test").searchParams.has("sel")).toBe(false);
  });
});
