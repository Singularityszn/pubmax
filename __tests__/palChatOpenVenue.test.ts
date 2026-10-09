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

import PalChat from "@/components/pal/PalChat";
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

    expect(router.push).toHaveBeenCalledWith("/map?lat=51.513&lng=-0.089&place=Bank");
    expect(trackEvent).toHaveBeenCalledWith("concierge_result_tap");
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
