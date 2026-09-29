// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Session } from "@supabase/supabase-js";
import { afterEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  authEvent: null as null | ((event: string, session: Session | null) => void),
  resolveBootstrap: null as null | ((result: { status: "local"; session: Session }) => void),
  bootstrapSignal: null as AbortSignal | null,
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
  bootstrapAuthSession: (_auth: unknown, deps: { signal: AbortSignal }) => {
    state.bootstrapSignal = deps.signal;
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
