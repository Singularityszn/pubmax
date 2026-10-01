// @vitest-environment jsdom
import { act, createElement, StrictMode, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Session } from "@supabase/supabase-js";
import { afterEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  realBootstrap: false,
  realCanonicalIdentity: false,
  canonicalReads: [] as Promise<unknown>[],
  rotateBootstrapTokens: false,
  holdCookieClear: false,
  releaseCookieClear: null as null | (() => void),
  sdkSession: null as Session | null,
  cookieSession: null as Session | null,
  releaseInstall: null as null | (() => void),
  bootstrapPromise: null as Promise<unknown> | null,
  signOutPromise: null as Promise<void> | null,
  sdkSignOutCalls: 0,
  persistedTokens: [] as string[],
  visibleAccounts: [] as string[],
  heldInstallEntered: false,
  authEvent: null as null | ((event: string, session: Session | null) => void),
  resolveBootstrap: null as null | ((result:
    | { status: "local"; session: Session }
    | { status: "restored"; session: { access_token: string; refresh_token: string } }
  ) => void),
  bootstrapSignal: null as AbortSignal | null,
  beforeSetSession: null as null | ((session: {
    access_token: string;
    refresh_token: string;
  }) => void),
}));

vi.mock("@/components/auth/ArrivalWelcome", () => ({ default: () => null }));
vi.mock("@/components/identity/AccountOnboardingHost", () => ({ default: () => null }));
vi.mock("@/components/identity/IdentityNudge", () => ({ default: () => null }));
vi.mock("@/lib/analytics", () => ({ analyticsCollectionAllowed: () => false, trackEvent: vi.fn() }));
vi.mock("@/lib/authClient", () => ({
  isAuthConfigured: () => true,
  ensureSupabaseBrowser: async () => ({
    auth: {
      onAuthStateChange: (callback: typeof state.authEvent) => {
        state.authEvent = callback;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      },
      getSession: async () => ({ data: { session: state.sdkSession } }),
      setSession: async (tokens: { access_token: string; refresh_token: string }) => {
        const userId = tokens.access_token === "late-a-access" ? "late-a"
          : tokens.access_token === "newer-c-access" ? "newer-c" : "newer-b";
        const issuedTokens = state.rotateBootstrapTokens && userId === "late-a"
          ? { access_token: "late-a-rotated-access", refresh_token: "late-a-rotated-refresh" }
          : tokens;
        const session = { ...issuedTokens, user: { id: userId, email: `${userId}@example.test` } } as Session;
        if (state.realBootstrap && userId === "late-a" && !state.heldInstallEntered) {
          state.heldInstallEntered = true;
          await new Promise<void>((resolve) => { state.releaseInstall = resolve; });
        }
        // setSession already entered the SDK: aborting bootstrap does not cancel
        // this installation or its event. Repairs must own both explicitly.
        state.sdkSession = session;
        state.authEvent?.("SIGNED_IN", session);
        return { data: { session }, error: null };
      },
      signOut: async () => {
        state.sdkSignOutCalls += 1;
        state.sdkSession = null;
        state.authEvent?.("SIGNED_OUT", null);
      },
    },
  }),
}));
vi.mock("@/lib/authSessionBootstrap", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authSessionBootstrap")>();
  return ({
  AUTH_SESSION_BOOTSTRAP_TIMEOUT_MS: 20_000,
  bootstrapAuthSession: (_auth: unknown, deps?: {
    signal?: AbortSignal;
    onBeforeSetSession?: typeof state.beforeSetSession;
  }) => {
    state.bootstrapSignal = deps?.signal ?? null;
    state.beforeSetSession = deps?.onBeforeSetSession ?? null;
    if (state.realBootstrap) {
      state.bootstrapPromise = actual.bootstrapAuthSession(
        _auth as import("@/lib/authSessionBootstrap").BrowserAuthSession,
        { ...deps,
          onBeforeSetSession: deps?.onBeforeSetSession ?? undefined,
          readHint: async () => ({ status: "present", hint: { maskedEmail: "a@…test" } }),
          redeem: async () => ({ status: "restored", session: {
            access_token: "late-a-access", refresh_token: "late-a-refresh",
          } }),
        },
      );
      return state.bootstrapPromise;
    }
    return new Promise((resolve) => { state.resolveBootstrap = resolve; });
  },
  });
});
vi.mock("@/lib/authSessionResumeClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authSessionResumeClient")>();
  return { ...actual,
    clearPersistedSession: async () => {
      if (state.holdCookieClear) {
        await new Promise<void>((resolve) => { state.releaseCookieClear = resolve; });
      }
      state.cookieSession = null;
    },
    persistSessionForResume: async (session: Session) => {
      state.persistedTokens.push(session.access_token);
      state.cookieSession = session;
      return "persisted" as const;
    },
  };
});
vi.mock("@/lib/authRedirect", () => ({
  AUTH_RETURN_FRAGMENT_RESTORED_EVENT: "pubmax:auth-fragment-restored",
  HANDLE_CLAIM_NEXT: "/u/you",
  scrubAuthCallback: async () => null,
  scrubLingeringAuthCallback: () => false,
}));
vi.mock("@/lib/authProviderAvailability", () => ({
  NO_SOCIAL_AUTH_PROVIDERS: { google: false, apple: false, microsoft: false },
  loadSocialAuthProviders: async () => ({ google: false, apple: false, microsoft: false }),
}));
vi.mock("@/lib/identityClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/identityClient")>();
  return { ...actual,
    resolveCanonicalIdentity: (...args: Parameters<typeof actual.resolveCanonicalIdentity>) => {
      if (!state.realCanonicalIdentity) return Promise.resolve(null);
      const read = actual.resolveCanonicalIdentity(...args);
      state.canonicalReads.push(read);
      return read;
    },
  };
});

import { AuthProvider, useAuth } from "@/components/auth/AuthProvider";
import { useViewerHandle } from "@/components/auth/useViewerHandle";
import { deviceAccountOwner } from "@/lib/deviceAccountIdentity";

let root: Root | null = null;
let restoreCanonicalFetch: (() => void) | null = null;
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

function recordSignOutPromise(promise: Promise<void>) {
  state.signOutPromise = promise;
}

function Viewer() {
  const auth = useAuth();
  useEffect(() => { state.visibleAccounts.push(auth.user?.id ?? "signed-out"); }, [auth.user?.id]);
  return createElement("div", null,
    createElement("span", { "data-testid": "viewer" }, auth.user?.id ?? "signed-out"),
    createElement("button", { onClick: () => recordSignOutPromise(auth.signOut("device")) }, "Sign out"),
  );
}

function CanonicalViewer() {
  const handle = useViewerHandle();
  return createElement("div", null,
    createElement(Viewer),
    createElement("span", { "data-testid": "viewer-handle" }, handle ?? "anonymous"),
    createElement("a", { "data-testid": "you", href: handle ? `/u/${handle}` : "/u/you" }, "You"),
  );
}

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  state.authEvent = null;
  state.resolveBootstrap = null;
  state.bootstrapSignal = null;
  state.beforeSetSession = null;
  state.realBootstrap = false;
  state.realCanonicalIdentity = false;
  state.canonicalReads = [];
  state.rotateBootstrapTokens = false;
  state.holdCookieClear = false;
  state.releaseCookieClear = null;
  state.sdkSession = null;
  state.cookieSession = null;
  state.releaseInstall = null;
  state.bootstrapPromise = null;
  state.signOutPromise = null;
  state.sdkSignOutCalls = 0;
  state.persistedTokens = [];
  state.visibleAccounts = [];
  state.heldInstallEntered = false;
  restoreCanonicalFetch?.();
  restoreCanonicalFetch = null;
  localStorage.clear();
  sessionStorage.clear();
});

// Actual canonical helper, owner storage, AuthProvider effect and viewer hook.
// SDK/cookie/HTTP replies are local doubles; no real account or provider proof.
async function mountHeldCanonicalIdentity() {
  state.realCanonicalIdentity = true;
  const accountA = { access_token: "identity-a-access", refresh_token: "identity-a-refresh",
    user: { id: "identity-a", email: "a@example.test" } } as Session;
  let releaseA!: (response: Response) => void;
  const heldA = new Promise<Response>((resolve) => { releaseA = resolve; });
  const request = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    expect(String(input)).toBe("/api/identity/handle/current");
    const bearer = new Headers(init?.headers).get("authorization");
    if (bearer === "Bearer identity-a-access") return heldA;
    expect(bearer).toBe("Bearer identity-b-access");
    return Response.json({ handle: "bob" });
  });
  restoreCanonicalFetch = () => request.mockRestore();
  const container = document.createElement("div");
  root = createRoot(container);
  await act(async () => root?.render(createElement(AuthProvider,
    { clerkIntegrationConfigured: false }, createElement(CanonicalViewer))));
  await vi.waitFor(() => expect(state.authEvent).toBeTypeOf("function"));
  await act(async () => {
    state.sdkSession = accountA;
    state.authEvent?.("INITIAL_SESSION", accountA);
  });
  await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
  expect(deviceAccountOwner(localStorage)).toBe("identity-a");
  const pendingA = state.canonicalReads[0];
  expect(pendingA).toBeDefined();
  return { container, pendingA, release: () => releaseA(Response.json({ handle: "alice" })) };
}

it("keeps B's canonical cache and viewer route after A's identity reply settles late", async () => {
  const { container, pendingA, release } = await mountHeldCanonicalIdentity();
  const accountB = { access_token: "identity-b-access", refresh_token: "identity-b-refresh",
    user: { id: "identity-b", email: "b@example.test" } } as Session;
  try {
    await act(async () => {
      state.sdkSession = accountB;
      state.authEvent?.("SIGNED_IN", accountB);
    });
    await vi.waitFor(() => expect(container.querySelector("[data-testid=viewer-handle]")?.textContent).toBe("bob"));
    expect(localStorage.getItem("pubmax_handle")).toBe("bob");
    await act(async () => { release(); await pendingA; });

    expect(container.querySelector("[data-testid=viewer]")?.textContent).toBe("identity-b");
    expect(container.querySelector("[data-testid=viewer-handle]")?.textContent).toBe("bob");
    expect(container.querySelector("[data-testid=you]")?.getAttribute("href")).toBe("/u/bob");
    expect(deviceAccountOwner(localStorage)).toBe("identity-b");
    expect(localStorage.getItem("pubmax_handle")).toBe("bob");
  } finally {
    await act(async () => { release(); await pendingA; });
  }
});

it("keeps signed-out viewer anonymous after a previously held canonical identity reply", async () => {
  const { container, pendingA, release } = await mountHeldCanonicalIdentity();
  try {
    await act(async () => {
      container.querySelector("button")?.click();
      await state.signOutPromise;
    });
    expect(deviceAccountOwner(localStorage)).toBeNull();
    expect(localStorage.getItem("pubmax_handle")).toBeNull();
    expect(container.querySelector("[data-testid=viewer-handle]")?.textContent).toBe("anonymous");
    await act(async () => { release(); await pendingA; });

    expect(container.querySelector("[data-testid=viewer]")?.textContent).toBe("signed-out");
    expect(container.querySelector("[data-testid=viewer-handle]")?.textContent).toBe("anonymous");
    expect(container.querySelector("[data-testid=you]")?.getAttribute("href")).toBe("/u/you");
    expect(deviceAccountOwner(localStorage)).toBeNull();
    expect(localStorage.getItem("pubmax_handle")).toBeNull();
  } finally {
    await act(async () => { release(); await pendingA; });
  }
});

it("does not resurrect a signed-out account when an older bootstrap settles", async () => {
  const session = {
    access_token: "account-a-access",
    refresh_token: "account-a-refresh",
    user: { id: "account-a", email: "a@example.test" },
  } as Session;
  const container = document.createElement("div");
  root = createRoot(container);
  await act(async () => root?.render(createElement(AuthProvider, { clerkIntegrationConfigured: false }, createElement(Viewer))));
  await vi.waitFor(() => expect(state.resolveBootstrap).toBeTypeOf("function"));

  await act(async () => state.authEvent?.("INITIAL_SESSION", session));
  const viewer = container.querySelector("[data-testid=viewer]");
  expect(viewer?.textContent).toBe("account-a");
  await act(async () => {
    container.querySelector("button")?.click();
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(viewer?.textContent).toBe("signed-out");

  await act(async () => state.resolveBootstrap?.({ status: "local", session }));
  expect(viewer?.textContent).toBe("signed-out");
  expect(state.bootstrapSignal?.aborted).toBe(true);
});

it("cancels cookie restoration when the reader signs out during cold bootstrap", async () => {
  const container = document.createElement("div");
  root = createRoot(container);
  await act(async () => root?.render(createElement(AuthProvider, { clerkIntegrationConfigured: false }, createElement(Viewer))));
  await vi.waitFor(() => expect(state.resolveBootstrap).toBeTypeOf("function"));

  await act(async () => {
    container.querySelector("button")?.click();
    await Promise.resolve();
  });
  expect(state.bootstrapSignal?.aborted).toBe(true);
  expect(container.querySelector("[data-testid=viewer]")?.textContent).toBe("signed-out");
});

it("does not resurrect an account after an independent SIGNED_OUT event", async () => {
  const session = {
    access_token: "account-a-access",
    refresh_token: "account-a-refresh",
    user: { id: "account-a", email: "a@example.test" },
  } as Session;
  const container = document.createElement("div");
  root = createRoot(container);
  await act(async () => root?.render(createElement(AuthProvider, { clerkIntegrationConfigured: false }, createElement(Viewer))));
  await vi.waitFor(() => expect(state.resolveBootstrap).toBeTypeOf("function"));

  await act(async () => state.authEvent?.("INITIAL_SESSION", session));
  const viewer = container.querySelector("[data-testid=viewer]");
  expect(viewer?.textContent).toBe("account-a");

  await act(async () => state.authEvent?.("SIGNED_OUT", null));
  expect(viewer?.textContent).toBe("signed-out");

  await act(async () => state.resolveBootstrap?.({ status: "local", session }));
  expect(viewer?.textContent).toBe("signed-out");
  expect(state.bootstrapSignal?.aborted).toBe(true);
});

it("keeps cookie restoration pending after SDK removes a failed cold local session", async () => {
  const restored = {
    access_token: "cookie-access",
    refresh_token: "cookie-refresh",
    user: { id: "cookie-account", email: "cookie@example.test" },
  } as Session;
  const container = document.createElement("div");
  root = createRoot(container);
  await act(async () => root?.render(createElement(AuthProvider, { clerkIntegrationConfigured: false }, createElement(Viewer))));
  await vi.waitFor(() => expect(state.resolveBootstrap).toBeTypeOf("function"));

  // auth-js emits SIGNED_OUT when its cold getSession discards an expired local
  // token. A separate durable cookie can still hold a valid refresh token.
  await act(async () => state.authEvent?.("SIGNED_OUT", null));
  expect(state.bootstrapSignal?.aborted).toBe(false);

  await act(async () => state.beforeSetSession?.(restored));
  await act(async () => state.authEvent?.("SIGNED_IN", restored));
  await act(async () => state.resolveBootstrap?.({ status: "restored", session: restored }));
  expect(container.querySelector("[data-testid=viewer]")?.textContent).toBe("cookie-account");
  expect(state.bootstrapSignal?.aborted).toBe(false);
});

it("does not replace a newer signed-in account with an older bootstrap result", async () => {
  const accountA = {
    access_token: "account-a-access",
    refresh_token: "account-a-refresh",
    user: { id: "account-a", email: "a@example.test" },
  } as Session;
  const accountB = {
    access_token: "account-b-access",
    refresh_token: "account-b-refresh",
    user: { id: "account-b", email: "b@example.test" },
  } as Session;
  const container = document.createElement("div");
  root = createRoot(container);
  await act(async () => root?.render(createElement(AuthProvider, { clerkIntegrationConfigured: false }, createElement(Viewer))));
  await vi.waitFor(() => expect(state.resolveBootstrap).toBeTypeOf("function"));

  await act(async () => state.authEvent?.("INITIAL_SESSION", accountA));
  const viewer = container.querySelector("[data-testid=viewer]");
  expect(viewer?.textContent).toBe("account-a");

  await act(async () => state.authEvent?.("SIGNED_IN", accountB));
  expect(viewer?.textContent).toBe("account-b");

  await act(async () => state.resolveBootstrap?.({ status: "local", session: accountA }));
  expect(viewer?.textContent).toBe("account-b");
  expect(state.bootstrapSignal?.aborted).toBe(true);
});

it("keeps bootstrap active for its own restored-session SDK event", async () => {
  const session = {
    access_token: "restored-access",
    refresh_token: "restored-refresh",
    user: { id: "restored-account", email: "restored@example.test" },
  } as Session;
  const container = document.createElement("div");
  root = createRoot(container);
  await act(async () => root?.render(createElement(AuthProvider, { clerkIntegrationConfigured: false }, createElement(Viewer))));
  await vi.waitFor(() => expect(state.beforeSetSession).toBeTypeOf("function"));

  await act(async () => state.beforeSetSession?.(session));
  await act(async () => state.authEvent?.("SIGNED_IN", session));
  expect(state.bootstrapSignal?.aborted).toBe(false);
  expect(container.querySelector("[data-testid=viewer]")?.textContent).toBe("restored-account");

  await act(async () => state.resolveBootstrap?.({ status: "restored", session }));
  expect(state.bootstrapSignal?.aborted).toBe(false);
});

// These tests use the actual bootstrap helper, a held SDK setSession and the
// rendered public auth context. Cookie/SDK state are explicit local doubles;
// they do not establish a real provider or server entitlement.
async function mountEnteredBootstrap(strict = false) {
  state.realBootstrap = true;
  // Durable cookie A is present while the local SDK initially has no session.
  state.cookieSession = { access_token: "late-a-access", refresh_token: "late-a-refresh",
    user: { id: "late-a", email: "late-a@example.test" } } as Session;
  const container = document.createElement("div");
  root = createRoot(container);
  const viewer = createElement(AuthProvider,
    { clerkIntegrationConfigured: false }, createElement(Viewer));
  await act(async () => root?.render(strict ? createElement(StrictMode, null, viewer) : viewer));
  await vi.waitFor(() => expect(state.releaseInstall).toBeTypeOf("function"));
  expect(state.heldInstallEntered).toBe(true);
  expect(state.bootstrapSignal?.aborted).toBe(false);
  return container;
}

it.each([false, true])("retires an already-entered cookie SDK installation after explicit logout (rotated=%s)", async (rotated) => {
  state.rotateBootstrapTokens = rotated;
  const container = await mountEnteredBootstrap();
  await act(async () => { container.querySelector("button")?.click(); });
  expect(container.querySelector("[data-testid=viewer]")?.textContent).toBe("signed-out");
  expect(state.bootstrapSignal?.aborted).toBe(true);
  const visibleAfterLogout = state.visibleAccounts.length;

  // Original code can complete logout here. A correct repair may instead keep
  // SDK cleanup pending, while its visible logout takes effect immediately.
  await act(async () => {
    state.releaseInstall?.();
    await state.bootstrapPromise;
    await state.signOutPromise;
  });
  expect(container.querySelector("[data-testid=viewer]")?.textContent).toBe("signed-out");
  expect(state.visibleAccounts.slice(visibleAfterLogout)).not.toContain("late-a");
  expect(state.sdkSession).toBeNull();
  expect(state.cookieSession).toBeNull();
  expect(state.persistedTokens).not.toContain("late-a-access");
  expect(state.persistedTokens).not.toContain("late-a-rotated-access");
});

it.each([false, true])("keeps a newer login when an older entered cookie SDK installation emits late SIGNED_IN (rotated=%s)", async (rotated) => {
  state.rotateBootstrapTokens = rotated;
  const container = await mountEnteredBootstrap();
  const newer = { access_token: "newer-b-access", refresh_token: "newer-b-refresh",
    user: { id: "newer-b", email: "b@example.test" } } as Session;
  await act(async () => {
    state.sdkSession = newer;
    state.authEvent?.("SIGNED_IN", newer);
  });
  expect(container.querySelector("[data-testid=viewer]")?.textContent).toBe("newer-b");
  expect(state.bootstrapSignal?.aborted).toBe(true);
  const visibleAfterNewLogin = state.visibleAccounts.length;

  await act(async () => {
    state.releaseInstall?.();
    await state.bootstrapPromise;
  });
  expect(container.querySelector("[data-testid=viewer]")?.textContent).toBe("newer-b");
  expect(state.visibleAccounts.slice(visibleAfterNewLogin)).not.toContain("late-a");
  expect(state.sdkSession?.user.id).toBe("newer-b");
  expect(state.cookieSession?.user.id).toBe("newer-b");
  expect(state.persistedTokens).not.toContain("late-a-access");
  expect(state.persistedTokens).not.toContain("late-a-rotated-access");
});

it("publishes and persists an unrevoked cookie SDK installation", async () => {
  const container = await mountEnteredBootstrap();
  await act(async () => {
    state.releaseInstall?.();
    await state.bootstrapPromise;
  });
  expect(container.querySelector("[data-testid=viewer]")?.textContent).toBe("late-a");
  expect(state.bootstrapSignal?.aborted).toBe(false);
  expect(state.sdkSession?.user.id).toBe("late-a");
  expect(state.cookieSession?.user.id).toBe("late-a");
  expect(state.persistedTokens).toContain("late-a-access");
});


it("keeps a valid cookie restore through StrictMode subscription replay", async () => {
  const container = await mountEnteredBootstrap(true);
  await act(async () => {
    state.releaseInstall?.();
    await state.bootstrapPromise;
  });
  expect(container.querySelector("[data-testid=viewer]")?.textContent).toBe("late-a");
  expect(state.bootstrapSignal?.aborted).toBe(false);
  expect(state.sdkSession?.user.id).toBe("late-a");
  expect(state.cookieSession?.user.id).toBe("late-a");
  expect(state.persistedTokens).toContain("late-a-access");
  expect(state.sdkSignOutCalls).toBe(0);
});


it("preserves a valid cookie SDK restore whose event and result use rotated tokens", async () => {
  state.rotateBootstrapTokens = true;
  const container = await mountEnteredBootstrap();
  await act(async () => {
    state.releaseInstall?.();
    await state.bootstrapPromise;
  });
  expect(container.querySelector("[data-testid=viewer]")?.textContent).toBe("late-a");
  expect(state.sdkSession?.access_token).toBe("late-a-rotated-access");
  expect(state.sdkSession?.refresh_token).toBe("late-a-rotated-refresh");
  expect(state.cookieSession?.access_token).toBe("late-a-rotated-access");
  expect(state.cookieSession?.refresh_token).toBe("late-a-rotated-refresh");
  expect(state.persistedTokens).toContain("late-a-rotated-access");
  expect(state.sdkSignOutCalls).toBe(0);
});


it("does not revive a pre-logout login while cookie clearing is held and bootstrap finishes", async () => {
  const container = await mountEnteredBootstrap();
  const newerB = { access_token: "newer-b-access", refresh_token: "newer-b-refresh",
    user: { id: "newer-b", email: "b@example.test" } } as Session;
  await act(async () => {
    state.sdkSession = newerB;
    state.authEvent?.("SIGNED_IN", newerB);
  });
  expect(container.querySelector("[data-testid=viewer]")?.textContent).toBe("newer-b");
  state.holdCookieClear = true;
  try {
    await act(async () => { container.querySelector("button")?.click(); });
    await vi.waitFor(() => expect(state.releaseCookieClear).toBeTypeOf("function"));
    expect(container.querySelector("[data-testid=viewer]")?.textContent).toBe("signed-out");
    const visibleAfterLogout = state.visibleAccounts.length;
    const persistedAfterLogout = state.persistedTokens.length;

    // The explicit logout has cleared public identity but has not reached the
    // SDK SIGNED_OUT event. B is an earlier login, not a post-logout successor.
    await act(async () => {
      state.releaseInstall?.();
      await state.bootstrapPromise;
    });
    state.releaseCookieClear?.();
    await act(async () => { await state.signOutPromise; });

    expect(container.querySelector("[data-testid=viewer]")?.textContent).toBe("signed-out");
    expect(state.visibleAccounts.slice(visibleAfterLogout)).not.toContain("late-a");
    expect(state.visibleAccounts.slice(visibleAfterLogout)).not.toContain("newer-b");
    expect(state.sdkSession).toBeNull();
    expect(state.cookieSession).toBeNull();
    expect(state.persistedTokens.slice(persistedAfterLogout)).toEqual([]);
  } finally {
    state.releaseInstall?.();
    state.releaseCookieClear?.();
    await act(async () => { await state.bootstrapPromise; await state.signOutPromise; });
  }
});

it("preserves a genuinely post-logout login while cookie clearing and bootstrap are held", async () => {
  const container = await mountEnteredBootstrap();
  const newerB = { access_token: "newer-b-access", refresh_token: "newer-b-refresh",
    user: { id: "newer-b", email: "b@example.test" } } as Session;
  await act(async () => {
    state.sdkSession = newerB;
    state.authEvent?.("SIGNED_IN", newerB);
  });
  state.holdCookieClear = true;
  try {
    await act(async () => { container.querySelector("button")?.click(); });
    await vi.waitFor(() => expect(state.releaseCookieClear).toBeTypeOf("function"));
    expect(container.querySelector("[data-testid=viewer]")?.textContent).toBe("signed-out");
    const newerC = { access_token: "newer-c-access", refresh_token: "newer-c-refresh",
      user: { id: "newer-c", email: "c@example.test" } } as Session;
    await act(async () => {
      state.sdkSession = newerC;
      state.authEvent?.("SIGNED_IN", newerC);
      state.releaseInstall?.();
      await state.bootstrapPromise;
    });
    state.releaseCookieClear?.();
    await act(async () => { await state.signOutPromise; });

    expect(container.querySelector("[data-testid=viewer]")?.textContent).toBe("newer-c");
    expect(state.sdkSession?.user.id).toBe("newer-c");
    expect(state.cookieSession?.user.id).toBe("newer-c");
    expect(state.persistedTokens).toContain("newer-c-access");
  } finally {
    state.releaseInstall?.();
    state.releaseCookieClear?.();
    await act(async () => { await state.bootstrapPromise; await state.signOutPromise; });
  }
});
