// @vitest-environment jsdom

import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Conversation } from "@elevenlabs/client";

type FakeSessionOptions = {
  onConversationCreated?: (conversation: FakeConversation) => void;
  onConnect?: (event: { conversationId: string }) => void;
  onDisconnect?: (event: { reason: string }) => void;
  onStatusChange?: (event: { status: string }) => void;
};

type FakeConversation = {
  getId: () => string;
  endSession: ReturnType<typeof vi.fn<() => Promise<void>>>;
  setMicMuted: ReturnType<typeof vi.fn>;
  sendUserMessage: ReturnType<typeof vi.fn>;
};

const client = vi.hoisted(() => ({
  startSession: vi.fn<(options: FakeSessionOptions) => Promise<FakeConversation>>(),
}));
const requests = vi.hoisted(() => ({ authedActionFetch: vi.fn() }));
const navigation = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) =>
    createElement("a", { href }, children),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: navigation.push }) }));
vi.mock("@/lib/authedFetch", () => ({ authedActionFetch: requests.authedActionFetch }));
vi.mock("@/lib/analytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/analytics")>()),
  trackEvent: vi.fn(),
}));

import PubPalVoiceSession from "@/components/pubpal/PubPalVoiceSession";
import { defined } from "@/__tests__/helpers/defined";
import { PAL_VOICE_START_TIMEOUT_ERROR, PAL_VOICE_START_TIMEOUT_MS } from "@/lib/pubPalVoiceSession";

let container: HTMLDivElement;
let root: Root | null;
let issuedGrants: number;
let releasedIds: string[];
let rejectPendingStartup: ((reason: unknown) => void) | null;
let fetchMock: ReturnType<typeof vi.fn>;
let getUserMedia: ReturnType<typeof vi.fn>;

function fakeConversation(options: FakeSessionOptions, id: string): FakeConversation {
  return {
    getId: () => id,
    setMicMuted: vi.fn(),
    sendUserMessage: vi.fn(),
    endSession: vi.fn(async () => {
      options.onStatusChange?.({ status: "disconnected" });
      options.onDisconnect?.({ reason: "user" });
    }),
  };
}

function connectFake(options: FakeSessionOptions, id: string): FakeConversation {
  const conversation = fakeConversation(options, id);
  options.onConversationCreated?.(conversation);
  options.onStatusChange?.({ status: "connected" });
  options.onConnect?.({ conversationId: id });
  return conversation;
}

async function settle(): Promise<void> {
  await act(async () => {
    for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();
  });
}

function buttonContaining(text: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
    .find((candidate) => candidate.textContent?.includes(text));
  expect(button).toBeDefined();
  return defined(button);
}

async function click(text: string): Promise<void> {
  await act(async () => { buttonContaining(text).click(); });
  await settle();
}

async function writeDraft(text: string): Promise<void> {
  const input = defined(container.querySelector<HTMLInputElement>("input"));
  await act(async () => {
    const setter = defined(Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set);
    setter.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  issuedGrants = 0;
  releasedIds = [];
  rejectPendingStartup = null;
  client.startSession.mockReset();
  // Spy on the installed client's shared class. Externalized SDK imports do
  // not see Vitest module mocks, but they use this same static method.
  vi.spyOn(Conversation, "startSession").mockImplementation((options) => (
    client.startSession(options as FakeSessionOptions) as unknown as ReturnType<typeof Conversation.startSession>
  ));
  requests.authedActionFetch.mockReset();
  navigation.push.mockReset();
  fetchMock = vi.fn(async () => { throw new Error("Unexpected real network request"); });
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("WebSocket", class {
    constructor() { throw new Error("Unexpected provider socket"); }
  });
  vi.stubGlobal("AudioContext", class {
    constructor() { throw new Error("Unexpected audio context"); }
  });
  getUserMedia = vi.fn(async () => ({ getTracks: () => [{ stop: vi.fn() }] }));
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia },
  });
  requests.authedActionFetch.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url !== "/api/pub-pal/voice-token") return new Response(null, { status: 204 });
    const body = typeof init?.body === "string" ? JSON.parse(init.body) as {
      action?: string;
      conversationId?: string;
    } : {};
    if (body.action === "release") {
      releasedIds.push(body.conversationId ?? "");
      return new Response(null, { status: 204 });
    }
    issuedGrants += 1;
    return Response.json({
      signedUrl: `wss://provider.invalid/session/${issuedGrants}`,
      conversationId: `conv_sdkfixture0${issuedGrants}`,
      maxSessionSeconds: 60,
    });
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
    root = null;
    rejectPendingStartup?.(new DOMException("Fixture startup stopped", "NotAllowedError"));
    for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();
  });
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Pub Pal startup with the installed React SDK", () => {
  it("retries a connected session while its old teardown finishes and preserves the draft", async () => {
    let finishOldEnd: (() => void) | undefined;
    const oldEnd = new Promise<void>((resolve) => { finishOldEnd = resolve; });
    client.startSession
      .mockImplementationOnce(async (options) => {
        const conversation = connectFake(options, "conv_sdkfixture01");
        conversation.endSession.mockImplementation(async () => {
          options.onStatusChange?.({ status: "disconnecting" });
          await oldEnd;
          options.onStatusChange?.({ status: "disconnected" });
          options.onDisconnect?.({ reason: "user" });
        });
        return conversation;
      })
      .mockImplementationOnce(async (options) => connectFake(options, "conv_sdkfixture02"));
    await act(async () => { root?.render(createElement(PubPalVoiceSession)); });
    await click("Start voice chat");
    await writeDraft("Find a quiet pub");
    await click("End");
    expect(releasedIds).toEqual(["conv_sdkfixture01"]);
    await click("Start voice chat");
    expect(client.startSession).toHaveBeenCalledTimes(2);

    await act(async () => { defined(finishOldEnd)(); });
    await settle();

    expect(container.textContent).toContain("Pal is listening");
    expect(container.querySelector<HTMLInputElement>("input")?.value).toBe("Find a quiet pub");
    expect(releasedIds).toEqual(["conv_sdkfixture01"]);
    await click("End");
    expect(releasedIds).toEqual(["conv_sdkfixture01", "conv_sdkfixture02"]);
    expect(issuedGrants).toBe(2);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("connects through the real provider while keeping client transport and audio fake", async () => {
    client.startSession.mockImplementation(async (options) => connectFake(options, "conv_sdkfixture01"));
    await act(async () => { root?.render(createElement(PubPalVoiceSession)); });

    await click("Start voice chat");

    expect(client.startSession).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("Pal is listening");
    expect(issuedGrants).toBe(1);
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
    await click("End");
    expect(releasedIds).toEqual(["conv_sdkfixture01"]);
  });

  it("starts a real SDK retry after cancelling an unresolved client startup", async () => {
    client.startSession
      .mockImplementationOnce((options) => {
        options.onStatusChange?.({ status: "connecting" });
        return new Promise<FakeConversation>((_resolve, reject) => {
          rejectPendingStartup = reject;
        });
      })
      .mockImplementationOnce(async (options) => connectFake(options, "conv_sdkfixture02"));
    await act(async () => { root?.render(createElement(PubPalVoiceSession)); });
    await writeDraft("Wine at The Lamb");
    await click("Start voice chat");
    expect(client.startSession).toHaveBeenCalledTimes(1);
    const writingLink = defined(container.querySelector<HTMLAnchorElement>("a"));
    expect(new URL(writingLink.getAttribute("href") ?? "", "http://localhost").searchParams.get("ask"))
      .toBe("Wine at The Lamb");

    await click("Cancel");
    expect(releasedIds).toEqual(["conv_sdkfixture01"]);
    expect(container.querySelector<HTMLInputElement>("input")?.value).toBe("Wine at The Lamb");
    await click("Start voice chat");

    expect(client.startSession).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("Pal is listening");
    expect(issuedGrants).toBe(2);
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("replaces a timed-out SDK provider while preserving the writing draft and error", async () => {
    vi.useFakeTimers();
    client.startSession
      .mockImplementationOnce((options) => {
        options.onStatusChange?.({ status: "connecting" });
        return new Promise<FakeConversation>((_resolve, reject) => {
          rejectPendingStartup = reject;
        });
      })
      .mockImplementationOnce(async (options) => connectFake(options, "conv_sdkfixture02"));
    await act(async () => { root?.render(createElement(PubPalVoiceSession)); });
    await writeDraft("Find a quiet pub");
    await click("Start voice chat");

    await act(async () => { await vi.advanceTimersByTimeAsync(PAL_VOICE_START_TIMEOUT_MS); });
    await settle();

    expect(container.querySelector('[role="alert"]')?.textContent).toBe(PAL_VOICE_START_TIMEOUT_ERROR);
    expect(container.querySelector<HTMLInputElement>("input")?.value).toBe("Find a quiet pub");
    const writingLink = defined(container.querySelector<HTMLAnchorElement>("a"));
    expect(new URL(writingLink.getAttribute("href") ?? "", "http://localhost").searchParams.get("ask"))
      .toBe("Find a quiet pub");
    expect(releasedIds).toEqual(["conv_sdkfixture01"]);
    await click("Start voice chat");
    expect(client.startSession).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("Pal is listening");
    expect(issuedGrants).toBe(2);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps the retry connected when the cancelled SDK startup resolves late", async () => {
    let resolveOld: ((conversation: FakeConversation) => void) | undefined;
    let oldOptions: FakeSessionOptions | undefined;
    client.startSession
      .mockImplementationOnce((options) => {
        oldOptions = options;
        options.onStatusChange?.({ status: "connecting" });
        return new Promise<FakeConversation>((resolve, reject) => {
          resolveOld = resolve;
          rejectPendingStartup = reject;
        });
      })
      .mockImplementationOnce(async (options) => connectFake(options, "conv_sdkfixture02"));
    await act(async () => { root?.render(createElement(PubPalVoiceSession)); });
    await click("Start voice chat");
    await click("Cancel");
    await click("Start voice chat");
    expect(client.startSession).toHaveBeenCalledTimes(2);

    const old = fakeConversation(defined(oldOptions), "conv_sdkfixture01");
    await act(async () => {
      const options = defined(oldOptions);
      options.onConversationCreated?.(old);
      options.onStatusChange?.({ status: "connected" });
      options.onConnect?.({ conversationId: "conv_sdkfixture01" });
      defined(resolveOld)(old);
    });
    await settle();

    expect(old.endSession).toHaveBeenCalled();
    expect(container.textContent).toContain("Pal is listening");
    expect(releasedIds).toEqual(["conv_sdkfixture01"]);
    await click("End");
    expect(releasedIds).toEqual(["conv_sdkfixture01", "conv_sdkfixture02"]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
