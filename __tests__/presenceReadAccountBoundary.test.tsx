// @vitest-environment jsdom

import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Session } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContextValue } from "@/components/auth/authContext";

const provider = vi.hoisted(() => ({
  session: null as Session | null,
  subscriber: null as ((event: string, session: Session | null) => void) | null,
  router: { push: vi.fn() },
}));
const requests = vi.hoisted(() => ({ presence: vi.fn(), round: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => provider.router }));
vi.mock("@/components/auth/ArrivalWelcome", () => ({ default: () => null }));
vi.mock("@/components/identity/AccountOnboarding", () => ({ default: () => null }));
vi.mock("@/components/identity/IdentityNudge", () => ({ default: () => null }));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("@/lib/nativePlatform", () => ({ nativePlatform: () => null, isNativeApp: () => false }));
vi.mock("@/lib/authClient", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/authClient")>(),
  isAuthConfigured: () => true,
  getAccessToken: async () => provider.session?.access_token ?? null,
  ensureSupabaseBrowser: async () => ({ auth: {
    getSession: async () => ({ data: { session: provider.session }, error: null }),
    onAuthStateChange: (callback: typeof provider.subscriber) => {
      provider.subscriber = callback;
      queueMicrotask(() => callback?.("INITIAL_SESSION", provider.session));
      return { data: { subscription: { unsubscribe: () => { provider.subscriber = null; } } } };
    },
  } }),
}));
vi.mock("@/lib/authSessionBootstrap", () => ({
  AUTH_SESSION_BOOTSTRAP_TIMEOUT_MS: 20_000,
  bootstrapAuthSession: async () => provider.session
    ? ({ status: "local", session: provider.session }) : ({ status: "none" }),
}));
vi.mock("@/lib/authSessionResumeClient", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/authSessionResumeClient")>(),
  persistSessionForResume: async () => "stored",
  resumeAlreadyPersisted: () => true,
}));
vi.mock("@/components/nav/SiteNav", () => ({ default: () => null }));
vi.mock("@/components/wild/RoundRotaGate", () => ({ default: () => null }));
vi.mock("@/components/profile/HandleAvatar", () => ({ default: () => null }));
vi.mock("@/lib/authedFetch", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/authedFetch")>(),
  authedActionFetch: requests.presence,
}));
vi.mock("@/lib/venuesSlim", () => ({ loadSlimVenues: async () => [] }));
vi.mock("@/lib/roundRequest", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/roundRequest")>(),
  roundRequest: requests.round,
}));

import RoundPageClient from "@/app/rounds/[code]/RoundPageClient";
import { ACTIVE_ROUND_KEY } from "@/lib/activeRound";
import { AuthProvider, useAuth } from "@/components/auth/AuthProvider";
import PresenceStrip from "@/components/feed/PresenceStrip";
import { setProviderAuthState, setProviderIdentity } from "@/lib/authProviderRevision";
import { forgetCurrentIdentityRead } from "@/lib/currentIdentityRead";
import type { RoundViewState } from "@/lib/rounds";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const VENUE = "venue-test";
let container: HTMLDivElement;
let root: Root;
let params: Promise<{ code: string }>;
let auth: AuthContextValue;
const abortSignalAny = Object.getOwnPropertyDescriptor(AbortSignal, "any");

function account(id: string): Session {
  return { user: { id }, access_token: `token-${id}`, refresh_token: `refresh-${id}` } as Session;
}

function AuthProbe() {
  const value = useAuth();
  useEffect(() => { auth = value; }, [value]);
  return null;
}

async function switchAccount(id: string | null): Promise<void> {
  expect(provider.subscriber).not.toBeNull();
  await act(async () => {
    provider.session = id ? account(id) : null;
    provider.subscriber?.(id ? "SIGNED_IN" : "SIGNED_OUT", provider.session);
  });
}

function presenceResponse(): Response {
  return Response.json({ presence: [{
    handle: "mate_ann",
    venueId: VENUE,
    venueName: "The Test Pub",
    venueMapUrl: `/map?sel=${VENUE}`,
    at: new Date(Date.now() - 1000).toISOString(),
  }] });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(async () => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/feed");
  forgetCurrentIdentityRead();
  setProviderIdentity("supabase", null);
  setProviderAuthState("supabase", "unresolved");
  provider.session = null;
  Object.defineProperty(AbortSignal, "any", { configurable: true, value: undefined });
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    if (String(input).includes("/api/identity/handle/current")) {
      return Response.json({ handle: provider.session?.user.id ?? null });
    }
    return Response.json({ google: false, apple: false, microsoft: false });
  }));
  requests.presence.mockReset();
  requests.round.mockReset();
  const at = new Date().toISOString();
  const round: RoundViewState = {
    round: { id: "round-1", code: "BCDFGH", title: "Test Round", createdByHandle: "mate_ann", createdAt: at, closedAt: null },
    members: [{ handle: "mate_ann", joinedAt: at }],
    stops: [{ id: "stop-1", venueId: VENUE, venueName: "The Test Pub", addedByHandle: "mate_ann", createdAt: at }],
    spends: [],
  };
  requests.round.mockImplementation(async () => Response.json(round));
  params = Promise.resolve({ code: "BCDFGH" });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(AuthProvider, { clerkIntegrationConfigured: false }, createElement(AuthProbe)));
  });
  await switchAccount("account-a");
  expect(auth.user?.id).toBe("account-a");
  expect(auth.identityResolved).toBe(true);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  setProviderIdentity("supabase", null);
  setProviderAuthState("supabase", "unresolved");
  forgetCurrentIdentityRead();
  window.localStorage.clear();
  window.sessionStorage.clear();
  if (abortSignalAny) Object.defineProperty(AbortSignal, "any", abortSignalAny);
  else Reflect.deleteProperty(AbortSignal, "any");
  vi.unstubAllGlobals();
});

describe.each(["feed strip", "Round overlay"] as const)("%s account ownership", (surface) => {
  async function render() {
    await act(async () => {
      root.render(createElement(AuthProvider, { clerkIntegrationConfigured: false }, createElement(AuthProbe), surface === "feed strip"
        ? createElement(PresenceStrip)
        : createElement(RoundPageClient, { params })));
    });
  }

  function visibleCount(): number {
    return container.querySelectorAll(surface === "feed strip"
      ? ".presenceItem" : "[aria-label='here now']").length;
  }

  it("reads presence after normal sign-in without AbortSignal.any", async () => {
    await switchAccount(null);
    requests.presence.mockImplementation(async () => provider.session
      ? presenceResponse() : Response.json({ presence: [] }));
    await render();
    expect(visibleCount()).toBe(0);
    expect(requests.presence).toHaveBeenCalledWith(
      expect.stringContaining("/api/presence"),
      expect.objectContaining({ credentials: "omit" }),
      { requiresIdentity: true },
    );

    await switchAccount("account-a");
    expect(visibleCount()).toBe(1);
  });

  it("hides loaded rows immediately when another account starts a pending read", async () => {
    requests.presence.mockResolvedValueOnce(presenceResponse());
    await render();
    expect(visibleCount()).toBe(1);

    const accountB = deferred<Response>();
    requests.presence.mockReturnValue(accountB.promise);
    await switchAccount("account-b");
    expect(visibleCount()).toBe(0);

    await act(async () => { accountB.resolve(Response.json({ presence: [] })); });
    expect(visibleCount()).toBe(0);
  });

  it("rejects an old response after a new account receives an empty result", async () => {
    const accountA = deferred<Response>();
    requests.presence.mockReturnValueOnce(accountA.promise);
    await render();
    expect(requests.presence).toHaveBeenCalledTimes(1);

    requests.presence.mockImplementation(async () => Response.json({ presence: [] }));
    await switchAccount("account-b");
    await act(async () => { accountA.resolve(presenceResponse()); });
    expect(visibleCount()).toBe(0);
  });

  it("rejects a body that finishes after sign-out and return to the same account", async () => {
    const body = deferred<unknown>();
    const response = presenceResponse();
    const json = vi.spyOn(response, "json").mockReturnValue(body.promise);
    requests.presence.mockResolvedValueOnce(response);
    await render();
    expect(json).toHaveBeenCalledTimes(1);

    requests.presence.mockImplementation(async () => Response.json({ presence: [] }));
    await switchAccount(null);
    await switchAccount("account-a");
    await act(async () => { body.resolve(await presenceResponse().json()); });
    expect(visibleCount()).toBe(0);
  });

  it("shows fresh rows for the new account", async () => {
    requests.presence.mockImplementation(async () => Response.json({ presence: [] }));
    await render();
    expect(visibleCount()).toBe(0);

    requests.presence.mockImplementation(async () => presenceResponse());
    await switchAccount("account-b");
    expect(visibleCount()).toBe(1);
  });
});

describe("the Round page's active Round key", () => {
  async function renderRound() {
    await act(async () => {
      root.render(createElement(AuthProvider, { clerkIntegrationConfigured: false }, createElement(AuthProbe),
        createElement(RoundPageClient, { params })));
    });
  }

  it.each([
    ["pending", "BCDFGH", null],
    ["failed", "BCDFGH", null],
    ["open", "BCDFGH", null],
    ["pending", "JKLMNP", "JKLMNP"],
    ["failed", "JKLMNP", "JKLMNP"],
    ["open", "JKLMNP", "JKLMNP"],
  ] as const)("handles leaving a %s read with stored code %s", async (read, storedCode, expectedCode) => {
    window.localStorage.setItem(ACTIVE_ROUND_KEY, "BCDFGH");
    if (read === "pending") requests.round.mockReturnValue(deferred<Response>().promise);
    if (read === "failed") requests.round.mockRejectedValue(new TypeError("Failed to fetch"));
    await renderRound();
    expect(requests.round).toHaveBeenCalled();
    expect(window.localStorage.getItem(ACTIVE_ROUND_KEY)).toBe("BCDFGH");

    window.localStorage.setItem(ACTIVE_ROUND_KEY, storedCode);
    await act(async () => {
      root.render(createElement(AuthProvider, { clerkIntegrationConfigured: false }, createElement(AuthProbe)));
    });
    expect(window.localStorage.getItem(ACTIVE_ROUND_KEY)).toBe(expectedCode);
  });

  it("keeps the key when the read fails for a reason other than 404", async () => {
    window.localStorage.setItem(ACTIVE_ROUND_KEY, "BCDFGH");
    requests.round.mockImplementation(async () => { throw new TypeError("Failed to fetch"); });
    await renderRound();
    expect(requests.round).toHaveBeenCalled();
    expect(window.localStorage.getItem(ACTIVE_ROUND_KEY)).toBe("BCDFGH");
  });

  it("clears the key on a 404", async () => {
    window.localStorage.setItem(ACTIVE_ROUND_KEY, "BCDFGH");
    requests.round.mockImplementation(async () => Response.json({ error: "not found" }, { status: 404 }));
    await renderRound();
    expect(window.localStorage.getItem(ACTIVE_ROUND_KEY)).toBeNull();
  });

  it("clears the key when the Round is confirmed closed", async () => {
    window.localStorage.setItem(ACTIVE_ROUND_KEY, "BCDFGH");
    const at = new Date().toISOString();
    requests.round.mockImplementation(async () => Response.json({
      round: { id: "round-1", code: "BCDFGH", title: "Test Round", createdByHandle: "mate_ann", createdAt: at, closedAt: at },
      members: [], stops: [], spends: [],
    }));
    await renderRound();
    expect(window.localStorage.getItem(ACTIVE_ROUND_KEY)).toBeNull();
  });
});
