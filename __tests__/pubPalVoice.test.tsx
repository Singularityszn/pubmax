// @vitest-environment jsdom

import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const voice = vi.hoisted(() => ({
  status: "disconnected" as string,
  isListening: false,
  isSpeaking: false,
  startSession: vi.fn(),
  endSession: vi.fn(),
  sendUserMessage: vi.fn(),
}));

const requests = vi.hoisted(() => ({
  authedActionFetch: vi.fn(),
}));

vi.mock("@elevenlabs/react", () => ({
  ConversationProvider: ({ children }: { children: ReactNode }) => children,
  useConversationControls: () => ({
    startSession: voice.startSession,
    endSession: voice.endSession,
    sendUserMessage: voice.sendUserMessage,
  }),
  useConversationMode: () => ({
    isListening: voice.isListening,
    isSpeaking: voice.isSpeaking,
  }),
  useConversationStatus: () => ({ status: voice.status }),
}));

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) =>
    createElement("a", { href }, children),
}));

vi.mock("@/lib/authedFetch", () => ({
  authedActionFetch: requests.authedActionFetch,
}));

import PubPalVoice from "@/components/pubpal/PubPalVoice";
import { PAL_MICROPHONE_PERMISSION_ERROR } from "@/lib/pubPalVoiceSession";

let container: HTMLDivElement;
let root: Root;
let getUserMedia: ReturnType<typeof vi.fn>;

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function mountAvailable(): Promise<void> {
  await act(async () => {
    root.render(createElement(PubPalVoice));
  });
  await settle();
  expect(container.querySelector("button")?.textContent).toContain("Start voice chat");
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  voice.status = "disconnected";
  voice.isListening = false;
  voice.isSpeaking = false;
  voice.startSession.mockReset();
  voice.endSession.mockReset();
  voice.sendUserMessage.mockReset();
  requests.authedActionFetch.mockReset();
  requests.authedActionFetch.mockResolvedValue(new Response(null, { status: 204 }));

  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ available: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })),
  );
  getUserMedia = vi.fn();
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia },
  });

  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("Pub Pal voice controls", () => {
  it("does not issue a grant after microphone denial and unlocks Starting UI", async () => {
    getUserMedia.mockRejectedValueOnce(
      new DOMException("Permission denied", "NotAllowedError"),
    );
    await mountAvailable();

    const startButton = container.querySelector<HTMLButtonElement>("button");
    expect(startButton).not.toBeNull();

    await act(async () => {
      startButton?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getUserMedia).toHaveBeenCalledOnce();
    expect(requests.authedActionFetch).not.toHaveBeenCalled();
    expect(startButton?.disabled).toBe(false);
    expect(startButton?.getAttribute("aria-busy")).not.toBe("true");
    expect(container.textContent).toContain(PAL_MICROPHONE_PERMISSION_ERROR);
  });

  it("releases one granted session when the SDK reports an error", async () => {
    const stopTrack = vi.fn();
    getUserMedia.mockResolvedValueOnce({
      getTracks: () => [{ stop: stopTrack }],
    });
    requests.authedActionFetch
      .mockResolvedValueOnce(new Response(JSON.stringify({
        signedUrl: "wss://voice.example/session",
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }))
      .mockResolvedValue(new Response(null, { status: 204 }));

    await mountAvailable();
    await act(async () => {
      container.querySelector<HTMLButtonElement>("button")?.click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getUserMedia).toHaveBeenCalledOnce();
    expect(stopTrack).toHaveBeenCalledOnce();
    expect(requests.authedActionFetch).toHaveBeenCalledTimes(1);
    expect(voice.startSession).toHaveBeenCalledOnce();

    const session = voice.startSession.mock.calls[0][0] as {
      onError?: (error: unknown) => void;
      onDisconnect?: () => void;
    };
    await act(async () => {
      session.onError?.(new Error("socket failed"));
      session.onDisconnect?.();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(requests.authedActionFetch).toHaveBeenCalledTimes(2);
    expect(requests.authedActionFetch.mock.calls[1]).toEqual([
      "/api/pub-pal/voice-token",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ action: "release", durationSeconds: 0 }),
      }),
    ]);
  });
});
