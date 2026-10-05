// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AskProposal } from "@/lib/ask/types";

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

async function askWithProposals(proposals: AskProposal[]): Promise<void> {
  askSession.mockResolvedValue({ status: "answered", message: "Noted.", cards: [], proposals });
  const input = container.querySelector<HTMLInputElement>(".palChatInput");
  const form = container.querySelector<HTMLFormElement>("form");
  if (!input || !form) throw new Error("Pal chat form not found");
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, "I like cask ale");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  if (!container.querySelector(".palChatProposalConfirm")) throw new Error("Proposal card not shown");
}

describe("Pal memory card disclosure", () => {
  it("tells the person a saved memory goes to ElevenLabs beside the memory card", async () => {
    await askWithProposals([
      { id: "remember:1", kind: "remember_memory", label: "Remember: Cask ale", memoryKind: "drink_preference", value: "Cask ale" },
    ]);

    const note = container.querySelector(".palChatProposalNote");
    expect(note?.textContent).toMatch(/goes with each Pub Pal chat to ElevenLabs/);
  });

  it("shows no memory disclosure beside a card that saves nothing", async () => {
    await askWithProposals([
      { id: "fly-bank", kind: "fly_to", label: "Show Bank", lat: 51.513, lng: -0.089, place: "Bank" },
    ]);

    expect(container.querySelector(".palChatProposalNote")).toBeNull();
    expect(container.textContent).not.toContain("ElevenLabs");
  });
});
