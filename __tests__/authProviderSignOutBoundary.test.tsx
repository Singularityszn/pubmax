// @vitest-environment jsdom
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Synthetic Supabase client: the provider's sign-out sequencing, account
// boundary and tab storage stay real. This is not real GoTrue revocation.
const harness = vi.hoisted(() => ({
  emit: null as null | ((event: string, session: unknown) => void),
  signOutError: null as Error | null,
}));

vi.mock("@/components/auth/ArrivalWelcome", () => ({ default: () => null }));
vi.mock("@/components/identity/AccountOnboarding", () => ({ default: () => null }));
vi.mock("@/components/identity/IdentityNudge", () => ({ default: () => null }));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("@/lib/posthog/posthogPerson", () => ({ syncPosthogPersonIdentity: vi.fn() }));
vi.mock("@/lib/authClient", () => ({
  isAuthConfigured: () => true,
  ensureSupabaseBrowser: async () => ({
    auth: {
      onAuthStateChange: (callback: (event: string, session: unknown) => void) => {
        harness.emit = callback;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      },
      signOut: async () => {
        if (harness.signOutError) return { error: harness.signOutError };
        harness.emit?.("SIGNED_OUT", null);
        return { error: null };
      },
    },
  }),
}));
vi.mock("@/lib/authProviderAvailability", () => ({
  loadSocialAuthProviders: async () => ({ google: false, apple: false, microsoft: false }),
  NO_SOCIAL_AUTH_PROVIDERS: { google: false, apple: false, microsoft: false },
}));
vi.mock("@/lib/authRedirect", () => ({
  AUTH_RETURN_FRAGMENT_RESTORED_EVENT: "pubmax-auth-return-fragment-restored",
  scrubAuthCallback: async () => null,
  scrubLingeringAuthCallback: vi.fn(() => false),
}));
vi.mock("@/lib/authSessionBootstrap", () => ({
  AUTH_SESSION_BOOTSTRAP_TIMEOUT_MS: 20_000,
  bootstrapAuthSession: async () => ({ status: "none" }),
}));
vi.mock("@/lib/authSessionResumeClient", async () => ({
  ...(await vi.importActual<typeof import("@/lib/authSessionResumeClient")>("@/lib/authSessionResumeClient")),
  clearPersistedSession: async () => undefined,
}));
vi.mock("@/lib/identityClient", () => ({
  handleClaimRouteAfterSignIn: async () => null,
  IDENTITY_HANDLE_CHANGED_EVENT: "pubmax:identity-handle-changed",
  identityHandleForOwner: () => null,
  resolveCanonicalIdentity: async () => null,
}));
vi.mock("@/lib/referralClaimClient", () => ({
  claimSignupReferralFromAuthCallback: async () => {},
  withReferralSignupProof: (attempt: unknown) => attempt,
}));

import { AuthProvider, useAuth } from "@/components/auth/AuthProvider";
import { readProviderAccountRevision, readProviderSignOutRevision } from "@/lib/authProviderRevision";
import { pintDropDraftStorageKey } from "@/lib/pintDropDraft";

const ACCOUNT = "account-a";
const OTHER = "account-b";
const accountDraftKeys = ["venue-one", "venue-two"].map((venueId) => pintDropDraftStorageKey(venueId, `account:${ACCOUNT}`));
const retainedKeys = [
  pintDropDraftStorageKey("venue-one", `account:${OTHER}`),
  pintDropDraftStorageKey("venue-one", "signed-out"),
];

let signOut: ReturnType<typeof useAuth>["signOut"] | null = null;
let root: Root | null = null;
let container: HTMLDivElement | null = null;

function SignOutProbe() {
  const auth = useAuth();
  useEffect(() => {
    signOut = auth.signOut;
  });
  return createElement("output", { "data-testid": "viewer" }, auth.user?.id ?? "signed-out");
}

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  sessionStorage.clear();
  localStorage.clear();
  harness.signOutError = null;
  for (const key of [...accountDraftKeys, ...retainedKeys]) sessionStorage.setItem(key, "{}");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(createElement(AuthProvider, { clerkIntegrationConfigured: false }, createElement(SignOutProbe)));
  });
  await act(async () => {
    harness.emit?.("SIGNED_IN", {
      access_token: "synthetic-access",
      refresh_token: "synthetic-refresh",
      user: { id: ACCOUNT, email: "a@example.com", email_confirmed_at: "2026-01-01T00:00:00.000Z" },
    });
  });
  expect(container.querySelector('[data-testid="viewer"]')?.textContent).toBe(ACCOUNT);
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: false });
});

describe("explicit sign-out account boundary", () => {
  it("keeps the account boundary and drafts when the provider refuses sign-out", async () => {
    harness.signOutError = new Error("synthetic network failure");
    const signOutRevision = readProviderSignOutRevision("supabase");
    const accountRevision = readProviderAccountRevision();
    await act(async () => signOut?.());
    expect(readProviderSignOutRevision("supabase")).toBe(signOutRevision);
    expect(readProviderAccountRevision()).toBe(accountRevision);
    expect(container?.querySelector('[data-testid="viewer"]')?.textContent).toBe(ACCOUNT);
    for (const key of accountDraftKeys) expect(sessionStorage.getItem(key)).toBe("{}");
  });

  it("removes every venue draft of the departing account with no map mounted", async () => {
    const signOutRevision = readProviderSignOutRevision("supabase");
    await act(async () => signOut?.());
    expect(readProviderSignOutRevision("supabase")).toBe(signOutRevision + 1);
    expect(container?.querySelector('[data-testid="viewer"]')?.textContent).toBe("signed-out");
    for (const key of accountDraftKeys) expect(sessionStorage.getItem(key)).toBeNull();
    for (const key of retainedKeys) expect(sessionStorage.getItem(key)).toBe("{}");
  });
});
