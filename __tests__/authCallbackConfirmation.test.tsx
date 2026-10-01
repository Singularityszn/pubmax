// @vitest-environment jsdom
import { act, createElement, StrictMode } from "react";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  setSession: vi.fn(),
  signOut: vi.fn(),
  authEvent: null as null | ((event: AuthChangeEvent, session: Session | null) => void),
  bootstrapSignal: null as AbortSignal | null,
  bootstrap: vi.fn(),
  getUser: vi.fn(),
  mintSession: vi.fn(),
  scrubCallback: vi.fn(),
  releaseCoordination: vi.fn(),
  socialProviderLoads: vi.fn(),
  localAttemptOwned: false,
  hasCallback: true,
  existingSession: null as null | {
    access_token: string;
    refresh_token: string;
    user: { id: string; email: string };
  },
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
      getUser: harness.getUser,
      setSession: harness.setSession,
      onAuthStateChange: (callback: (event: AuthChangeEvent, session: Session | null) => void) => {
        harness.authEvent = callback;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      },
      signOut: harness.signOut,
    },
  }),
}));
vi.mock("@/lib/authProviderAvailability", () => ({
  loadSocialAuthProviders: async () => {
    harness.socialProviderLoads();
    return { google: false, apple: false, microsoft: false };
  },
  NO_SOCIAL_AUTH_PROVIDERS: { google: false, apple: false, microsoft: false },
}));
vi.mock("@/lib/deviceAccountSwitch", () => ({
  mintSessionFromRefreshToken: harness.mintSession,
  browserDeviceAccountSwitchDeps: () => ({
    authConfig: { url: "https://provider.example", key: "public-key" },
    fetchImpl: async (_url: string, init: RequestInit) => {
      const token = (init.headers as Record<string, string>).authorization.slice(7);
      const result = await harness.getUser(token);
      return new Response(JSON.stringify(result.error ?? result.data.user), { status: result.error ? 403 : 200 });
    },
  }),
  activateDeviceAccount: vi.fn(),
}));
vi.mock("@/lib/authRedirect", () => ({
  AUTH_RETURN_FRAGMENT_RESTORED_EVENT: "pubmax-auth-return-fragment-restored",
  scrubAuthCallback: async () => {
    harness.scrubCallback();
    if (!harness.hasCallback) return null;
    return {
      attempt: {
        attemptId: null,
        tokens: { accessToken: "synthetic-access", refreshToken: "synthetic-refresh" },
        providerError: false,
      },
      cleanUrl: "/map",
      localAttemptOwned: harness.localAttemptOwned,
      releaseCoordination: harness.releaseCoordination,
    };
  },
  scrubLingeringAuthCallback: vi.fn(() => false),
}));
vi.mock("@/lib/authSessionBootstrap", () => ({
  AUTH_SESSION_BOOTSTRAP_TIMEOUT_MS: 20_000,
  bootstrapAuthSession: harness.bootstrap,
}));
vi.mock("@/lib/authSessionResumeClient", () => ({
  clearPersistedSession: vi.fn(async () => {}),
  persistSessionForResume: vi.fn(async () => "persisted"),
  requestResumeLink: vi.fn(async () => ({ status: "sent" })),
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

function ViewerProbe() {
  const { user, loading, signOut } = useAuth();
  return createElement("div", null,
    createElement("output", { "data-testid": "viewer", "aria-busy": loading }, user?.id ?? "signed-out"),
    createElement("button", { "data-testid": "sign-out", onClick: () => { void signOut("device"); } }, "Sign out"),
  );
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  harness.localAttemptOwned = false;
  harness.hasCallback = true;
  harness.existingSession = null;
  harness.authEvent = null;
  harness.bootstrapSignal = null;
  harness.bootstrap.mockReset();
  harness.bootstrap.mockImplementation(async () => harness.existingSession
    ? { status: "local", session: harness.existingSession }
    : { status: "none" });
  harness.setSession.mockReset();
  harness.signOut.mockReset();
  harness.signOut.mockImplementation(async () => { harness.authEvent?.("SIGNED_OUT", null); });
  harness.getUser.mockReset();
  harness.mintSession.mockReset();
  harness.scrubCallback.mockReset();
  harness.releaseCoordination.mockReset();
  harness.socialProviderLoads.mockReset();
  harness.getUser.mockResolvedValue({
    data: { user: { id: "account-a", email: "person@example.com" } },
    error: null,
  });
  harness.setSession.mockResolvedValue({
    data: {
      session: {
        access_token: "synthetic-access",
        refresh_token: "synthetic-refresh",
        user: { id: "account-a", email: "person@example.com" },
      },
    },
    error: null,
  });
  harness.mintSession.mockResolvedValue({
    status: "minted",
    session: { access_token: "synthetic-access", refresh_token: "synthetic-refresh" },
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  localStorage.clear();
  sessionStorage.clear();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: false });
});

async function mount(): Promise<void> {
  await act(async () => {
    root?.render(createElement(AuthProvider, { clerkIntegrationConfigured: false }, createElement(ViewerProbe)));
  });
}

function deferBootstrap(): (value: unknown) => void {
  let finishBootstrap!: (value: unknown) => void;
  harness.bootstrap.mockImplementation((_auth: unknown, options: { signal: AbortSignal }) => {
    harness.bootstrapSignal = options.signal;
    return new Promise((resolve) => { finishBootstrap = resolve; });
  });
  return (value) => finishBootstrap(value);
}

describe("unowned auth callback confirmation", () => {
  it.each(["none", "restored", "expired", "banned", "unavailable", "rejected"])(
    "keeps loading until a %s bootstrap settles without a callback",
    async (status) => {
      harness.hasCallback = false;
      let finishBootstrap!: (value: unknown) => void;
      let rejectBootstrap!: (reason: Error) => void;
      harness.bootstrap.mockImplementation(() => new Promise((resolve, reject) => {
        finishBootstrap = resolve;
        rejectBootstrap = reject;
      }));

      await mount();
      expect(harness.bootstrap).toHaveBeenCalledOnce();
      expect(container?.querySelector('[data-testid="viewer"]')?.getAttribute("aria-busy")).toBe("true");

      await act(async () => {
        if (status === "rejected") rejectBootstrap(new Error("offline"));
        else finishBootstrap({
          status,
          session: { access_token: "access-b", refresh_token: "refresh-b" },
          maskedEmail: "b@example.com",
          message: "Account unavailable",
        });
      });

      expect(container?.querySelector('[data-testid="viewer"]')?.getAttribute("aria-busy")).toBe("false");
      expect(harness.setSession).not.toHaveBeenCalled();
    },
  );

  it("holds one confirmation through StrictMode effect replay", async () => {
    await act(async () => {
      root?.render(createElement(
        StrictMode,
        null,
        createElement(AuthProvider, { clerkIntegrationConfigured: false }, createElement(ViewerProbe)),
      ));
    });

    await vi.waitFor(() => expect(container?.textContent).toContain("Sign in as person@example.com?"));
    expect(harness.socialProviderLoads).toHaveBeenCalledTimes(2);
    expect(container?.textContent?.match(/Sign in as person@example.com\?/g)).toHaveLength(1);
    expect(harness.scrubCallback).toHaveBeenCalledOnce();
    expect(harness.mintSession).toHaveBeenCalledOnce();
    expect(harness.releaseCoordination).toHaveBeenCalledOnce();
    expect(harness.setSession).not.toHaveBeenCalled();

    const continueButton = [...container!.querySelectorAll("button")].find((button) => button.textContent === "Continue");
    await act(async () => continueButton?.click());
    await vi.waitFor(() => expect(harness.setSession).toHaveBeenCalledOnce());
    expect(container?.textContent).toContain("Signed in as person@example.com.");
  });

  it("shows verified A confirmation after B supersedes a delayed stale restore", async () => {
    const finishBootstrap = deferBootstrap();
    await mount();
    await vi.waitFor(() => {
      expect(harness.authEvent).not.toBeNull();
      expect(harness.bootstrapSignal).not.toBeNull();
    });

    const accountB = {
      access_token: "access-b",
      refresh_token: "refresh-b",
      user: { id: "account-b", email: "b@example.com" },
    } as Session;
    const staleRestoreA = {
      access_token: "access-a",
      refresh_token: "refresh-a",
      user: { id: "account-a", email: "a@example.com" },
    } as Session;
    await act(async () => harness.authEvent?.("SIGNED_IN", accountB));
    expect(harness.bootstrapSignal?.aborted).toBe(true);
    expect(container?.querySelector("[data-testid=viewer]")?.textContent).toBe("account-b");

    await act(async () => finishBootstrap({ status: "local", session: staleRestoreA }));
    await vi.waitFor(() => expect(container?.textContent).toContain("Sign in as person@example.com?"));
    expect(container?.querySelector("[data-testid=viewer]")?.textContent).toBe("account-b");
    expect(harness.setSession).not.toHaveBeenCalled();

    const continueButton = [...container!.querySelectorAll("button")].find((button) => button.textContent === "Continue");
    await act(async () => continueButton?.click());
    await vi.waitFor(() => expect(harness.setSession).toHaveBeenCalledOnce());
    expect(container?.querySelector("[data-testid=viewer]")?.textContent).toBe("account-a");
  });

  it("does not publish a pending callback confirmation after explicit sign-out", async () => {
    const finishBootstrap = deferBootstrap();
    await mount();
    await vi.waitFor(() => {
      expect(harness.authEvent).not.toBeNull();
      expect(harness.bootstrapSignal).not.toBeNull();
    });

    const accountB = {
      access_token: "access-b",
      refresh_token: "refresh-b",
      user: { id: "account-b", email: "b@example.com" },
    } as Session;
    const staleRestoreA = {
      access_token: "access-a",
      refresh_token: "refresh-a",
      user: { id: "account-a", email: "a@example.com" },
    } as Session;
    await act(async () => harness.authEvent?.("SIGNED_IN", accountB));
    await act(async () => container?.querySelector<HTMLButtonElement>("[data-testid=sign-out]")?.click());
    await vi.waitFor(() => expect(container?.querySelector("[data-testid=viewer]")?.textContent).toBe("signed-out"));
    expect(harness.bootstrapSignal?.aborted).toBe(true);

    await act(async () => finishBootstrap({ status: "local", session: staleRestoreA }));
    expect(container?.textContent).not.toContain("Sign in as person@example.com?");
    expect(container?.querySelector("[data-testid=viewer]")?.textContent).toBe("signed-out");
    expect(harness.setSession).not.toHaveBeenCalled();
  });

  it("keeps explicit sign-out final when Continue already started installing another account", async () => {
    let finishSetSession!: () => void;
    harness.setSession.mockImplementation(() => new Promise((resolve) => {
      finishSetSession = () => resolve({
        data: { session: {
          access_token: "synthetic-access",
          refresh_token: "synthetic-refresh",
          user: { id: "account-a", email: "person@example.com" },
        } },
        error: null,
      });
    }));

    await mount();
    await vi.waitFor(() => expect(container?.textContent).toContain("Sign in as person@example.com?"));
    const continueButton = [...container!.querySelectorAll("button")].find((button) => button.textContent === "Continue");
    await act(async () => continueButton?.click());
    await vi.waitFor(() => expect(harness.setSession).toHaveBeenCalledOnce());

    await act(async () => container?.querySelector<HTMLButtonElement>("[data-testid=sign-out]")?.click());
    expect(container?.querySelector("[data-testid=viewer]")?.textContent).toBe("signed-out");
    await act(async () => finishSetSession());
    expect(container?.querySelector("[data-testid=viewer]")?.textContent).toBe("signed-out");
    expect(container?.textContent).not.toContain("Signed in as person@example.com.");
  });

  it("keeps a newer B login when cancelled A finishes installing during logout", async () => {
    const accountA = {
      access_token: "synthetic-access",
      refresh_token: "synthetic-refresh",
      user: { id: "account-a", email: "person@example.com" },
    } as Session;
    const accountB = {
      access_token: "access-b",
      refresh_token: "refresh-b",
      user: { id: "account-b", email: "b@example.com" },
    } as Session;
    const refreshedB = {
      ...accountB,
      access_token: "access-b-refreshed",
      refresh_token: "refresh-b-refreshed",
    } as Session;
    let finishA!: () => void;
    harness.setSession.mockImplementation(({ access_token }: { access_token: string }) => {
      if (access_token.startsWith("access-b")) {
        const installed = access_token === refreshedB.access_token ? refreshedB : accountB;
        harness.authEvent?.("SIGNED_IN", installed);
        return Promise.resolve({ data: { session: installed }, error: null });
      }
      return new Promise((resolve) => {
        finishA = () => {
          harness.authEvent?.("SIGNED_IN", accountA);
          resolve({ data: { session: accountA }, error: null });
        };
      });
    });

    await mount();
    await vi.waitFor(() => expect(container?.textContent).toContain("Sign in as person@example.com?"));
    const continueButton = [...container!.querySelectorAll("button")].find((button) => button.textContent === "Continue");
    await act(async () => continueButton?.click());
    await vi.waitFor(() => expect(harness.setSession).toHaveBeenCalledOnce());

    await act(async () => container?.querySelector<HTMLButtonElement>("[data-testid=sign-out]")?.click());
    expect(container?.querySelector("[data-testid=viewer]")?.textContent).toBe("signed-out");
    await act(async () => harness.authEvent?.("SIGNED_IN", accountB));
    await act(async () => harness.authEvent?.("TOKEN_REFRESHED", refreshedB));
    expect(container?.querySelector("[data-testid=viewer]")?.textContent).toBe("account-b");

    await act(async () => finishA());
    await vi.waitFor(() => expect(harness.setSession).toHaveBeenCalledTimes(2));
    expect(harness.setSession).toHaveBeenLastCalledWith({
      access_token: "access-b-refreshed",
      refresh_token: "refresh-b-refreshed",
    });
    expect(harness.signOut).not.toHaveBeenCalled();
    expect(container?.querySelector("[data-testid=viewer]")?.textContent).toBe("account-b");
  });

  it("retains a newer same-account login when cancelled callback A finishes last", async () => {
    const callbackA = {
      access_token: "synthetic-access", refresh_token: "synthetic-refresh",
      user: { id: "account-a", email: "person@example.com" },
    } as Session;
    const newerA = {
      access_token: "newer-access", refresh_token: "newer-refresh",
      user: { id: "account-a", email: "person@example.com" },
    } as Session;
    let finishA!: () => void;
    harness.setSession.mockImplementation(({ access_token }: { access_token: string }) => {
      if (access_token === "newer-access") {
        harness.authEvent?.("SIGNED_IN", newerA);
        return Promise.resolve({ data: { session: newerA }, error: null });
      }
      return new Promise((resolve) => {
        finishA = () => {
          harness.authEvent?.("SIGNED_IN", callbackA);
          resolve({ data: { session: callbackA }, error: null });
        };
      });
    });

    await mount();
    await vi.waitFor(() => expect(container?.textContent).toContain("Sign in as person@example.com?"));
    const continueButton = [...container!.querySelectorAll("button")].find((button) => button.textContent === "Continue");
    await act(async () => continueButton?.click());
    await vi.waitFor(() => expect(harness.setSession).toHaveBeenCalledOnce());
    await act(async () => container?.querySelector<HTMLButtonElement>("[data-testid=sign-out]")?.click());
    await act(async () => harness.authEvent?.("SIGNED_IN", newerA));
    expect(container?.querySelector("[data-testid=viewer]")?.textContent).toBe("signed-out");
    await act(async () => finishA());
    await vi.waitFor(() => expect(harness.setSession).toHaveBeenCalledTimes(2));
    expect(harness.setSession).toHaveBeenLastCalledWith({
      access_token: "newer-access", refresh_token: "newer-refresh",
    });
    expect(harness.signOut).not.toHaveBeenCalled();
    expect(container?.querySelector("[data-testid=viewer]")?.textContent).toBe("account-a");
  });

  it("discards rotated callback A after logout while preserving later same-account login", async () => {
    const rotatedA = {
      access_token: "rotated-access", refresh_token: "rotated-refresh",
      user: { id: "account-a", email: "person@example.com" },
    } as Session;
    const newerA = {
      access_token: "newer-access", refresh_token: "newer-refresh",
      user: { id: "account-a", email: "person@example.com" },
    } as Session;
    let finishA!: () => void;
    harness.setSession.mockImplementation(({ access_token }: { access_token: string }) => {
      if (access_token === "newer-access") {
        harness.authEvent?.("SIGNED_IN", newerA);
        return Promise.resolve({ data: { session: newerA }, error: null });
      }
      return new Promise((resolve) => {
        finishA = () => {
          harness.authEvent?.("SIGNED_IN", {
            ...rotatedA,
            access_token: "synthetic-access",
            refresh_token: "synthetic-refresh",
          } as Session);
          harness.authEvent?.("TOKEN_REFRESHED", rotatedA);
          resolve({ data: { session: rotatedA }, error: null });
        };
      });
    });

    await mount();
    await vi.waitFor(() => expect(container?.textContent).toContain("Sign in as person@example.com?"));
    const continueButton = [...container!.querySelectorAll("button")].find((button) => button.textContent === "Continue");
    await act(async () => continueButton?.click());
    await vi.waitFor(() => expect(harness.setSession).toHaveBeenCalledOnce());
    await act(async () => container?.querySelector<HTMLButtonElement>("[data-testid=sign-out]")?.click());
    await act(async () => harness.authEvent?.("SIGNED_IN", newerA));
    await act(async () => finishA());
    await vi.waitFor(() => expect(harness.setSession).toHaveBeenCalledTimes(2));
    expect(harness.setSession).toHaveBeenLastCalledWith({
      access_token: "newer-access", refresh_token: "newer-refresh",
    });
    expect(harness.signOut).not.toHaveBeenCalled();
    expect(container?.querySelector("[data-testid=viewer]")?.textContent).toBe("account-a");
  });

  it("does not restore B after B signs out while cancelled A still installs", async () => {
    const accountA = {
      access_token: "synthetic-access",
      refresh_token: "synthetic-refresh",
      user: { id: "account-a", email: "person@example.com" },
    } as Session;
    const accountB = {
      access_token: "access-b",
      refresh_token: "refresh-b",
      user: { id: "account-b", email: "b@example.com" },
    } as Session;
    let finishA!: () => void;
    harness.setSession.mockImplementation(({ access_token }: { access_token: string }) => {
      if (access_token === "access-b") {
        harness.authEvent?.("SIGNED_IN", accountB);
        return Promise.resolve({ data: { session: accountB }, error: null });
      }
      return new Promise((resolve) => {
        finishA = () => {
          harness.authEvent?.("SIGNED_IN", accountA);
          resolve({ data: { session: accountA }, error: null });
        };
      });
    });

    await mount();
    await vi.waitFor(() => expect(container?.textContent).toContain("Sign in as person@example.com?"));
    const continueButton = [...container!.querySelectorAll("button")].find((button) => button.textContent === "Continue");
    await act(async () => continueButton?.click());
    await vi.waitFor(() => expect(harness.setSession).toHaveBeenCalledOnce());

    await act(async () => container?.querySelector<HTMLButtonElement>("[data-testid=sign-out]")?.click());
    await act(async () => harness.authEvent?.("SIGNED_IN", accountB));
    await act(async () => harness.authEvent?.("SIGNED_OUT", null));
    await act(async () => finishA());

    expect(harness.setSession).toHaveBeenCalledOnce();
    expect(harness.signOut).toHaveBeenCalledOnce();
    expect(container?.querySelector("[data-testid=viewer]")?.textContent).toBe("signed-out");
  });

  it("clears SDK after a cross-tab sign-out overtakes a pending callback install", async () => {
    const accountA = {
      access_token: "synthetic-access",
      refresh_token: "synthetic-refresh",
      user: { id: "account-a", email: "person@example.com" },
    } as Session;
    let finishA!: () => void;
    harness.setSession.mockImplementation(() => new Promise((resolve) => {
      finishA = () => {
        harness.authEvent?.("SIGNED_IN", accountA);
        resolve({ data: { session: accountA }, error: null });
      };
    }));

    await mount();
    await vi.waitFor(() => expect(container?.textContent).toContain("Sign in as person@example.com?"));
    const continueButton = [...container!.querySelectorAll("button")].find((button) => button.textContent === "Continue");
    await act(async () => continueButton?.click());
    await vi.waitFor(() => expect(harness.setSession).toHaveBeenCalledOnce());

    await act(async () => harness.authEvent?.("SIGNED_OUT", null));
    expect(container?.querySelector("[data-testid=viewer]")?.textContent).toBe("signed-out");
    await act(async () => finishA());
    await vi.waitFor(() => expect(harness.signOut).toHaveBeenCalledWith({ scope: "local" }));
    expect(container?.querySelector("[data-testid=viewer]")?.textContent).toBe("signed-out");
  });

  it("restores newer B when a cross-tab sign-out and delayed callback A overlap", async () => {
    const accountA = {
      access_token: "synthetic-access",
      refresh_token: "synthetic-refresh",
      user: { id: "account-a", email: "person@example.com" },
    } as Session;
    const accountB = {
      access_token: "access-b",
      refresh_token: "refresh-b",
      user: { id: "account-b", email: "b@example.com" },
    } as Session;
    let finishA!: () => void;
    harness.setSession.mockImplementation(({ access_token }: { access_token: string }) => {
      if (access_token === "access-b") {
        harness.authEvent?.("SIGNED_IN", accountB);
        return Promise.resolve({ data: { session: accountB }, error: null });
      }
      return new Promise((resolve) => {
        finishA = () => {
          harness.authEvent?.("SIGNED_IN", accountA);
          resolve({ data: { session: accountA }, error: null });
        };
      });
    });

    await mount();
    await vi.waitFor(() => expect(container?.textContent).toContain("Sign in as person@example.com?"));
    const continueButton = [...container!.querySelectorAll("button")].find((button) => button.textContent === "Continue");
    await act(async () => continueButton?.click());
    await vi.waitFor(() => expect(harness.setSession).toHaveBeenCalledOnce());

    await act(async () => harness.authEvent?.("SIGNED_OUT", null));
    await act(async () => harness.authEvent?.("SIGNED_IN", accountB));
    await act(async () => finishA());
    await vi.waitFor(() => expect(harness.setSession).toHaveBeenCalledTimes(2));
    expect(harness.setSession).toHaveBeenLastCalledWith({
      access_token: "access-b",
      refresh_token: "refresh-b",
    });
    expect(harness.signOut).not.toHaveBeenCalled();
    expect(container?.querySelector("[data-testid=viewer]")?.textContent).toBe("account-b");
  });

  it.each([false, true])(
    "lets later cross-tab logout win over pending B restore (later C: %s)",
    async (laterC) => {
      const accountA = {
        access_token: "synthetic-access", refresh_token: "synthetic-refresh",
        user: { id: "account-a", email: "person@example.com" },
      } as Session;
      const accountB = {
        access_token: "access-b", refresh_token: "refresh-b",
        user: { id: "account-b", email: "b@example.com" },
      } as Session;
      const accountC = {
        access_token: "access-c", refresh_token: "refresh-c",
        user: { id: "account-c", email: "c@example.com" },
      } as Session;
      let finishA!: () => void;
      let finishB!: () => void;
      harness.setSession.mockImplementation(({ access_token }: { access_token: string }) => {
        if (access_token === "access-b") {
          return new Promise((resolve) => {
            finishB = () => {
              harness.authEvent?.("SIGNED_IN", accountB);
              resolve({ data: { session: accountB }, error: null });
            };
          });
        }
        if (access_token === "access-c") {
          harness.authEvent?.("SIGNED_IN", accountC);
          return Promise.resolve({ data: { session: accountC }, error: null });
        }
        return new Promise((resolve) => {
          finishA = () => {
            harness.authEvent?.("SIGNED_IN", accountA);
            resolve({ data: { session: accountA }, error: null });
          };
        });
      });

      await mount();
      await vi.waitFor(() => expect(container?.textContent).toContain("Sign in as person@example.com?"));
      const continueButton = [...container!.querySelectorAll("button")].find((button) => button.textContent === "Continue");
      await act(async () => continueButton?.click());
      await vi.waitFor(() => expect(harness.setSession).toHaveBeenCalledOnce());
      await act(async () => harness.authEvent?.("SIGNED_OUT", null));
      await act(async () => harness.authEvent?.("SIGNED_IN", accountB));
      await act(async () => finishA());
      await vi.waitFor(() => expect(harness.setSession).toHaveBeenCalledTimes(2));

      await act(async () => harness.authEvent?.("SIGNED_OUT", null));
      if (laterC) await act(async () => harness.authEvent?.("SIGNED_IN", accountC));
      await act(async () => finishB());

      if (laterC) {
        await vi.waitFor(() => expect(harness.setSession).toHaveBeenCalledTimes(3));
        expect(harness.setSession).toHaveBeenLastCalledWith({
          access_token: "access-c", refresh_token: "refresh-c",
        });
        expect(harness.signOut).not.toHaveBeenCalled();
        expect(container?.querySelector("[data-testid=viewer]")?.textContent).toBe("account-c");
      } else {
        await vi.waitFor(() => expect(harness.signOut).toHaveBeenCalledWith({ scope: "local" }));
        expect(container?.querySelector("[data-testid=viewer]")?.textContent).toBe("signed-out");
      }
    },
  );

  it("does not publish a pending callback confirmation after unmount", async () => {
    const finishBootstrap = deferBootstrap();
    await mount();
    await vi.waitFor(() => expect(harness.bootstrapSignal).not.toBeNull());

    await act(async () => root?.unmount());
    root = null;
    expect(harness.bootstrapSignal?.aborted).toBe(true);
    await act(async () => finishBootstrap({ status: "none" }));
    expect(container?.textContent).not.toContain("Sign in as person@example.com?");
    expect(harness.setSession).not.toHaveBeenCalled();
  });

  it.each(["Continue", "Cancel"])("publishes restored B before allowing %s under StrictMode", async (action) => {
    let finishBootstrap!: (value: unknown) => void;
    harness.bootstrap.mockImplementation(() => new Promise((resolve) => { finishBootstrap = resolve; }));
    await act(async () => {
      root?.render(createElement(StrictMode, null,
        createElement(AuthProvider, { clerkIntegrationConfigured: false }, createElement(ViewerProbe))));
    });
    expect(harness.bootstrap).toHaveBeenCalledOnce();
    expect(container?.querySelector('[data-testid="viewer"]')?.getAttribute("aria-busy")).toBe("true");
    expect(container?.textContent).not.toContain("Sign in as person@example.com?");
    expect(harness.setSession).not.toHaveBeenCalled();
    await act(async () => finishBootstrap({ status: "local", session: {
      access_token: "access-b", refresh_token: "refresh-b", user: { id: "account-b", email: "b@example.com" },
    } }));
    expect(container?.querySelector('[data-testid="viewer"]')?.textContent).toBe("account-b");
    expect(container?.querySelector('[data-testid="viewer"]')?.getAttribute("aria-busy")).toBe("false");
    expect(container?.textContent).toContain("Sign in as person@example.com?");
    const button = [...container!.querySelectorAll("button")].find((button) => button.textContent === action);
    await act(async () => button?.click());
    expect(container?.querySelector('[data-testid="viewer"]')?.textContent).toBe(action === "Continue" ? "account-a" : "account-b");
    expect(harness.setSession).toHaveBeenCalledTimes(action === "Continue" ? 1 : 0);
  });

  it("keeps an existing account active when the reader cancels another account's callback", async () => {
    harness.existingSession = {
      access_token: "existing-access-b",
      refresh_token: "existing-refresh-b",
      user: { id: "account-b", email: "existing@example.com" },
    };

    await mount();
    await vi.waitFor(() => {
      expect(container?.textContent).toContain("Sign in as person@example.com?");
      expect(container?.querySelector('[data-testid="viewer"]')?.textContent).toBe("account-b");
    });
    expect(harness.setSession).not.toHaveBeenCalled();

    const cancel = [...container!.querySelectorAll("button")].find((button) => button.textContent === "Cancel");
    await act(async () => cancel?.click());

    expect(container?.textContent).not.toContain("Sign in as person@example.com?");
    expect(container?.querySelector('[data-testid="viewer"]')?.textContent).toBe("account-b");
    expect(harness.setSession).not.toHaveBeenCalled();
  });

  it("shows the verified account and leaves session untouched when cancelled", async () => {
    await mount();
    await vi.waitFor(() => expect(container?.textContent).toContain("Sign in as person@example.com?"));
    expect(harness.setSession).not.toHaveBeenCalled();
    const cancel = [...container!.querySelectorAll("button")].find((button) => button.textContent === "Cancel");
    await act(async () => cancel?.click());
    expect(harness.setSession).not.toHaveBeenCalled();
    expect(container?.textContent).not.toContain("Sign in as person@example.com?");
  });

  it("installs an unowned callback only after Continue", async () => {
    await mount();
    await vi.waitFor(() => expect(container?.textContent).toContain("Sign in as person@example.com?"));
    expect(harness.setSession).not.toHaveBeenCalled();
    const continueButton = [...container!.querySelectorAll("button")].find((button) => button.textContent === "Continue");
    await act(async () => continueButton?.click());
    await vi.waitFor(() => expect(harness.setSession).toHaveBeenCalledOnce());
    expect(container?.textContent).toContain("Signed in as person@example.com.");
  });

  it("leaves an invalid unowned callback unsigned-in", async () => {
    harness.getUser.mockResolvedValue({ data: { user: null }, error: new Error("invalid") });
    await mount();
    await vi.waitFor(() => expect(container?.textContent).toContain("Sign-in could not be completed."));
    expect(harness.setSession).not.toHaveBeenCalled();
  });

  it("shows the ban notice for a refused unowned callback without installing it", async () => {
    harness.getUser.mockResolvedValue({ data: { user: null }, error: {
      code: "user_banned", message: "User is banned", status: 403,
    } });
    await mount();
    await vi.waitFor(() => expect(container?.textContent).toContain("This account has been banned"));
    expect(container?.textContent).not.toContain("Sign-in could not be completed.");
    expect(container?.textContent).not.toContain("Sign in as");
    expect(harness.setSession).not.toHaveBeenCalled();
  });

  it("does not offer confirmation for mismatched access and refresh identities", async () => {
    harness.getUser.mockImplementation(async (accessToken: string) => ({
      data: { user: accessToken === "synthetic-access"
        ? { id: "account-a", email: "a@example.com" }
        : { id: "account-b", email: "b@example.com" } },
      error: null,
    }));
    harness.mintSession.mockResolvedValue({
      status: "minted",
      session: { access_token: "access-b", refresh_token: "refresh-b" },
    });
    await mount();
    await vi.waitFor(() => expect(container?.textContent).toContain("Sign-in could not be completed."));
    expect(container?.textContent).not.toContain("Sign in as a@example.com?");
    expect(harness.setSession).not.toHaveBeenCalled();
  });

  it("completes a locally owned callback without a confirmation step", async () => {
    harness.localAttemptOwned = true;
    await mount();
    await vi.waitFor(() => expect(harness.setSession).toHaveBeenCalledOnce());
    expect(harness.getUser).not.toHaveBeenCalled();
    expect(container?.textContent).not.toContain("Sign in as person@example.com?");
  });

  it("does not restore a locally owned callback after explicit logout overtakes its install", async () => {
    harness.localAttemptOwned = true;
    const accountA = {
      access_token: "synthetic-access",
      refresh_token: "synthetic-refresh",
      user: { id: "account-a", email: "person@example.com" },
    } as Session;
    let finishA!: () => void;
    harness.setSession.mockImplementation(() => new Promise((resolve) => {
      finishA = () => {
        harness.authEvent?.("SIGNED_IN", accountA);
        resolve({ data: { session: accountA }, error: null });
      };
    }));

    await mount();
    await vi.waitFor(() => expect(harness.setSession).toHaveBeenCalledOnce());
    await act(async () => container?.querySelector<HTMLButtonElement>("[data-testid=sign-out]")?.click());
    expect(container?.querySelector("[data-testid=viewer]")?.textContent).toBe("signed-out");

    await act(async () => finishA());
    expect(container?.querySelector("[data-testid=viewer]")?.textContent).toBe("signed-out");
    expect(container?.textContent).not.toContain("Signed in as person@example.com.");
  });

  it("retains a newer same-account login while a locally owned callback settles", async () => {
    harness.localAttemptOwned = true;
    const callbackA = {
      access_token: "synthetic-access", refresh_token: "synthetic-refresh",
      user: { id: "account-a", email: "person@example.com" },
    } as Session;
    const newerA = {
      access_token: "newer-access", refresh_token: "newer-refresh",
      user: { id: "account-a", email: "person@example.com" },
    } as Session;
    let finishA!: () => void;
    harness.setSession.mockImplementation(({ access_token }: { access_token: string }) => {
      if (access_token === "newer-access") {
        harness.authEvent?.("SIGNED_IN", newerA);
        return Promise.resolve({ data: { session: newerA }, error: null });
      }
      return new Promise((resolve) => {
        finishA = () => {
          harness.authEvent?.("SIGNED_IN", callbackA);
          resolve({ data: { session: callbackA }, error: null });
        };
      });
    });

    await mount();
    await vi.waitFor(() => expect(harness.setSession).toHaveBeenCalledOnce());
    await act(async () => container?.querySelector<HTMLButtonElement>("[data-testid=sign-out]")?.click());
    await act(async () => harness.authEvent?.("SIGNED_IN", newerA));
    await act(async () => finishA());
    await vi.waitFor(() => expect(harness.setSession).toHaveBeenCalledTimes(2));
    expect(harness.setSession).toHaveBeenLastCalledWith({
      access_token: "newer-access", refresh_token: "newer-refresh",
    });
    expect(harness.signOut).not.toHaveBeenCalled();
    expect(container?.querySelector("[data-testid=viewer]")?.textContent).toBe("account-a");
  });

  it("clears a locally owned callback install after cross-tab sign-out", async () => {
    harness.localAttemptOwned = true;
    const accountA = {
      access_token: "synthetic-access",
      refresh_token: "synthetic-refresh",
      user: { id: "account-a", email: "person@example.com" },
    } as Session;
    let finishA!: () => void;
    harness.setSession.mockImplementation(() => new Promise((resolve) => {
      finishA = () => {
        harness.authEvent?.("SIGNED_IN", accountA);
        resolve({ data: { session: accountA }, error: null });
      };
    }));

    await mount();
    await vi.waitFor(() => expect(harness.setSession).toHaveBeenCalledOnce());
    await act(async () => harness.authEvent?.("SIGNED_IN", {
      access_token: "access-b",
      refresh_token: "refresh-b",
      user: { id: "account-b", email: "b@example.com" },
    } as Session));
    await act(async () => harness.authEvent?.("SIGNED_OUT", null));
    await act(async () => finishA());

    await vi.waitFor(() => expect(harness.signOut).toHaveBeenCalledWith({ scope: "local" }));
    expect(container?.querySelector("[data-testid=viewer]")?.textContent).toBe("signed-out");
  });
});
