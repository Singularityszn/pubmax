// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const askSession = vi.hoisted(() => vi.fn());

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
  useWhatsOnTonight: () => ({ rows: [] }),
}));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("@/lib/venuesSlim", () => ({
  loadSlimVenuesForCity: vi.fn().mockResolvedValue([]),
  loadSlimVenuesForCityResult: vi.fn().mockResolvedValue({ status: "ready", rows: [] }),
}));
vi.mock("@/lib/palChatClient", () => ({
  createPalChatSession: () => askSession,
}));

import PalChat from "@/components/pal/PalChat";

let container: HTMLDivElement;
let root: Root | null = null;

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  askSession.mockReset();
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

async function submit(text: string): Promise<void> {
  const input = container.querySelector<HTMLInputElement>(".palChatInput");
  const form = container.querySelector<HTMLFormElement>("form");
  if (!input || !form) throw new Error("Pal chat form not found");
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

describe("a typed Pal answer that streams in", () => {
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
});
