// @vitest-environment jsdom

import { act, createElement, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Session } from "@supabase/supabase-js";
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
  accountRequest: vi.fn(),
  releaseFetch: vi.fn(),
}));

const analytics = vi.hoisted(() => ({
  trackEvent: vi.fn(),
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
  authedActionFetch: requests.accountRequest,
}));

vi.mock("@/lib/analytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/analytics")>()),
  trackEvent: analytics.trackEvent,
}));

import PubPalVoice from "@/components/pubpal/PubPalVoice";
import { AuthContext, useAuth } from "@/components/auth/authContext";
import { captureAccountAuth } from "@/lib/accountBoundFetch";
import { readProviderIdentityRevision, setProviderIdentity } from "@/lib/authProviderRevision";
import {
  PAL_MICROPHONE_PERMISSION_ERROR,
  PAL_VOICE_START_ERROR,
} from "@/lib/pubPalVoiceSession";

let container: HTMLDivElement;
let root: Root | null;
let getUserMedia: ReturnType<typeof vi.fn>;

const voiceSession: Session = {
  access_token: "test-voice-owner-token",
  refresh_token: "test-refresh-token",
  expires_in: 3600,
  token_type: "bearer",
  user: {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    aud: "authenticated",
    app_metadata: {},
    user_metadata: {},
    created_at: "2026-10-01T00:00:00Z",
  },
};

function AuthenticatedVoice(props: ComponentProps<typeof PubPalVoice>) {
  const defaults = useAuth();
  return createElement(AuthContext.Provider, {
    value: {
      ...defaults,
      session: voiceSession,
      user: voiceSession.user,
      configured: true,
      loading: false,
      identityResolved: true,
      providerAuthState: "authenticated",
      supabaseAuthState: "authenticated",
      accountRevision: readProviderIdentityRevision(),
      contributionAuth: captureAccountAuth(voiceSession.user.id, voiceSession),
      getCurrentUserId: () => voiceSession.user.id,
    },
  }, createElement(PubPalVoice, props));
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function mountAvailable(): Promise<void> {
  await act(async () => {
    root?.render(createElement(AuthenticatedVoice));
  });
  await settle();
  await act(async () => vi.dynamicImportSettled());
  await settle();
  expect(container.querySelector("button")?.textContent).toContain("Start voice chat");
}

function unmount(): void {
  act(() => {
    root?.unmount();
  });
  root = null;
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  voice.status = "disconnected";
  voice.isListening = false;
  voice.isSpeaking = false;
  voice.startSession.mockReset();
  voice.endSession.mockReset();
  voice.sendUserMessage.mockReset();
  requests.accountRequest.mockReset();
  // Grants keep their helper options. Real release fetches share the response
  // queue with two arguments, normalizing only the native Headers object.
  requests.releaseFetch.mockReset().mockImplementation((input: RequestInfo | URL, init: RequestInit) => (
    requests.accountRequest(input, {
      ...init,
      headers: Object.fromEntries(new Headers(init.headers).entries()),
    })
  ));
  setProviderIdentity("supabase", voiceSession.user.id);
  analytics.trackEvent.mockReset();
  requests.accountRequest.mockResolvedValue(new Response(null, { status: 204 }));

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/pub-pal/voice-token" && init?.method === "POST") {
        return requests.releaseFetch(input, init);
      }
      return new Response(JSON.stringify({ available: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
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

afterEach(async () => {
  try {
    unmount();
    await settle();
    for (const [input, init] of requests.releaseFetch.mock.calls as Array<[RequestInfo | URL, RequestInit]>) {
      expect(input).toBe("/api/pub-pal/voice-token");
      expect(init.method).toBe("POST");
      const headers = new Headers(init.headers);
      expect(headers.get("authorization")).toBe(`Bearer ${voiceSession.access_token}`);
      expect(headers.get("content-type")).toBe("application/json");
      expect([...headers.keys()].sort()).toEqual(["authorization", "content-type"]);
      expect(JSON.parse(String(init.body)).action).toBe("release");
    }
    for (const call of requests.accountRequest.mock.calls) {
      if ((call[1] as RequestInit | undefined)?.body === undefined) {
        expect(call).toEqual([
          "/api/pub-pal/voice-token",
          { method: "POST" },
          { requiresIdentity: true },
        ]);
      } else {
        expect(call).toHaveLength(2);
      }
    }
  } finally {
    container.remove();
    setProviderIdentity("supabase", null);
    vi.unstubAllGlobals();
    vi.useRealTimers();
  }
});

describe("Pub Pal voice controls", () => {
  it("keeps a typed draft while voice is disconnected and does not send it", async () => {
    await mountAvailable();
    const input = container.querySelector<HTMLInputElement>("input");
    const sendButton = container.querySelector<HTMLButtonElement>('button[aria-label="Send message"]');
    expect(input).not.toBeNull();

    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, "A quiet pub in Soho");
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      sendButton?.click();
      input?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });

    expect(input?.value).toBe("A quiet pub in Soho");
    expect(voice.sendUserMessage).not.toHaveBeenCalled();
    expect(sendButton?.disabled).toBe(true);
    expect(container.querySelector<HTMLAnchorElement>('a[href="/pal/chat"]')?.textContent ?? "").toContain("Ask in writing");
  });

  it("keeps a connected message draft after a send error and sends it on retry", async () => {
    const stopTrack = vi.fn();
    getUserMedia.mockResolvedValueOnce({ getTracks: () => [{ stop: stopTrack }] });
    requests.accountRequest.mockResolvedValueOnce(Response.json({
      signedUrl: "wss://voice.example/session",
      maxSessionSeconds: 180,
    }));
    await mountAvailable();
    await act(async () => {
      container.querySelector<HTMLButtonElement>("button")?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    const session = voice.startSession.mock.calls[0][0] as { onConnect?: () => void };
    await act(async () => session.onConnect?.());
    voice.status = "connected";
    await act(async () => root?.render(createElement(AuthenticatedVoice)));
    const input = container.querySelector<HTMLInputElement>("input");
    const sendButton = container.querySelector<HTMLButtonElement>('button[aria-label="Send message"]');

    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, "  A quiet pub in Soho  ");
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(sendButton?.disabled).toBe(false);
    voice.sendUserMessage.mockImplementationOnce(() => { throw new Error("Socket disconnected"); });

    await act(async () => sendButton?.click());

    expect(container.querySelector('[role="alert"]')?.textContent).toBe("Could not send that message. Try again.");
    expect(input?.value).toBe("  A quiet pub in Soho  ");
    expect(sendButton?.disabled).toBe(false);

    await act(async () => sendButton?.click());

    expect(voice.sendUserMessage.mock.calls).toEqual([["A quiet pub in Soho"], ["A quiet pub in Soho"]]);
    expect(input?.value).toBe("");
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(getUserMedia).toHaveBeenCalledOnce();
    expect(stopTrack).toHaveBeenCalledOnce();
    expect(voice.startSession).toHaveBeenCalledOnce();
    expect(requests.accountRequest).toHaveBeenCalledOnce();
    unmount();
    await settle();
    expect(requests.accountRequest).toHaveBeenCalledTimes(2);
    expect(requests.releaseFetch).toHaveBeenCalledOnce();
  });

  it("offers writing while muted only after the shared service is available", async () => {
    const pending = deferred<Response>();
    const availabilityFetch = vi.fn(() => pending.promise);
    vi.stubGlobal("fetch", availabilityFetch);

    await act(async () => {
      root?.render(createElement(AuthenticatedVoice, { muted: true }));
    });
    await settle();

    expect(container.querySelector('a[href="/pal/chat"]')).toBeNull();
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(voice.startSession).not.toHaveBeenCalled();

    await act(async () => pending.resolve(Response.json({ available: true })));

    expect(availabilityFetch).toHaveBeenCalledOnce();
    expect([...container.querySelectorAll("button")].some((button) => (
      button.textContent?.includes("Start voice chat")
    ))).toBe(false);
    const writingLink = container.querySelector<HTMLAnchorElement>('a[href="/pal/chat"]');
    expect(writingLink?.textContent ?? "").toContain("Ask in writing");
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(voice.startSession).not.toHaveBeenCalled();
    expect(requests.accountRequest).not.toHaveBeenCalled();
  });

  it.each(["unconfigured", "probe failure"])("offers Map Ask while muted when the shared service is %s", async (caseName) => {
    vi.stubGlobal("fetch", caseName === "unconfigured"
      ? vi.fn(async () => Response.json({ available: false }))
      : vi.fn(async () => { throw new TypeError("Network unavailable"); }));

    await act(async () => root?.render(createElement(AuthenticatedVoice, { muted: true })));
    await settle();

    expect(container.querySelector<HTMLAnchorElement>('a[href="/map"]')?.textContent ?? "").toContain("Ask on the map");
    expect(container.querySelector('a[href="/pal/chat"]')).toBeNull();
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(voice.startSession).not.toHaveBeenCalled();
    expect(requests.accountRequest).not.toHaveBeenCalled();
  });

  it("keeps a cancelled owner's availability answer out of the next Pal", async () => {
    const stale = deferred<Response>();
    const availabilityFetch = vi.fn()
      .mockReturnValueOnce(stale.promise)
      .mockResolvedValueOnce(Response.json({ available: false }));
    vi.stubGlobal("fetch", availabilityFetch);

    await act(async () => root?.render(createElement(AuthenticatedVoice, { key: "owner-a", muted: true })));
    await settle();
    expect(availabilityFetch).toHaveBeenCalledOnce();
    const previousSignal = availabilityFetch.mock.calls[0]?.[1]?.signal as AbortSignal | undefined;

    await act(async () => root?.render(createElement(AuthenticatedVoice, { key: "owner-b", muted: true })));
    await settle();
    expect(previousSignal?.aborted).toBe(true);
    expect(container.querySelector<HTMLAnchorElement>('a[href="/map"]')?.textContent ?? "").toContain("Ask on the map");

    await act(async () => stale.resolve(Response.json({ available: true })));

    expect(container.querySelector<HTMLAnchorElement>('a[href="/map"]')?.textContent ?? "").toContain("Ask on the map");
    expect(container.querySelector('a[href="/pal/chat"]')).toBeNull();
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(voice.startSession).not.toHaveBeenCalled();
  });

  it("does not issue a grant after microphone denial and unlocks Starting UI", async () => {
    const permission = deferred<MediaStream>();
    getUserMedia.mockReturnValueOnce(permission.promise);
    await mountAvailable();

    const startButton = container.querySelector<HTMLButtonElement>("button");
    expect(startButton).not.toBeNull();

    await act(async () => {
      startButton?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getUserMedia).toHaveBeenCalledOnce();
    expect(startButton?.disabled).toBe(true);
    expect(startButton?.getAttribute("aria-busy")).toBe("true");
    expect(container.querySelector(".palVoiceStatus")?.textContent).toBe(
      "Starting voice",
    );

    await act(async () => {
      permission.reject(new DOMException("Permission denied", "NotAllowedError"));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getUserMedia).toHaveBeenCalledOnce();
    expect(requests.accountRequest).not.toHaveBeenCalled();
    expect(startButton?.disabled).toBe(false);
    expect(startButton?.getAttribute("aria-busy")).not.toBe("true");
    expect(container.textContent).toContain(PAL_MICROPHONE_PERMISSION_ERROR);
    expect(container.querySelector<HTMLButtonElement>('button[aria-label="Send message"]')?.disabled).toBe(true);
    expect(container.querySelector<HTMLAnchorElement>('a[href="/pal/chat"]')?.textContent ?? "").toContain("Ask in writing");
  });

  it("offers writing when the microphone is unavailable without granting or connecting voice", async () => {
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: undefined });
    await mountAvailable();

    await act(async () => container.querySelector<HTMLButtonElement>("button")?.click());

    expect(container.querySelector('[role="alert"]')?.textContent).toBe("Microphone is unavailable. Use text instead.");
    expect(container.querySelector<HTMLButtonElement>('button[aria-label="Send message"]')?.disabled).toBe(true);
    expect(container.querySelector<HTMLAnchorElement>('a[href="/pal/chat"]')?.textContent ?? "").toContain("Ask in writing");
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(requests.accountRequest).not.toHaveBeenCalled();
    expect(voice.startSession).not.toHaveBeenCalled();
  });

  it("releases an uncertain grant request after malformed grant JSON", async () => {
    const stopTrack = vi.fn();
    getUserMedia.mockResolvedValueOnce({
      getTracks: () => [{ stop: stopTrack }],
    });
    requests.accountRequest
      .mockResolvedValueOnce(new Response("{", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }))
      .mockResolvedValue(new Response(null, { status: 204 }));

    await mountAvailable();
    const startButton = container.querySelector<HTMLButtonElement>("button");
    await act(async () => {
      startButton?.click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getUserMedia).toHaveBeenCalledOnce();
    expect(stopTrack).toHaveBeenCalledOnce();
    expect(voice.startSession).not.toHaveBeenCalled();
    expect(startButton?.disabled).toBe(false);
    expect(startButton?.getAttribute("aria-busy")).not.toBe("true");
    expect(container.textContent).toContain(PAL_VOICE_START_ERROR);
    expect(requests.accountRequest).toHaveBeenCalledTimes(2);
    expect(requests.accountRequest.mock.calls[1]).toEqual([
      "/api/pub-pal/voice-token",
      expect.objectContaining({
        method: "POST",
        headers: {
          authorization: `Bearer ${voiceSession.access_token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ action: "release", durationSeconds: 0 }),
      }),
    ]);

    unmount();
    await settle();
    expect(requests.accountRequest).toHaveBeenCalledTimes(2);
    expect(voice.endSession).not.toHaveBeenCalled();
  });

  it.each([
    [429, "VOICE_ALLOWANCE_USED", "Your trial voice allowance is used for this month."],
    [503, "UNAVAILABLE", "Voice is not configured yet."],
  ])("does not release a parsed non-ok grant response (%s)", async (status, code, error) => {
    const stopTrack = vi.fn();
    getUserMedia.mockResolvedValueOnce({
      getTracks: () => [{ stop: stopTrack }],
    });
    requests.accountRequest.mockResolvedValueOnce(new Response(JSON.stringify({
      error,
      code,
    }), {
      status,
      headers: { "Content-Type": "application/json" },
    }));

    await mountAvailable();
    const startButton = container.querySelector<HTMLButtonElement>("button");
    await act(async () => {
      startButton?.click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getUserMedia).toHaveBeenCalledOnce();
    expect(stopTrack).toHaveBeenCalledOnce();
    expect(voice.startSession).not.toHaveBeenCalled();
    expect(startButton?.disabled).toBe(false);
    expect(startButton?.getAttribute("aria-busy")).not.toBe("true");
    expect(container.textContent).toContain(error);
    expect(requests.accountRequest).toHaveBeenCalledOnce();

    unmount();
    await settle();
    expect(requests.accountRequest).toHaveBeenCalledOnce();
  });

  it("cancels pending permission on unmount and stops a late probe without grant or connect", async () => {
    const permission = deferred<MediaStream>();
    getUserMedia.mockReturnValueOnce(permission.promise);
    await mountAvailable();

    await act(async () => {
      container.querySelector<HTMLButtonElement>("button")?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(getUserMedia).toHaveBeenCalledOnce();

    const stopTrack = vi.fn();
    unmount();
    permission.resolve({ getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream);
    await settle();

    expect(stopTrack).toHaveBeenCalledOnce();
    expect(requests.accountRequest).not.toHaveBeenCalled();
    expect(voice.startSession).not.toHaveBeenCalled();
  });

  it("releases a late grant exactly once after unmount during grant request", async () => {
    const stopTrack = vi.fn();
    getUserMedia.mockResolvedValueOnce({
      getTracks: () => [{ stop: stopTrack }],
    });
    const grant = deferred<Response>();
    requests.accountRequest
      .mockReturnValueOnce(grant.promise)
      .mockResolvedValue(new Response(null, { status: 204 }));

    await mountAvailable();
    await act(async () => {
      container.querySelector<HTMLButtonElement>("button")?.click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(requests.accountRequest).toHaveBeenCalledTimes(1);
    expect(voice.startSession).not.toHaveBeenCalled();

    unmount();
    expect(requests.accountRequest).toHaveBeenCalledTimes(1);

    grant.resolve(new Response(JSON.stringify({
      signedUrl: "wss://voice.example/session",
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    await settle();

    expect(stopTrack).toHaveBeenCalledOnce();
    expect(voice.startSession).not.toHaveBeenCalled();
    expect(requests.accountRequest).toHaveBeenCalledTimes(2);
    expect(requests.accountRequest.mock.calls[1]).toEqual([
      "/api/pub-pal/voice-token",
      expect.objectContaining({
        method: "POST",
        headers: {
          authorization: `Bearer ${voiceSession.access_token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ action: "release", durationSeconds: 0 }),
      }),
    ]);

    await settle();
    expect(requests.accountRequest).toHaveBeenCalledTimes(2);
  });

  it("uses connected duration when the cap timer stops a session", async () => {
    vi.useFakeTimers();
    const stopTrack = vi.fn();
    getUserMedia.mockResolvedValueOnce({
      getTracks: () => [{ stop: stopTrack }],
    });
    requests.accountRequest
      .mockResolvedValueOnce(new Response(JSON.stringify({
        signedUrl: "wss://voice.example/session",
        maxSessionSeconds: 1,
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

    const session = voice.startSession.mock.calls[0][0] as {
      onConnect?: () => void;
      onDisconnect?: () => void;
    };
    // The SDK may report the disconnect synchronously from endSession().
    voice.endSession.mockImplementation(() => session.onDisconnect?.());
    await act(async () => {
      session.onConnect?.();
      await Promise.resolve();
    });
    await act(async () => {
      vi.advanceTimersByTime(1_000);
      await Promise.resolve();
      await Promise.resolve();
    });

    const ended = analytics.trackEvent.mock.calls.filter(([name]) => name === "voice_ended");
    expect(ended).toEqual([["voice_ended", { reason: "cap" }]]);

    expect(requests.accountRequest).toHaveBeenCalledTimes(2);
    const releaseRequest = requests.accountRequest.mock.calls[1][1] as RequestInit;
    const releaseBody = JSON.parse(String(releaseRequest.body)) as {
      action: string;
      durationSeconds: number;
    };
    expect(releaseBody).toEqual({
      action: "release",
      durationSeconds: 1,
    });
    expect(stopTrack).toHaveBeenCalledOnce();
  });

  it("ends the current session from the visible End control and releases it once", async () => {
    vi.useFakeTimers();
    const stopTrack = vi.fn();
    getUserMedia.mockResolvedValueOnce({
      getTracks: () => [{ stop: stopTrack }],
    });
    requests.accountRequest
      .mockResolvedValueOnce(new Response(JSON.stringify({
        signedUrl: "wss://voice.example/session",
        maxSessionSeconds: 10,
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

    const session = voice.startSession.mock.calls[0][0] as {
      onConnect?: () => void;
      onError?: (error: unknown) => void;
      onDisconnect?: () => void;
    };
    await act(async () => {
      session.onConnect?.();
      await Promise.resolve();
    });
    await act(async () => {
      vi.advanceTimersByTime(1_000);
    });

    voice.status = "connected";
    await act(async () => {
      root?.render(createElement(AuthenticatedVoice));
      await Promise.resolve();
      await Promise.resolve();
    });
    const endButton = container.querySelector<HTMLButtonElement>("button");
    expect(endButton?.textContent).toContain("End");

    await act(async () => {
      endButton?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(voice.endSession).toHaveBeenCalledOnce();
    expect(requests.accountRequest).toHaveBeenCalledTimes(2);
    const releaseRequest = requests.accountRequest.mock.calls[1][1] as RequestInit;
    const releaseBody = JSON.parse(String(releaseRequest.body)) as {
      action: string;
      durationSeconds: number;
    };
    expect(releaseBody.action).toBe("release");
    expect(releaseBody.durationSeconds).toBeGreaterThan(0);

    await act(async () => {
      session.onError?.(new Error("late socket failure"));
      session.onDisconnect?.();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(voice.endSession).toHaveBeenCalledOnce();
    expect(requests.accountRequest).toHaveBeenCalledTimes(2);
    expect(stopTrack).toHaveBeenCalledOnce();
    const ended = analytics.trackEvent.mock.calls.filter(([name]) => name === "voice_ended");
    expect(ended).toEqual([["voice_ended", { reason: "user" }]]);
  });

  it("ignores stale callbacks from attempt A while attempt B owns its grant", async () => {
    vi.useFakeTimers();
    const stopTrackA = vi.fn();
    const stopTrackB = vi.fn();
    getUserMedia
      .mockResolvedValueOnce({ getTracks: () => [{ stop: stopTrackA }] })
      .mockResolvedValueOnce({ getTracks: () => [{ stop: stopTrackB }] });
    requests.accountRequest
      .mockResolvedValueOnce(new Response(JSON.stringify({
        signedUrl: "wss://voice.example/session-a",
        maxSessionSeconds: 10,
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        signedUrl: "wss://voice.example/session-b",
        maxSessionSeconds: 1,
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
    const sessionA = voice.startSession.mock.calls[0][0] as {
      onConnect?: () => void;
      onError?: (error: unknown) => void;
      onDisconnect?: () => void;
    };
    await act(async () => {
      sessionA.onConnect?.();
      sessionA.onError?.(new Error("attempt A failed"));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(requests.accountRequest).toHaveBeenCalledTimes(2);

    await act(async () => {
      container.querySelector<HTMLButtonElement>("button")?.click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    const sessionB = voice.startSession.mock.calls[1][0] as {
      onConnect?: () => void;
    };
    await act(async () => {
      sessionB.onConnect?.();
      await Promise.resolve();
    });
    expect(requests.accountRequest).toHaveBeenCalledTimes(3);

    await act(async () => {
      sessionA.onDisconnect?.();
      sessionA.onError?.(new Error("late attempt A callback"));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(requests.accountRequest).toHaveBeenCalledTimes(3);

    await act(async () => {
      vi.advanceTimersByTime(1_000);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(requests.accountRequest).toHaveBeenCalledTimes(4);
    const releaseRequest = requests.accountRequest.mock.calls[3][1] as RequestInit;
    expect(JSON.parse(String(releaseRequest.body))).toEqual({
      action: "release",
      durationSeconds: 1,
    });
    expect(stopTrackA).toHaveBeenCalledOnce();
    expect(stopTrackB).toHaveBeenCalledOnce();
  });

  it("releases one granted session when the SDK reports an error", async () => {
    vi.useFakeTimers();
    const stopTrack = vi.fn();
    getUserMedia.mockResolvedValueOnce({
      getTracks: () => [{ stop: stopTrack }],
    });
    requests.accountRequest
      .mockResolvedValueOnce(new Response(JSON.stringify({
        signedUrl: "wss://voice.example/session",
        maxSessionSeconds: 1,
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
    expect(requests.accountRequest).toHaveBeenCalledTimes(1);
    expect(voice.startSession).toHaveBeenCalledOnce();

    const session = voice.startSession.mock.calls[0][0] as {
      onConnect?: () => void;
      onError?: (error: unknown) => void;
      onDisconnect?: () => void;
    };
    await act(async () => {
      session.onConnect?.();
      await Promise.resolve();
    });
    expect(vi.getTimerCount()).toBe(1);

    await act(async () => {
      session.onError?.(new Error("socket failed"));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(voice.endSession).toHaveBeenCalledOnce();
    expect(requests.accountRequest).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
    expect(requests.accountRequest.mock.calls[1]).toEqual([
      "/api/pub-pal/voice-token",
      expect.objectContaining({
        method: "POST",
        headers: {
          authorization: `Bearer ${voiceSession.access_token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ action: "release", durationSeconds: 0 }),
      }),
    ]);

    await act(async () => {
      vi.advanceTimersByTime(1_000);
      session.onDisconnect?.();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(voice.endSession).toHaveBeenCalledOnce();
    expect(requests.accountRequest).toHaveBeenCalledTimes(2);
    const ended = analytics.trackEvent.mock.calls.filter(([name]) => name === "voice_ended");
    expect(ended).toEqual([["voice_ended", { reason: "error" }]]);
  });

  it("cleans up an issued grant on unmount and ignores late SDK callbacks", async () => {
    vi.useFakeTimers();
    const stopTrack = vi.fn();
    getUserMedia.mockResolvedValueOnce({
      getTracks: () => [{ stop: stopTrack }],
    });
    requests.accountRequest
      .mockResolvedValueOnce(new Response(JSON.stringify({
        signedUrl: "wss://voice.example/session",
        maxSessionSeconds: 1,
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

    expect(voice.startSession).toHaveBeenCalledOnce();
    const session = voice.startSession.mock.calls[0][0] as {
      onConnect?: () => void;
      onError?: (error: unknown) => void;
      onDisconnect?: () => void;
    };
    // The SDK may report the disconnect synchronously from endSession().
    voice.endSession.mockImplementation(() => session.onDisconnect?.());
    await act(async () => {
      session.onConnect?.();
      await Promise.resolve();
    });

    unmount();
    await settle();
    const ended = analytics.trackEvent.mock.calls.filter(([name]) => name === "voice_ended");
    expect(ended).toEqual([["voice_ended", { reason: "user" }]]);
    expect(voice.endSession).toHaveBeenCalledOnce();
    expect(requests.accountRequest).toHaveBeenCalledTimes(2);

    await act(async () => {
      vi.advanceTimersByTime(1_001);
      session.onError?.(new Error("late socket failure"));
      session.onDisconnect?.();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(voice.endSession).toHaveBeenCalledOnce();
    expect(requests.accountRequest).toHaveBeenCalledTimes(2);
    expect(stopTrack).toHaveBeenCalledOnce();
  });
});
