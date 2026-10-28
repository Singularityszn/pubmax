// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const askSession = vi.hoisted(() => vi.fn());
const createSession = vi.hoisted(() => vi.fn());
const whatsOnGlance = vi.hoisted(() => vi.fn());
const slimLoad = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
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
  useWhatsOnTonight: whatsOnGlance,
}));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("@/lib/venuesSlim", () => ({
  loadSlimVenuesForCity: slimLoad,
  loadSlimVenuesForCityResult: vi.fn().mockResolvedValue({ status: "ready", rows: [] }),
}));
vi.mock("@/lib/palChatClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/palChatClient")>()),
  createPalChatSession: () => {
    createSession();
    return askSession;
  },
}));

import PalChat from "@/components/pal/PalChat";
import { clearSurfaceCache } from "@/lib/surfaceDataCache";
import * as chatThread from "@/lib/palChatThread";

let container: HTMLDivElement;
let root: Root | null = null;

beforeEach(async () => {
  clearSurfaceCache();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  askSession.mockReset();
  createSession.mockReset();
  whatsOnGlance.mockReturnValue({ rows: [], status: "idle" });
  slimLoad.mockResolvedValue([]);
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
  vi.restoreAllMocks();
});

async function typeQuery(text: string): Promise<void> {
  const input = container.querySelector<HTMLInputElement>(".palChatInput");
  if (!input) throw new Error("Pal chat input not found");
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function submit(text: string): Promise<void> {
  await typeQuery(text);
  const form = container.querySelector<HTMLFormElement>("form");
  if (!form) throw new Error("Pal chat form not found");
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

describe("a typed Pal answer that streams in", () => {
  it("keeps failed history restoration visible and preserves history until an explicit new conversation", async () => {
    const read = vi.spyOn(chatThread, "readPalChatThread").mockRejectedValueOnce(new Error("Chunk unavailable"));
    const save = vi.spyOn(chatThread, "savePalChatThread");
    await act(async () => { root?.render(createElement(PalChat, { key: "failed-history" })); });
    expect(container.textContent).toContain("Your earlier conversation could not be restored.");
    expect(container.querySelector<HTMLInputElement>(".palChatInput")?.disabled).toBe(true);
    expect(save).not.toHaveBeenCalled();
    read.mockResolvedValueOnce(null);
    await act(async () => { container.querySelector<HTMLButtonElement>(".palChatReset")?.click(); });
    expect(container.querySelector<HTMLInputElement>(".palChatInput")?.disabled).toBe(false);
    askSession.mockResolvedValue({ status: "empty", message: "Nothing sourced for that.", cards: [], proposals: [] });
    await submit("Find pubs in Soho");
    expect(container.textContent).toContain("Nothing sourced for that.");
    expect(askSession).toHaveBeenCalledTimes(1);
  });
  it("opens with a conversational greeting without creating a provider session", () => {
    expect(container.querySelector(".palChatRow--pal .palChatBubble")?.textContent).toBe(
      "Hi. What kind of night are you planning?",
    );
    expect(container.querySelector('[aria-label="Pick a vibe"]')).not.toBeNull();
    expect(container.querySelectorAll(".palChatCard")).toHaveLength(0);
    expect(createSession).not.toHaveBeenCalled();
    expect(askSession).not.toHaveBeenCalled();
  });

  it("shows the text as it arrives, drops it back to the dots on a reset, then swaps in the answer with its cards", async () => {
    let onText: (text: string) => void = () => {};
    let finish: (result: unknown) => void = () => {};
    askSession.mockImplementation(
      (_query: string, _city: string, callback: (text: string) => void) =>
        new Promise((resolve) => {
          onText = callback;
          finish = resolve;
        }),
    );

    await submit("cheapest pint in Soho");
    expect(container.querySelector(".palChatBubble--pending")).not.toBeNull();
    expect(container.querySelector('[data-testid="pal-streaming-answer"]')).toBeNull();

    await act(async () => onText("Let me check prices"));
    const streaming = container.querySelector('[data-testid="pal-streaming-answer"]');
    expect(streaming?.textContent).toBe("Let me check prices");
    expect(streaming?.getAttribute("aria-live")).toBe("off");
    expect(container.querySelector(".palChatBubble--pending")).toBeNull();

    await act(async () => onText(""));
    expect(container.querySelector('[data-testid="pal-streaming-answer"]')).toBeNull();
    expect(container.querySelector(".palChatBubble--pending")).not.toBeNull();

    await act(async () => onText("The cheapest pint in Soho"));
    expect(container.querySelector('[data-testid="pal-streaming-answer"]')?.textContent).toBe(
      "The cheapest pint in Soho",
    );

    await act(async () =>
      finish({
        status: "answered",
        message: "The cheapest pint in Soho is at The Crown for 4.80.",
        cards: [
          {
            key: "c1",
            venueId: "london-a",
            title: "The Crown",
            place: "Soho",
            note: "Listed pint.",
            price: 4.8,
            provenance: { label: "On record", kind: "directory" },
          },
        ],
        proposals: [],
      }),
    );

    expect(container.querySelector('[data-testid="pal-streaming-answer"]')).toBeNull();
    expect(container.querySelector(".palChatBubble--pending")).toBeNull();
    const bubbles = [...container.querySelectorAll(".palChatRow--pal .palChatBubble")];
    expect(bubbles.map((bubble) => bubble.textContent)).toEqual([
      "The cheapest pint in Soho is at The Crown for 4.80.",
    ]);
    expect(container.querySelectorAll(".palChatCard")).toHaveLength(1);
  });

  it("drops the half-written text when the turn fails and shows the error", async () => {
    askSession.mockImplementation(
      async (_query: string, _city: string, callback: (text: string) => void) => {
        callback("The cheapest");
        return { status: "error", message: "The signal dropped. Text still works." };
      },
    );

    await submit("cheapest pint in Soho");

    expect(container.querySelector('[data-testid="pal-streaming-answer"]')).toBeNull();
    expect(container.querySelector(".palChatBubble--error")?.textContent).toContain("The signal dropped");
  });

  it("retries the exact failed question only after the user asks again", async () => {
    const query = "Hello. Can you help me plan a quiet night in Soho for two?";
    askSession.mockResolvedValueOnce({ status: "error", message: "Couldn't answer that. Try again." });
    await submit(query);
    expect(askSession).toHaveBeenCalledTimes(1);
    const retry = container.querySelector<HTMLButtonElement>('button[aria-label^="Ask again:"]');
    if (!retry) throw new Error("The failed ask has no recovery action");
    expect(retry.textContent).toBe("Ask again");
    expect(retry.getAttribute("aria-label")).toBe(`Ask again: ${query}`);
    expect(container.querySelector<HTMLInputElement>(".palChatInput")?.value).toBe("");

    let finish: (result: unknown) => void = () => {};
    askSession.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await act(async () => retry.click());
    expect(askSession).toHaveBeenCalledTimes(2);
    expect(askSession.mock.calls[1]?.[0]).toBe(query);
    expect(retry.disabled).toBe(true);
    await act(async () => retry.click());
    expect(askSession).toHaveBeenCalledTimes(2);
    await act(async () => finish({ status: "empty", message: "Tell me your budget for the night.", cards: [], proposals: [] }));
    expect(container.textContent).toContain("Tell me your budget for the night.");
  });

  it("keeps the sign-in recovery separate from provider retry", async () => {
    askSession.mockResolvedValueOnce({ status: "error", message: "Sign in to ask Pub Pal.", needsSignIn: true });
    await submit("Quiet pubs in Soho");
    expect(container.querySelector('button[aria-label^="Ask again:"]')).toBeNull();
    expect(askSession).toHaveBeenCalledTimes(1);
  });

  it("preserves a different unsent draft while retrying the failed question", async () => {
    const failedQuery = "Quiet pubs in Soho for two";
    const draft = "Wine prices at The Lamb";
    askSession.mockResolvedValueOnce({ status: "error", message: "Couldn't answer that. Try again." });
    await submit(failedQuery);
    expect(container.querySelector<HTMLInputElement>(".palChatInput")?.value).toBe("");
    await typeQuery(draft);
    let finish: (result: unknown) => void = () => {};
    askSession.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const retry = container.querySelector<HTMLButtonElement>('button[aria-label^="Ask again:"]');
    if (!retry) throw new Error("The failed ask has no recovery action");
    await act(async () => retry.click());
    expect(askSession.mock.calls[1]?.[0]).toBe(failedQuery);
    expect(container.querySelector<HTMLInputElement>(".palChatInput")?.value).toBe(draft);
    await act(async () => finish({ status: "empty", message: "Tell me your budget for the night.", cards: [], proposals: [] }));
    expect(container.querySelector<HTMLInputElement>(".palChatInput")?.value).toBe(draft);
    askSession.mockResolvedValueOnce({ status: "empty", message: "No wine prices recorded at The Lamb yet.", cards: [], proposals: [] });
    await submit(draft);
    expect(askSession.mock.calls[2]?.[0]).toBe(draft);
    expect(container.querySelector<HTMLInputElement>(".palChatInput")?.value).toBe("");
  });
});


describe("first-open summaries carry their own receipts", () => {
  it("qualifies the ranked price and dates both summaries without starting chat", async () => {
    whatsOnGlance.mockReturnValue({ status: "ready", rows: [
      { id: "q1", kind: "quiz", observedAt: "2026-07-11T18:00:00.000Z", source: { label: "Question One", url: "https://questionone.com/venues/test/" } },
      { id: "m1", kind: "music", observedAt: "2026-10-02T12:00:00.000Z", source: { label: "Venue listing", url: "https://example.com/music" } },
    ] });
    slimLoad.mockResolvedValue([
      { id: "venue-p7p18j", name: "The Cheapside Arms", lat: 51.510, lng: -0.128, borough: "Westminster", cheapestPrice: 2.95, priceSource: "Pint Prices", priceObservedAt: "2026-10-02T11:48:33.000Z" },
      { id: "b", name: "Second", lat: 51.511, lng: -0.128, borough: "Westminster", cheapestPrice: 5 },
      { id: "c", name: "Third", lat: 51.512, lng: -0.128, borough: "Westminster", cheapestPrice: 6 },
    ]);
    await act(async () => root?.render(createElement(PalChat, { key: "receipts" })));
    const tonight = container.querySelector('[aria-label="Tonight at a glance"]');
    const price = container.querySelector('[aria-label="Listed price nearby"]');
    expect(tonight?.textContent).toContain("In our London listings tonight:");
    expect(tonight?.textContent).toContain("Question One");
    expect(tonight?.textContent).toContain("Venue listing");
    expect(tonight?.textContent).toContain("Oldest listing observed 11 July 2026");
    expect(tonight?.querySelector('a[href="/tonight"]')).not.toBeNull();
    expect(price?.textContent).toContain("Lowest listed price within 1 km of central London");
    expect(price?.textContent).toContain("£2.95 at The Cheapside Arms");
    expect(price?.textContent).toContain("Pint Prices");
    expect(price?.textContent).toContain("Source read 2 October 2026");
    expect(price?.textContent).toContain("Serving size, offer and entry terms are not recorded");
    expect(price?.querySelector('a[href="/map?sel=venue-p7p18j"]')).not.toBeNull();
    expect(price?.textContent).not.toContain("verified");
    expect(price?.textContent).not.toContain("student-only");
    expect(createSession).not.toHaveBeenCalled();
  });

  it("keeps publisher and read date unknown for an older slim payload", async () => {
    slimLoad.mockResolvedValue([{ id: "old", name: "Old Arms", lat: 51.51, lng: -0.128, borough: "Westminster", cheapestPrice: 4 }]);
    await act(async () => root?.render(createElement(PalChat, { key: "unknown-receipts" })));
    const price = container.querySelector('[aria-label="Listed price nearby"]');
    expect(price?.textContent).toContain("Lowest listed price among nearby pubs around central London");
    expect(price?.textContent).toContain("Publisher not recorded");
    expect(price?.textContent).toContain("Source read date unknown");
    expect(price?.textContent).not.toContain("2 October");
  });
});


describe("an empty Tonight summary", () => {
  it("states its missing sources without claiming the whole city is quiet", async () => {
    whatsOnGlance.mockReturnValue({ status: "empty", rows: [] });
    await act(async () => root?.render(createElement(PalChat, { key: "empty-receipts" })));
    const tonight = container.querySelector('[aria-label="Tonight at a glance"]');
    expect(tonight?.textContent).toContain("No listings in this view tonight");
    expect(tonight?.textContent).toContain("No listing sources returned");
    expect(tonight?.querySelector('a[href="/tonight"]')).not.toBeNull();
  });
});
