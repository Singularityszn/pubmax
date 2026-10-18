// @vitest-environment jsdom
import { act, createElement, useEffect, useState, type FunctionComponent } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Session, User } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LoginPage from "@/components/auth/LoginPage";
import SignInButton from "@/components/auth/SignInButton";
import { AuthContext, type AuthContextValue } from "@/components/auth/authContext";
import { readProviderAccountRevision, readProviderAccountSignal, setProviderIdentity } from "@/lib/authProviderRevision";
import { accountComposerAuth } from "@/lib/accountBoundFetch";

const LoginPageWithProps: FunctionComponent<NonNullable<Parameters<typeof LoginPage>[0]>> = LoginPage;

vi.mock("next/navigation", () => ({ usePathname: () => "/login" }));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));

// The real controls consume the public context. Controlled promises exercise
// UI ownership independently of the SDK cancellation regression in its sibling.
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
type Result = { error: string | null; navigating?: boolean };
let root: Root;
let host: HTMLDivElement;
let updateAccount: (user: User | null) => void;
let setMounted: (mounted: boolean) => void;
let start: ReturnType<typeof vi.fn<() => Promise<Result>>>;
let signOut: ReturnType<typeof vi.fn<() => Promise<void>>>;
let cancel: ReturnType<typeof vi.fn<AuthContextValue["cancelAuthAttempt"]>>;
const account: User = {
  id: "account-a", email: "a@example.test", user_metadata: {},
  app_metadata: {}, aud: "authenticated", created_at: "2026-10-14T00:00:00Z",
};

function Fixture({ surface, initialUser = null, addAccount = false }: { surface: "page" | "nav"; initialUser?: User | null; addAccount?: boolean }) {
  const [user, setUser] = useState(initialUser);
  const [mounted, mount] = useState(true);
  useEffect(() => { updateAccount = setUser; setMounted = mount; }, []);
  const session: Session | null = user ? {
    user, access_token: `ownership-access-${user.id}`, refresh_token: `ownership-refresh-${user.id}`,
    expires_in: 3600, token_type: "bearer",
  } : null;
  const providerAuthState = user ? "authenticated" : "signed-out";
  const value: AuthContextValue = {
    user, session, loading: false, configured: true,
    handle: null, identityResolved: true, clerkIntegrationConfigured: false,
    supabaseAuthState: providerAuthState, providerAuthState,
    accountRevision: readProviderAccountRevision(),
    retryIdentity: vi.fn(),
    rejectedContributionAuth: null,
    contributionAuth: accountComposerAuth(user?.id ?? null, session, null),
    invalidateContributionAuth: vi.fn(),
    getCurrentUserId: () => user?.id ?? null,
    socialProviders: { google: true, apple: true, microsoft: true }, socialProvidersResolved: true,
    signInWithGoogle: start, signInWithApple: start, signInWithMicrosoft: start,
    signInWithEmail: async () => ({ status: "sent", message: "Check your email." }),
    cancelAuthAttempt: cancel, signOut, welcomeBack: null,
    resumeSignIn: async () => ({ status: "sent", message: "Check your email." }),
    switchAccount: async () => ({ status: "switched", userId: "account-a" }),
  };
  return createElement(AuthContext.Provider, { value }, mounted
    ? surface === "page" ? createElement(LoginPageWithProps, { addAccount }) : createElement(SignInButton)
    : null);
}
function google(): HTMLButtonElement {
  const button = host.querySelector<HTMLButtonElement>('button[aria-label="Continue with Google"]');
  expect(button).not.toBeNull();
  return button!;
}
function alertText(): string | null {
  return host.querySelector('[role="alert"]')?.textContent ?? null;
}
async function click(button: HTMLButtonElement) { await act(async () => button.click()); }
async function pageShow(persisted = true) {
  await act(async () => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted })));
}
async function mount(surface: "page" | "nav", user: User | null = null, addAccount = false) {
  setProviderIdentity("supabase", user?.id ?? null);
  await act(async () => root.render(createElement(Fixture, { surface, initialUser: user, addAccount })));
}
function transition(user: User | null) {
  setProviderIdentity("supabase", user?.id ?? null);
  updateAccount(user);
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  localStorage.clear(); sessionStorage.clear();
  window.history.replaceState(null, "", "/login");
  vi.stubGlobal("fetch", async () => Response.json({}));
  setProviderIdentity("supabase", null); setProviderIdentity("clerk", null);
  start = vi.fn(); signOut = vi.fn(); cancel = vi.fn<AuthContextValue["cancelAuthAttempt"]>();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove();
  setProviderIdentity("supabase", null); setProviderIdentity("clerk", null);
  vi.unstubAllGlobals(); vi.restoreAllMocks();
});

describe.each(["page", "nav"] as const)("%s provider operation ownership", (surface) => {
  it.each(["success", "error", "reject"] as const)("releases controls after %s settlement", async (settlement) => {
    const result = deferred<Result>(); start.mockReturnValue(result.promise);
    await mount(surface); await click(google());
    expect(google().disabled).toBe(true);
    await act(async () => {
      if (settlement === "reject") result.reject(new Error("transport rejected"));
      else result.resolve({ error: settlement === "error" ? "Provider refused this attempt." : null });
    });
    expect(google().disabled).toBe(false);
    expect(host.querySelector<HTMLInputElement>('input[type="email"]')?.disabled).toBe(false);
    expect(alertText()?.trim() ?? null).toBe(settlement === "success" ? null : settlement === "error"
      ? "Provider refused this attempt." : "Sign-in could not be started. Try again.");
  });

  // The page is leaving for the provider, so a second tap must not start a
  // second attempt; a back-forward cache restore still releases the controls.
  it("keeps controls busy while the browser navigates to the provider", async () => {
    const result = deferred<Result>(); start.mockReturnValue(result.promise);
    await mount(surface); await click(google());
    await act(async () => result.resolve({ error: null, navigating: true }));
    expect(google().disabled).toBe(true);
    expect(alertText()).toBeNull();
    await pageShow();
    expect(google().disabled).toBe(false);
  });

  it("keeps a newer same-provider attempt busy after BFCache resets and stale completion", async () => {
    const old = deferred<Result>(); const current = deferred<Result>();
    start.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    await mount(surface); await click(google());
    await pageShow(false);
    expect(google().disabled).toBe(true); expect(cancel).not.toHaveBeenCalled();
    await pageShow();
    expect(cancel).toHaveBeenCalledOnce(); expect(google().disabled).toBe(false);
    await click(google()); expect(start).toHaveBeenCalledTimes(2);
    await act(async () => old.resolve({ error: "Obsolete provider error." }));
    expect(google().disabled).toBe(true); expect(alertText()).toBeNull();
    expect(cancel).toHaveBeenCalledOnce();
    await act(async () => current.resolve({ error: null }));
    expect(google().disabled).toBe(false);
  });

  it.each(["return", "refresh"] as const)("uses the captured account generation for %s", async (change) => {
    const pending = deferred<Result>(); start.mockReturnValue(pending.promise);
    await mount(surface); await click(google());
    const captured = readProviderAccountSignal();
    await act(async () => {
      if (change === "return") { transition(account); transition(null); }
      else transition(null);
    });
    expect(captured.aborted).toBe(change === "return");
    await act(async () => pending.resolve({ error: "Provider refused this attempt." }));
    expect(google().disabled).toBe(false);
    expect(alertText()?.trim() ?? null).toBe(change === "return" ? null : "Provider refused this attempt.");
  });

  it("releases only the old provider busy state after an account transition", async () => {
    const pending = deferred<Result>(); start.mockReturnValue(pending.promise);
    await mount(surface); await click(google());
    await act(async () => transition(account));
    const signOutButton = [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === "Sign out")!;
    expect(signOutButton.disabled).toBe(true);
    await act(async () => pending.resolve({ error: "Obsolete provider error." }));
    expect(signOutButton.disabled).toBe(false); expect(alertText()).toBeNull();
  });

  it("does not release a sign-out operation when an earlier provider settles", async () => {
    const provider = deferred<Result>(); const leaving = deferred<void>();
    start.mockReturnValue(provider.promise); signOut.mockReturnValue(leaving.promise);
    await mount(surface); await click(google());
    await act(async () => transition(account));
    await pageShow();
    const out = [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === "Sign out")!;
    await click(out); expect(signOut).toHaveBeenCalledOnce();
    await act(async () => transition(null));
    expect(google().disabled).toBe(true);
    await act(async () => provider.resolve({ error: "Obsolete provider error." }));
    expect(google().disabled).toBe(true); expect(alertText()).toBeNull();
    await act(async () => leaving.resolve());
    expect(google().disabled).toBe(false);
  });

  it("does not release a new provider operation when a reset sign-out settles", async () => {
    const leaving = deferred<void>(); const provider = deferred<Result>();
    start.mockReturnValue(provider.promise); signOut.mockReturnValue(leaving.promise);
    await mount(surface, account);
    const out = [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === "Sign out")!;
    await click(out); await act(async () => transition(null));
    await pageShow(); await click(google());
    await act(async () => leaving.resolve());
    expect(google().disabled).toBe(true);
    await act(async () => provider.resolve({ error: null }));
    expect(google().disabled).toBe(false);
  });

  it("does not publish a rejection or release a remounted operation after unmount", async () => {
    const old = deferred<Result>(); const current = deferred<Result>();
    start.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    await mount(surface); await click(google());
    await act(async () => setMounted(false));
    await act(async () => setMounted(true));
    await click(google());
    await act(async () => old.reject(new Error("obsolete rejection")));
    expect(google().disabled).toBe(true); expect(alertText()).toBeNull();
    expect(cancel).not.toHaveBeenCalled();
    await act(async () => current.resolve({ error: null }));
    expect(google().disabled).toBe(false);
  });
});


describe("signed-in Add account operation generation", () => {
  it.each(["return", "refresh"] as const)("retains the original account signal after %s", async (change) => {
    const pending = deferred<Result>(); start.mockReturnValue(pending.promise);
    await mount("page", account, true); await click(google());
    const captured = readProviderAccountSignal();
    await act(async () => {
      if (change === "return") transition({ ...account, id: "account-b" });
      transition({ ...account });
    });
    expect(captured.aborted).toBe(change === "return");
    await act(async () => pending.resolve({ error: "Provider refused this attempt." }));
    expect(google().disabled).toBe(false);
    expect(alertText()?.trim() ?? null).toBe(change === "return" ? null : "Provider refused this attempt.");
  });
});
