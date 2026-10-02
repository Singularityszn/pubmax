// @vitest-environment jsdom

import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Session } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({
  status: "disconnected" as string,
  startSession: vi.fn(),
  endSession: vi.fn(),
  sendUserMessage: vi.fn(),
}));
const browserAuth = vi.hoisted(() => ({
  session: null as Session | null,
  getAccessToken: vi.fn<() => Promise<string | null>>(),
}));

vi.mock("@elevenlabs/react", () => ({
  ConversationProvider: ({ children }: { children: ReactNode }) => children,
  useConversationControls: () => ({
    startSession: sdk.startSession,
    endSession: sdk.endSession,
    sendUserMessage: sdk.sendUserMessage,
  }),
  useConversationMode: () => ({ isListening: false, isSpeaking: false }),
  useConversationStatus: () => ({ status: sdk.status }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) =>
    createElement("a", { href }, children),
}));
vi.mock("@/lib/authClient", () => ({
  getAccessToken: browserAuth.getAccessToken,
  ensureSupabaseBrowser: async () => ({
    auth: { getSession: async () => ({ data: { session: browserAuth.session } }) },
  }),
}));
vi.mock("@/components/auth/AuthProvider", async () => ({
  useAuth: (await import("@/components/auth/authContext")).useAuth,
}));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));

import { AuthContext, type AuthContextValue } from "@/components/auth/authContext";
import PubPalVoiceSession from "@/components/pubpal/PubPalVoiceSession";
import { captureAccountAuth } from "@/lib/accountBoundFetch";
import { publishAuthActionState } from "@/lib/authedFetch";
import {
  readProviderIdentityRevision,
  readProviderAccountSignal,
  setProviderIdentity,
} from "@/lib/authProviderRevision";
import { NO_SOCIAL_AUTH_PROVIDERS } from "@/lib/authProviderAvailability";

type SessionCallbacks = {
  onConnect: (meta: { conversationId: string }) => void;
  onMessage: (turn: { role: string; message: string }) => void;
  onDisconnect: () => void;
  onError: (message: string) => void;
};
type WireRequest = {
  url: string;
  method: string;
  authorization: string | null;
  contentType: string | null;
  body: Record<string, unknown> | null;
};

const OWNER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OWNER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TOKEN_A = "test-owner-a-token";
const TOKEN_B = "test-owner-b-token";
let host: HTMLDivElement;
let root: Root | null;
let wire: WireRequest[];
let stopProbe: ReturnType<typeof vi.fn>;

function sessionFor(ownerId: string, accessToken: string): Session {
  return {
    access_token: accessToken,
    refresh_token: "test-refresh-token",
    expires_in: 3600,
    token_type: "bearer",
    user: {
      id: ownerId,
      aud: "authenticated",
      app_metadata: {},
      user_metadata: {},
      created_at: "2026-10-01T00:00:00Z",
    },
  };
}

function setAccount(ownerId: string, accessToken: string): void {
  browserAuth.session = sessionFor(ownerId, accessToken);
  setProviderIdentity("supabase", ownerId);
  publishAuthActionState({ status: "signed-in", identityResolved: true });
}

function authValue(): AuthContextValue {
  const session = browserAuth.session;
  return {
    session,
    user: session?.user ?? null,
    loading: false,
    configured: true,
    clerkIntegrationConfigured: false,
    socialProviders: NO_SOCIAL_AUTH_PROVIDERS,
    signInWithGoogle: async () => ({ error: null }),
    signInWithApple: async () => ({ error: null }),
    signInWithMicrosoft: async () => ({ error: null }),
    signInWithEmail: async () => ({ status: "sent", message: "Test email sent." }),
    cancelAuthAttempt: () => {},
    signOut: async () => {},
    switchAccount: async () => ({ status: "unavailable" }),
    welcomeBack: null,
    resumeSignIn: async () => ({ status: "sent", message: "Test email sent." }),
    handle: null,
    identityResolved: true,
    accountRevision: readProviderIdentityRevision(),
    providerAuthState: session ? "authenticated" : "signed-out",
    supabaseAuthState: session ? "authenticated" : "signed-out",
    rejectedContributionAuth: null,
    contributionAuth: captureAccountAuth(session?.user.id ?? null, session),
    invalidateContributionAuth: () => {},
    getCurrentUserId: () => browserAuth.session?.user.id ?? null,
  };
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function renderSession(key = "owner-a"): Promise<void> {
  await act(async () => root?.render(createElement(
    AuthContext.Provider,
    { value: authValue() },
    createElement(PubPalVoiceSession, { key }),
  )));
}

async function startSession(): Promise<SessionCallbacks> {
  const count = sdk.startSession.mock.calls.length;
  const button = Array.from(host.querySelectorAll("button"))
    .find((item) => item.textContent?.includes("Start voice chat"));
  expect(button).toBeDefined();
  await act(async () => button?.click());
  await settle();
  expect(sdk.startSession).toHaveBeenCalledTimes(count + 1);
  return sdk.startSession.mock.calls[count][0] as SessionCallbacks;
}

async function connect(callbacks: SessionCallbacks, conversationId: string): Promise<void> {
  sdk.status = "connected";
  await act(async () => callbacks.onConnect({ conversationId }));
  await renderSession(browserAuth.session?.user.id === OWNER_B ? "owner-b" : "owner-a");
  await settle();
}

function toolTurns(): WireRequest[] {
  return wire.filter((request) => request.url === "/api/pub-pal/tool-turn");
}

function releases(): WireRequest[] {
  return wire.filter((request) => request.body?.action === "release");
}

function expectedTurn(
  token: string,
  conversationId: string,
  threadTurn?: { role: "user" | "assistant"; content: string },
): WireRequest {
  return {
    url: "/api/pub-pal/tool-turn",
    method: "POST",
    authorization: `Bearer ${token}`,
    contentType: "application/json",
    body: { conversationId, cityId: "london", ...(threadTurn ? { threadTurn } : {}) },
  };
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  sdk.status = "disconnected";
  sdk.startSession.mockReset();
  sdk.endSession.mockReset().mockResolvedValue(undefined);
  sdk.sendUserMessage.mockReset();
  browserAuth.getAccessToken.mockReset().mockImplementation(async () =>
    browserAuth.session?.access_token ?? null);
  wire = [];
  setAccount(OWNER_A, TOKEN_A);
  stopProbe = vi.fn();
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: stopProbe }] })) },
  });
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    const request: WireRequest = {
      url: String(input),
      method: init?.method ?? "GET",
      authorization: headers.get("authorization"),
      contentType: headers.get("content-type"),
      body: init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null,
    };
    wire.push(request);
    if (request.url === "/api/pub-pal/tool-turn") return Response.json({ ok: true });
    if (request.url === "/api/pub-pal/voice-token") {
      if (request.body?.action === "release") return Response.json({ released: true });
      return Response.json({ signedUrl: "wss://voice.example/test-session", maxSessionSeconds: 180 });
    }
    throw new Error(`Unexpected voice request: ${request.url}`);
  }));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  await settle();
  host.remove();
  browserAuth.session = null;
  setProviderIdentity("supabase", null);
  publishAuthActionState({ status: "signed-out", identityResolved: true });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Pub Pal voice request ownership", () => {
  it("syncs the current owner's connected conversation and normalized turns", async () => {
    await renderSession();
    const callbacks = await startSession();
    await connect(callbacks, "conversation-a");
    await act(async () => {
      callbacks.onMessage({ role: "user", message: "  A quiet pub in Soho  " });
      callbacks.onMessage({ role: "agent", message: "  Let us check the listed options.  " });
      callbacks.onMessage({ role: "user", message: "   " });
      callbacks.onMessage({ role: "system", message: "Unsupported provider role" });
    });
    await settle();

    expect(wire[0]).toEqual({
      url: "/api/pub-pal/voice-token", method: "POST", authorization: `Bearer ${TOKEN_A}`,
      contentType: null, body: null,
    });
    expect(toolTurns()).toEqual([
      expectedTurn(TOKEN_A, "conversation-a"),
      expectedTurn(TOKEN_A, "conversation-a", { role: "user", content: "A quiet pub in Soho" }),
      expectedTurn(TOKEN_A, "conversation-a", { role: "assistant", content: "Let us check the listed options." }),
    ]);
    expect(stopProbe).toHaveBeenCalledOnce();
  });

  it("releases one connected current-owner reservation with its measured duration", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    await renderSession();
    const callbacks = await startSession();
    await connect(callbacks, "conversation-a");
    now.mockReturnValue(1_012_000);
    await act(async () => host.querySelector<HTMLButtonElement>("button")?.click());
    await settle();
    await act(async () => callbacks.onDisconnect());
    await settle();

    expect(releases()).toEqual([{
      url: "/api/pub-pal/voice-token", method: "POST", authorization: `Bearer ${TOKEN_A}`,
      contentType: "application/json", body: { action: "release", durationSeconds: 12 },
    }]);
    expect(sdk.endSession).toHaveBeenCalledOnce();
  });

  it("does not sync a retired owner's late transcript under the next account", async () => {
    // SDK teardown can still be pending after provider unmount. Its old start
    // id remains current, unlike a superseded start within one SDK provider.
    sdk.endSession.mockReturnValue(new Promise<void>(() => {}));
    await renderSession();
    const oldCallbacks = await startSession();
    await connect(oldCallbacks, "conversation-a");
    const oldSignal = readProviderAccountSignal();
    setAccount(OWNER_B, TOKEN_B);
    expect(oldSignal.aborted).toBe(true);
    sdk.status = "disconnected";
    await renderSession("owner-b");
    const currentCallbacks = await startSession();
    await connect(currentCallbacks, "conversation-b");
    await act(async () => currentCallbacks.onMessage({ role: "user", message: "B's own request" }));
    await settle();
    const beforeLateCallback = toolTurns();
    expect(beforeLateCallback).toEqual([
      expectedTurn(TOKEN_A, "conversation-a"),
      expectedTurn(TOKEN_B, "conversation-b"),
      expectedTurn(TOKEN_B, "conversation-b", { role: "user", content: "B's own request" }),
    ]);

    await act(async () => oldCallbacks.onMessage({ role: "user", message: "A's retired transcript" }));
    await settle();

    expect(toolTurns()).toEqual(beforeLateCallback);
  });

  it("releases the granted owner's reservation after the active account changes", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    await renderSession();
    const callbacks = await startSession();
    await connect(callbacks, "conversation-a");
    now.mockReturnValue(1_012_000);
    setAccount(OWNER_B, TOKEN_B);
    sdk.status = "disconnected";
    await renderSession("owner-b");
    await settle();

    expect(releases()).toEqual([{
      url: "/api/pub-pal/voice-token", method: "POST", authorization: `Bearer ${TOKEN_A}`,
      contentType: "application/json", body: { action: "release", durationSeconds: 12 },
    }]);
    expect(sdk.endSession).toHaveBeenCalledOnce();
  });

  it("rejects a held grant token lookup from the retired account before transport", async () => {
    let resolveToken!: (token: string) => void;
    browserAuth.getAccessToken.mockReturnValueOnce(new Promise<string>((resolve) => {
      resolveToken = resolve;
    }));
    await renderSession();
    await act(async () => host.querySelector<HTMLButtonElement>("button")?.click());
    await settle();
    expect(browserAuth.getAccessToken).toHaveBeenCalledOnce();
    expect(wire).toEqual([]);
    setAccount(OWNER_B, TOKEN_B);
    await renderSession("owner-b");
    await act(async () => resolveToken(TOKEN_A));
    await settle();

    expect(wire).toEqual([]);
    expect(sdk.startSession).not.toHaveBeenCalled();
    expect(stopProbe).toHaveBeenCalledOnce();
  });
});

describe("voice consumer resilience to superseded SDK callbacks", () => {
  // The installed SDK suppresses these callbacks on same-provider restart.
  // This double tests the consumer's own boundary, not natural SDK delivery.
  it.each(["connect", "message", "disconnect"] as const)(
    "keeps the restarted conversation after an old %s callback",
    async (callback) => {
      await renderSession();
      const retired = await startSession();
      await connect(retired, "conversation-retired");
      sdk.status = "disconnected";
      await act(async () => retired.onError("Old connection ended"));
      await renderSession();
      const current = await startSession();
      await connect(current, "conversation-current");
      const beforeLateCallback = toolTurns();
      expect(beforeLateCallback).toEqual([
        expectedTurn(TOKEN_A, "conversation-retired"),
        expectedTurn(TOKEN_A, "conversation-current"),
      ]);

      await act(async () => {
        if (callback === "connect") retired.onConnect({ conversationId: "conversation-retired-late" });
        if (callback === "message") retired.onMessage({ role: "user", message: "Retired request" });
        if (callback === "disconnect") retired.onDisconnect();
      });
      await settle();
      await act(async () => current.onMessage({ role: "user", message: "Current request" }));
      await settle();

      expect(toolTurns()).toEqual([
        ...beforeLateCallback,
        expectedTurn(TOKEN_A, "conversation-current", { role: "user", content: "Current request" }),
      ]);
    },
  );
});

describe("voice ownership without caller remounts", () => {
  const stableKey = "unchanged-caller";

  async function connectInPlace(callbacks: SessionCallbacks, conversationId: string): Promise<void> {
    sdk.status = "connected";
    await act(async () => callbacks.onConnect({ conversationId }));
    await renderSession(stableKey);
    await settle();
  }

  it("ends A once and keeps B's new conversation after an in-place account switch", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    await renderSession(stableKey);
    const retired = await startSession();
    await connectInPlace(retired, "conversation-a");
    const oldSignal = readProviderAccountSignal();
    now.mockReturnValue(1_012_000);
    setAccount(OWNER_B, TOKEN_B);
    expect(oldSignal.aborted).toBe(true);
    sdk.status = "disconnected";
    await renderSession(stableKey);
    await settle();
    const endCallsAtSwitch = sdk.endSession.mock.calls.length;
    const releasesAtSwitch = releases();

    const current = await startSession();
    await connectInPlace(current, "conversation-b");
    const beforeRetiredCallbacks = [...wire];
    await act(async () => {
      retired.onConnect({ conversationId: "conversation-a-late" });
      retired.onMessage({ role: "user", message: "A's retired transcript" });
      retired.onDisconnect();
      retired.onError("Retired connection ended");
    });
    await settle();
    expect(wire).toEqual(beforeRetiredCallbacks);
    await act(async () => current.onMessage({ role: "user", message: "B's own request" }));
    await settle();

    expect(toolTurns()).toEqual([
      expectedTurn(TOKEN_A, "conversation-a"),
      expectedTurn(TOKEN_B, "conversation-b"),
      expectedTurn(TOKEN_B, "conversation-b", { role: "user", content: "B's own request" }),
    ]);
    expect(endCallsAtSwitch).toBe(1);
    expect(sdk.endSession).toHaveBeenCalledOnce();
    expect(releasesAtSwitch).toEqual([{
      url: "/api/pub-pal/voice-token", method: "POST", authorization: `Bearer ${TOKEN_A}`,
      contentType: "application/json", body: { action: "release", durationSeconds: 12 },
    }]);
    expect(releases()).toEqual(releasesAtSwitch);
    expect(sdk.startSession).toHaveBeenCalledTimes(2);
  });

  it("ends A once and releases only A when the same caller signs out", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    await renderSession(stableKey);
    const retired = await startSession();
    await connectInPlace(retired, "conversation-a");
    const oldSignal = readProviderAccountSignal();
    now.mockReturnValue(1_012_000);
    browserAuth.session = null;
    setProviderIdentity("supabase", null);
    publishAuthActionState({ status: "signed-out", identityResolved: true });
    expect(oldSignal.aborted).toBe(true);
    sdk.status = "disconnected";
    await renderSession(stableKey);
    await settle();
    const beforeRetiredCallbacks = [...wire];
    await act(async () => {
      retired.onConnect({ conversationId: "conversation-a-late" });
      retired.onMessage({ role: "user", message: "A's retired transcript" });
      retired.onDisconnect();
      retired.onError("Retired connection ended");
    });
    await settle();

    expect(wire).toEqual(beforeRetiredCallbacks);
    expect(toolTurns()).toEqual([expectedTurn(TOKEN_A, "conversation-a")]);
    expect(releases()).toEqual([{
      url: "/api/pub-pal/voice-token", method: "POST", authorization: `Bearer ${TOKEN_A}`,
      contentType: "application/json", body: { action: "release", durationSeconds: 12 },
    }]);
    expect(sdk.endSession).toHaveBeenCalledOnce();
    expect(sdk.startSession).toHaveBeenCalledOnce();
  });

  it("keeps the connected session during a same-owner token refresh", async () => {
    await renderSession(stableKey);
    const current = await startSession();
    await connectInPlace(current, "conversation-a");
    const accountSignal = readProviderAccountSignal();
    const refreshedToken = "test-owner-a-refreshed-token";
    setAccount(OWNER_A, refreshedToken);
    expect(readProviderAccountSignal()).toBe(accountSignal);
    expect(accountSignal.aborted).toBe(false);
    await renderSession(stableKey);
    await settle();
    await act(async () => current.onMessage({ role: "user", message: "A's current request" }));
    await settle();

    expect(toolTurns()).toEqual([
      expectedTurn(TOKEN_A, "conversation-a"),
      expectedTurn(refreshedToken, "conversation-a", { role: "user", content: "A's current request" }),
    ]);
    expect(sdk.startSession).toHaveBeenCalledOnce();
    expect(sdk.endSession).not.toHaveBeenCalled();
    expect(releases()).toEqual([]);
    expect(stopProbe).toHaveBeenCalledOnce();
  });

  it("ends the session at a Clerk account boundary while Supabase A stays signed in", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    await renderSession(stableKey);
    const retired = await startSession();
    await connectInPlace(retired, "conversation-a");
    const oldSignal = readProviderAccountSignal();
    now.mockReturnValue(1_012_000);
    try {
      setProviderIdentity("clerk", "test-clerk-owner-b");
      expect(oldSignal.aborted).toBe(true);
      expect(browserAuth.session?.user.id).toBe(OWNER_A);
      sdk.status = "disconnected";
      await renderSession(stableKey);
      await settle();
      const beforeRetiredCallbacks = [...wire];
      await act(async () => {
        retired.onConnect({ conversationId: "conversation-a-late" });
        retired.onMessage({ role: "user", message: "A's retired transcript" });
        retired.onDisconnect();
        retired.onError("Retired connection ended");
      });
      await settle();

      expect(wire).toEqual(beforeRetiredCallbacks);
      expect(toolTurns()).toEqual([expectedTurn(TOKEN_A, "conversation-a")]);
      expect(releases()).toEqual([{
        url: "/api/pub-pal/voice-token", method: "POST", authorization: `Bearer ${TOKEN_A}`,
        contentType: "application/json", body: { action: "release", durationSeconds: 12 },
      }]);
      expect(sdk.endSession).toHaveBeenCalledOnce();
      expect(sdk.startSession).toHaveBeenCalledOnce();
    } finally {
      setProviderIdentity("clerk", null);
    }
  });
});
