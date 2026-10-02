// @vitest-environment jsdom

import { act, createElement, useSyncExternalStore, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Session } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const transport = vi.hoisted(() => ({
  read: vi.fn<(input: string, init?: RequestInit, options?: { requiresIdentity?: boolean }) => Promise<Response>>(),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, prefetch, ...props }: {
    href: string;
    children?: ReactNode;
    prefetch?: boolean;
  }) => {
    void prefetch;
    return createElement("a", { href, ...props }, children);
  },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ prefetch: vi.fn() }) }));
vi.mock("@/components/auth/AuthProvider", async () => ({
  useAuth: (await import("@/components/auth/authContext")).useAuth,
}));
vi.mock("@/lib/authedFetch", () => ({ authedActionFetch: transport.read }));

import { AuthContext, type AuthContextValue } from "@/components/auth/authContext";
import MessagesLink from "@/components/nav/MessagesLink";
import { NO_SOCIAL_AUTH_PROVIDERS } from "@/lib/authProviderAvailability";
import {
  readProviderAuthState,
  readProviderIdentityRevision,
  setProviderAuthState,
  setProviderIdentity,
  subscribeProviderIdentityRevision,
} from "@/lib/authProviderRevision";
import type { ConversationDTO } from "@/lib/messages";

const OWNER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const HANDLE = "alice";
let host: HTMLDivElement;
let root: Root | null;
let session: Session;
let handle: string | null;
let identityResolved: boolean;
let releases: (() => void)[];

function sessionFor(token: string): Session {
  return {
    access_token: token,
    refresh_token: "test-owner-refresh-token",
    expires_in: 3600,
    token_type: "bearer",
    user: {
      id: OWNER,
      aud: "authenticated",
      app_metadata: {},
      user_metadata: {},
      created_at: "2026-10-01T00:00:00Z",
    },
  };
}

function contextValue(accountRevision: number): AuthContextValue {
  return {
    session,
    user: session.user,
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
    handle,
    identityResolved,
    accountRevision,
    providerAuthState: readProviderAuthState("supabase"),
    supabaseAuthState: readProviderAuthState("supabase"),
    rejectedContributionAuth: null,
    contributionAuth: null,
    invalidateContributionAuth: () => {},
    getCurrentUserId: () => session.user.id,
  };
}

function ContextHost() {
  // Match the real context's subscription using the shared store, without
  // replacing its ownership or cancellation policy.
  const accountRevision = useSyncExternalStore(
    subscribeProviderIdentityRevision,
    readProviderIdentityRevision,
    () => 0,
  );
  return createElement(AuthContext.Provider, { value: contextValue(accountRevision) },
    createElement(MessagesLink));
}

function inbox(unread: number): { conversations: ConversationDTO[]; status: "ready" } {
  return {
    conversations: [{
      id: "conversation-alice-alex",
      otherHandle: "alex",
      kind: "direct",
      lastBody: "Meet at the pub",
      lastAt: "2026-10-01T19:00:00Z",
      lastFromMe: false,
      unread,
    }],
    status: "ready",
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((release) => { resolve = release; });
  return { promise, resolve };
}

function heldRead(unread: number) {
  const held = deferred<void>();
  const release = () => held.resolve(undefined);
  releases.push(release);
  transport.read.mockImplementation(async () => {
    await held.promise;
    return Response.json(inbox(unread));
  });
  return release;
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function renderContext() {
  await act(async () => root?.render(createElement(ContextHost)));
  await settle();
}

function expectBadge(unread: number | null) {
  const link = host.querySelector<HTMLAnchorElement>('a[href="/messages"]');
  expect(link).not.toBeNull();
  expect(link?.getAttribute("aria-label")).toBe(unread === null ? "Messages" : `Messages, ${unread} unread`);
  expect(link?.getAttribute("title")).toBe(unread === null ? "Messages" : `Messages, ${unread} unread`);
  expect(link?.querySelector(".siteNavBellBadge")?.textContent ?? null)
    .toBe(unread === null ? null : String(unread));
}

function expectIdentityReads() {
  for (const [url, init, options] of transport.read.mock.calls) {
    expect(url).toBe(`/api/messages?handle=${HANDLE}`);
    expect(options).toEqual({ requiresIdentity: true });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  }
}

function resetProviderStore() {
  setProviderIdentity("clerk", null);
  setProviderIdentity("supabase", null);
  setProviderAuthState("clerk", "unresolved");
  setProviderAuthState("supabase", "unresolved");
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  resetProviderStore();
  localStorage.clear();
  session = sessionFor("test-owner-token-1");
  handle = HANDLE;
  identityResolved = true;
  setProviderIdentity("supabase", OWNER);
  setProviderAuthState("supabase", "authenticated");
  setProviderAuthState("clerk", "signed-out");
  releases = [];
  transport.read.mockReset().mockImplementation(async () => Response.json(inbox(3)));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  act(() => root?.unmount());
  root = null;
  for (const release of releases) release();
  await settle();
  host.remove();
  resetProviderStore();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("MessagesLink read ownership", () => {
  it("keeps the same owner's badge through TOKEN_REFRESHED and adopts its next read", async () => {
    await renderContext();
    expectBadge(3);
    const previousReads = transport.read.mock.calls.length;
    const release = heldRead(7);

    // TOKEN_REFRESHED replaces the session object, not the shared account.
    session = sessionFor("test-owner-token-2");
    setProviderIdentity("supabase", OWNER);
    await renderContext();
    expectBadge(3);
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    await settle();
    expect(transport.read.mock.calls.length).toBeGreaterThan(previousReads);
    expectBadge(3);

    await act(async () => release());
    await settle();
    expectBadge(7);
    expectIdentityReads();
  });

  it("stays neutral while canonical identity is unresolved despite a cached device handle", async () => {
    handle = null;
    identityResolved = false;
    localStorage.setItem("pubmax_handle", "previous-owner");
    await renderContext();

    expect(transport.read).not.toHaveBeenCalled();
    expectBadge(null);
  });

  it("clears the badge when Clerk changes account while the Supabase user stays the same", async () => {
    setProviderIdentity("clerk", "clerk-owner-a");
    setProviderAuthState("clerk", "authenticated");
    await renderContext();
    expectBadge(3);
    const previousReads = transport.read.mock.calls.length;
    const release = heldRead(7);

    await act(async () => { setProviderIdentity("clerk", "clerk-owner-b"); });
    await settle();
    expectBadge(null);
    expect(transport.read.mock.calls.length).toBeGreaterThan(previousReads);

    await act(async () => release());
    await settle();
    expectBadge(7);
    expectIdentityReads();
  });

  it("does not start a queued auth read after the link unmounts", async () => {
    // Synchronous act mounts effects without draining their queued promises.
    act(() => root?.render(createElement(ContextHost)));
    expect(host.querySelector('a[href="/messages"]')).not.toBeNull();
    expect(transport.read).not.toHaveBeenCalled();
    act(() => root?.unmount());
    root = null;
    await settle();

    expect(transport.read).not.toHaveBeenCalled();
    expect(host.querySelector('a[href="/messages"]')).toBeNull();
  });

  it("publishes only the latest refresh when a test JSON reader deliberately ignores abort", async () => {
    await renderContext();
    expectBadge(3);
    const oldBody = deferred<ReturnType<typeof inbox>>();
    releases.push(() => oldBody.resolve(inbox(91)));
    const oldResponse = Response.json(inbox(91));
    // This is an injected consumer-defense race, not evidence a native fetch
    // survives cancellation in a browser.
    const oldJson = vi.spyOn(oldResponse, "json").mockImplementation(() => oldBody.promise);
    transport.read.mockImplementation(async () => oldResponse);
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    await settle();
    expect(oldJson).toHaveBeenCalledOnce();
    const oldSignal = transport.read.mock.calls.at(-1)?.[1]?.signal;
    expect(oldSignal?.aborted).toBe(false);

    transport.read.mockImplementation(async () => Response.json(inbox(7)));
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    await settle();
    expect(oldSignal?.aborted).toBe(true);
    expectBadge(7);

    await act(async () => oldBody.resolve(inbox(91)));
    await settle();
    expectBadge(7);
    expectIdentityReads();
  });
});
