// @vitest-environment jsdom

import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PalRecommendationPoint } from "@/lib/palRecommendationMap";

const voice = vi.hoisted(() => ({
  status: "disconnected",
  startSession: vi.fn(), endSession: vi.fn(), sendUserMessage: vi.fn(),
}));
const request = vi.hoisted(() => vi.fn());
const ask = vi.hoisted(() => vi.fn());
const points = [1, 2, 3, 4].map((id) => ({
  id: `venue-${id}`, name: `Soho pub ${id}`, lat: 51.513 + id / 1000, lng: -0.134,
  cheapestPrice: 6, borough: "Westminster",
}));
const cards = points.map((point) => ({
  key: point.id, venueId: point.id, title: point.name, place: "Soho", note: "Listed pub.", price: 6,
  provenance: { kind: "directory", label: "On record", url: `https://example.com/${point.id}` },
}));
const answer = { status: "answered", message: "Four sourced Soho choices.", cards, proposals: [], toolsUsed: ["search_venues"] };

vi.mock("next/dynamic", async () => ({ default: (await import("next/dist/shared/lib/app-dynamic")).default }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => createElement("a", { href }, children),
}));
vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => ({ user: null, session: null }) }));
vi.mock("@/components/nav/SiteNav", () => ({ default: () => null }));
vi.mock("@/components/pal/PubPalMascot", () => ({ PubPalMascot: () => null }));
vi.mock("@/components/map/useWhatsOnTonight", () => ({ useWhatsOnTonight: () => ({ rows: [] }) }));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("@/lib/venuesSlim", () => ({
  loadSlimVenuesForCity: async () => points,
  loadSlimVenuesForCityResult: async () => ({ status: "ready", rows: points }),
}));
vi.mock("@/components/map/canvas/webgl", () => ({ probeWebGl2: () => ({ hasContext: true, status: "" }) }));
vi.mock("@/lib/palChatClient", async (original) => ({
  ...(await original<typeof import("@/lib/palChatClient")>()), createPalChatSession: () => ask,
}));
vi.mock("@/lib/authedFetch", () => ({ authedActionFetch: request }));
vi.mock("@/components/pubpal/palVoiceSounds", () => ({ playPalVoiceSound: vi.fn() }));
vi.mock("@elevenlabs/react", () => ({
  ConversationProvider: ({ children }: { children: ReactNode }) => children,
  useConversationControls: () => voice,
  useConversationMode: () => ({ isListening: voice.status === "connected", isSpeaking: false }),
  useConversationStatus: () => ({ status: voice.status }),
}));

type Session = {
  onConnect: () => void;
  onMessage: (message: { role: string; message: string; event_id: number }) => void;
  onAgentToolRequest: (event: unknown) => void;
  onAgentToolResponse: (event: unknown) => void;
};
let host: HTMLDivElement;
let root: Root;
let escaped: unknown[];
let imported: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("WebGL2RenderingContext", function () {});
  voice.status = "disconnected";
  ask.mockResolvedValue(answer);
  request.mockImplementation(async () => Response.json({
    signedUrl: "wss://voice.example/session", conversationId: "conv_mapisolation01",
  }));
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true, value: { getUserMedia: async () => ({ getTracks: () => [{ stop: vi.fn() }] }) },
  });
  escaped = [];
  imported = vi.fn();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host, { onUncaughtError: (error) => escaped.push(error) });
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.doUnmock("@/components/map/PalRecommendationMapCanvas");
  vi.unstubAllGlobals();
});

async function settle() {
  await act(async () => {
    await vi.dynamicImportSettled();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function send(text: string) {
  const input = host.querySelector("input");
  expect(input).not.toBeNull();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text);
    input!.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    const form = host.querySelector("form");
    if (form) form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    else host.querySelector<HTMLButtonElement>('button[aria-label="Send message"]')!.click();
  });
  await settle();
}

describe.each(["typed", "voice"] as const)("%s recommendation map isolation", (consumer) => {
  it.each(["loaded", "unavailable", "render-failed", "rejected"] as const)("preserves the conversation when the map is %s", async (mode) => {
    vi.doMock("@/components/map/PalRecommendationMapCanvas", async () => {
      imported();
      if (mode === "rejected") throw new Error("Failed to fetch dynamically imported module: pub-map-preview.js");
      return {
        default: ({ points: pins, onUnavailable }: { points: PalRecommendationPoint[]; onUnavailable: () => void }) => {
          if (mode === "render-failed") throw new Error("Map renderer failed");
          return createElement("div", { role: "region", "aria-label": "Loaded pub map" },
            pins.map((pin) => createElement("span", { key: pin.venueId }, pin.name)),
            createElement("button", { type: "button", onClick: onUnavailable }, "Lose map context"));
        },
      };
    });
    let session: Session | undefined;
    let originalComposer: HTMLInputElement | null;
    if (consumer === "typed") {
      const { default: PalChat } = await import("@/components/pal/PalChat");
      await act(async () => root.render(createElement(PalChat)));
      originalComposer = host.querySelector("input");
      await send("Find four pubs in Soho and show them on the map");
    } else {
      const { default: Voice } = await import("@/components/pubpal/PubPalVoiceSession");
      await act(async () => root.render(createElement(Voice, { palName: "Ripley" })));
      await act(async () => host.querySelector<HTMLButtonElement>("button")!.click());
      session = voice.startSession.mock.calls[0]![0] as Session;
      voice.status = "connected";
      await act(async () => {
        session!.onConnect();
        root.render(createElement(Voice, { palName: "Ripley" }));
      });
      originalComposer = host.querySelector("input");
      await act(async () => {
        session!.onMessage({ role: "user", message: "Find four pubs in Soho", event_id: 4 });
        session!.onAgentToolRequest({ tool_call_id: "pubs", event_id: 4, tool_name: "search_venues" });
        session!.onAgentToolResponse({
          tool_call_id: "pubs", event_id: 4, tool_name: "search_venues", is_error: false, is_called: true,
          full_tool_result: JSON.stringify({ result: { ok: true, tool: "search_venues", answerHint: answer.message, cards } }),
        });
      });
      await settle();
    }
    expect(imported).toHaveBeenCalledOnce();
    if (mode === "unavailable") {
      await act(async () => [...host.querySelectorAll("button")].find((button) => button.textContent === "Lose map context")!.click());
    }
    expect(escaped).toEqual([]);
    if (mode === "loaded") {
      expect(host.querySelector('[aria-label="Loaded pub map"]')?.textContent).toContain("Soho pub 4");
    } else {
      expect(host.textContent).toContain("The map preview is unavailable. Open a pub below to see its location.");
    }
    for (const card of cards) {
      expect(host.querySelector(`a[href="${card.provenance.url}"]`)?.textContent).toBe("On record");
      expect(host.textContent).toContain(card.title);
    }
    const composer = host.querySelector("input");
    expect(composer).toBe(originalComposer!);
    expect(composer).not.toBeNull();
    expect(composer!.disabled).toBe(false);
    if (consumer === "typed") {
      ask.mockResolvedValue({ ...answer, message: "Still here.", cards: [], toolsUsed: [] });
      await send("Thanks");
      expect(host.textContent).toContain("Still here.");
    } else {
      expect(voice.endSession).not.toHaveBeenCalled();
      expect(voice.startSession).toHaveBeenCalledOnce();
      await send("Thanks");
      expect(voice.sendUserMessage).toHaveBeenCalledWith("Thanks");
      await act(async () => session!.onMessage({ role: "agent", message: "Still listening.", event_id: 5 }));
      expect(host.textContent).toContain("Still listening.");
      expect(voice.endSession).not.toHaveBeenCalled();
    }
    expect(escaped).toEqual([]);
  });
});
