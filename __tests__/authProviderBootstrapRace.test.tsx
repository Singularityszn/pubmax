// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Session } from "@supabase/supabase-js";
import { afterEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
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
vi.mock("@/components/identity/AccountOnboarding", () => ({ default: () => null }));
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
      signOut: async () => { state.authEvent?.("SIGNED_OUT", null); },
    },
  }),
}));
vi.mock("@/lib/authSessionBootstrap", () => ({
  AUTH_SESSION_BOOTSTRAP_TIMEOUT_MS: 20_000,
  bootstrapAuthSession: (_auth: unknown, deps: {
    signal: AbortSignal;
    onBeforeSetSession: typeof state.beforeSetSession;
  }) => {
    state.bootstrapSignal = deps.signal;
    state.beforeSetSession = deps.onBeforeSetSession;
    return new Promise((resolve) => { state.resolveBootstrap = resolve; });
  },
}));
vi.mock("@/lib/authSessionResumeClient", () => ({
  clearPersistedSession: async () => {},
  persistSessionForResume: async () => "persisted",
}));
vi.mock("@/lib/authRedirect", () => ({
  AUTH_RETURN_FRAGMENT_RESTORED_EVENT: "pubmax:auth-fragment-restored",
  scrubAuthCallback: async () => null,
  scrubLingeringAuthCallback: () => false,
}));
vi.mock("@/lib/authProviderAvailability", () => ({
  NO_SOCIAL_AUTH_PROVIDERS: { google: false, apple: false, microsoft: false },
  loadSocialAuthProviders: async () => ({ google: false, apple: false, microsoft: false }),
}));
vi.mock("@/lib/identityClient", () => ({
  IDENTITY_HANDLE_CHANGED_EVENT: "pubmax:identity-handle-changed",
  identityHandleForOwner: () => null,
  resolveCanonicalIdentity: async () => null,
}));

import { AuthProvider, useAuth } from "@/components/auth/AuthProvider";

let root: Root | null = null;
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

function Viewer() {
  const auth = useAuth();
  return createElement("div", null,
    createElement("span", { "data-testid": "viewer" }, auth.user?.id ?? "signed-out"),
    createElement("button", { onClick: () => { void auth.signOut("device"); } }, "Sign out"),
  );
}

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  state.authEvent = null;
  state.resolveBootstrap = null;
  state.bootstrapSignal = null;
  state.beforeSetSession = null;
  localStorage.clear();
  sessionStorage.clear();
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
  expect(state.bootstrapSignal?.aborted).toBe(true);

  await act(async () => state.resolveBootstrap?.({ status: "local", session }));
  expect(viewer?.textContent).toBe("signed-out");
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
