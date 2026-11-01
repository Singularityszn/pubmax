// @vitest-environment jsdom
// A guest question still waiting on a pub lookup when the chat body leaves
// (sign-in remounts the chat for the new account) must never reach the Pal,
// so it can never be sent as the account that arrived meanwhile.

import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const lookup = vi.hoisted(() => ({ resolve: (_venue: null) => {} }));
const createSession = vi.hoisted(() => vi.fn());
const request = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => createElement("a", { href }, children),
}));
vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => ({ user: null, session: null }) }));
vi.mock("@/components/nav/SiteNav", () => ({ default: () => null }));
vi.mock("@/components/pal/PubPalMascot", () => ({ PubPalMascot: () => null }));
vi.mock("@/components/map/useWhatsOnTonight", () => ({ useWhatsOnTonight: () => ({ rows: [] }) }));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("@/lib/palChatClient", async (original) => ({
  ...(await original<typeof import("@/lib/palChatClient")>()), createPalChatSession: createSession,
}));
vi.mock("@/lib/authedFetch", () => ({ authedActionFetch: request }));
vi.mock("@/lib/palVoiceTranscript", async (original) => ({
  ...(await original<typeof import("@/lib/palVoiceTranscript")>()), palVoiceMapIntent: () => "pub",
}));
vi.mock("@/lib/palMapAsk", async (original) => ({
  ...(await original<typeof import("@/lib/palMapAsk")>()),
  palPubAskVenue: () => new Promise((resolve) => { lookup.resolve = resolve; }),
  palMapAskTarget: () => null,
}));
vi.mock("@elevenlabs/react", () => ({
  ConversationProvider: ({ children }: { children: ReactNode }) => children,
  useConversationControls: () => ({ startSession: vi.fn(), endSession: vi.fn(), sendUserMessage: vi.fn() }),
  useConversationMode: () => ({ isListening: false, isSpeaking: false }),
  useConversationStatus: () => ({ status: "disconnected" }),
}));

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  request.mockImplementation(async () => Response.json({ thread: null }));
  createSession.mockImplementation(() => Object.assign(vi.fn(async () => null), { cancel: vi.fn() }));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  host.remove();
  vi.unstubAllGlobals();
});

it("drops a guest question whose pub lookup ends after the chat body has gone", async () => {
  const { default: PalChat } = await import("@/components/pal/PalChat");
  await act(async () => root.render(createElement(PalChat)));
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  const input = host.querySelector("input");
  expect(input).not.toBeNull();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "take me to The Lamb");
    input!.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    const form = host.querySelector("form");
    if (form) form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    else host.querySelector<HTMLButtonElement>('button[aria-label="Send message"]')!.click();
  });
  const sessionsBefore = createSession.mock.calls.length;

  await act(async () => root.unmount());
  await act(async () => { lookup.resolve(null); await new Promise((resolve) => setTimeout(resolve, 0)); });

  expect(createSession.mock.calls.length).toBe(sessionsBefore);
  expect(request.mock.calls.some(([url, init]) => url === "/api/pub-pal/chat" && init?.method === "POST")).toBe(false);
});
