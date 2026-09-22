import { act as reactAct, createElement, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const providerState = vi.hoisted(() => ({
  session: {
    access_token: "shared-session",
    user: { id: "account-a" },
  } as { access_token: string; user: { id: string } } | null,
  supabaseOAuth: vi.fn(),
  setSession: vi.fn(),
  authChange: null as null | ((
    event: "INITIAL_SESSION" | "SIGNED_IN" | "SIGNED_OUT" | "TOKEN_REFRESHED",
    session: {
      access_token: string;
      refresh_token: string;
      user: { id: string; email?: string };
    } | null,
  ) => void | Promise<void>),
}));

const clerkState = vi.hoisted(() => ({ configured: true }));

const authAvailability = vi.hoisted(() => ({
  guard: vi.fn(),
  loadSupabase: vi.fn(async () => ({ google: false, apple: false })),
}));

const authRedirect = vi.hoisted(() => ({
  begin: vi.fn(async () => ({
    ok: true as const,
    id: "attempt-id",
    callbackUrl: "http://localhost/auth-callback",
  })),
  scrub: vi.fn(),
}));

const authCallbackClient = vi.hoisted(() => ({
  establish: vi.fn(),
}));

const authBootstrap = vi.hoisted(() => ({
  run: vi.fn(),
}));

const accountPush = vi.hoisted(() => ({
  retire: vi.fn(),
  verifyInitial: vi.fn(),
  verifySignedOut: vi.fn(),
}));
const tokenQuarantine = vi.hoisted(() => ({ set: vi.fn() }));

vi.mock("@/components/identity/AccountOnboarding", () => ({
  default: () => null,
}));
vi.mock("@/components/identity/IdentityNudge", () => ({
  default: () => null,
}));
vi.mock("@/lib/analytics", () => ({
  trackEvent: vi.fn(),
}));
vi.mock("@/lib/authCallbackClient", () => ({
  clearLegacyPkceVerifiers: vi.fn(),
  establishAuthCallbackSession: authCallbackClient.establish,
}));
vi.mock("@/lib/authSessionBootstrap", async () => {
  const actual = await vi.importActual<typeof import("@/lib/authSessionBootstrap")>(
    "@/lib/authSessionBootstrap",
  );
  return {
    ...actual,
    bootstrapAuthSession: authBootstrap.run,
  };
});
vi.mock("@/lib/accountPushLifecycle", () => ({
  withRetiredAccountWebPush: async <T,>(
    accessToken: string | null | undefined,
    continuation: () => Promise<T>,
  ) => {
    const retirement = await accountPush.retire(accessToken);
    if (retirement.status === "unavailable") return { status: "unavailable" };
    return {
      status: "completed",
      retirement,
      value: await continuation(),
    };
  },
  withVerifiedInitialAccountPushOwner: async <T,>(
    ownerId: string,
    accessToken: string,
    continuation: () => Promise<T>,
  ) => {
    const retirement = await accountPush.verifyInitial(ownerId, accessToken);
    if (retirement.status === "unavailable") return { status: "unavailable" };
    return {
      status: "completed",
      retirement,
      value: await continuation(),
    };
  },
  withVerifiedInitialSignedOutAccountPush: async <T,>(
    continuation: () => Promise<T>,
  ) => {
    const retirement = await accountPush.verifySignedOut();
    if (retirement.status === "unavailable") return { status: "unavailable" };
    return {
      status: "completed",
      retirement,
      value: await continuation(),
    };
  },
}));
vi.mock("@/lib/authClient", () => ({
  ensureSupabaseBrowser: async () => ({
    auth: {
      getSession: async () => ({ data: { session: providerState.session } }),
      setSession: providerState.setSession,
      onAuthStateChange: (
        callback: NonNullable<typeof providerState.authChange>,
      ) => {
        providerState.authChange = callback;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      },
      signInWithOAuth: providerState.supabaseOAuth,
      signOut: vi.fn(),
    },
  }),
  isAuthConfigured: () => true,
  setAuthTokenAccessQuarantined: tokenQuarantine.set,
}));
vi.mock("@/lib/authProviderAvailability", () => ({
  guardSocialAuthProvider: authAvailability.guard,
  loadSocialAuthProviders: authAvailability.loadSupabase,
  NO_SOCIAL_AUTH_PROVIDERS: { google: false, apple: false },
}));
vi.mock("@/lib/authRedirect", () => ({
  AUTH_RETURN_FRAGMENT_RESTORED_EVENT: "pubmax:auth-fragment-restored",
  beginCanonicalAuthAttempt: authRedirect.begin,
  cancelAuthAttempt: vi.fn(),
  defaultEmailAuthNext: () => "/u/you",
  releaseAuthAttempt: vi.fn(),
  scrubAuthCallback: authRedirect.scrub,
  scrubLingeringAuthCallback: vi.fn(() => false),
}));
vi.mock("@/lib/identityClient", () => ({
  handleClaimRouteAfterSignIn: vi.fn(async () => null),
  IDENTITY_HANDLE_CHANGED_EVENT: "pubmax:identity-handle-changed",
  identityHandleForOwner: () => null,
  resolveCanonicalIdentity: async () => null,
}));
vi.mock("@/lib/referralClaimClient", () => ({
  claimSignupReferralFromAuthCallback: vi.fn(async () => undefined),
  withReferralSignupProof: vi.fn((attempt) => attempt),
}));

import {
  AuthProvider,
  useAuth,
  type AuthContextValue,
} from "@/components/auth/AuthProvider";
import { useContributionGate } from "@/components/identity/ContributionGateDialog";

class TestNode {
  nodeType: number;
  nodeName: string;
  ownerDocument: TestDocument | null;
  parentNode: TestNode | null = null;
  childNodes: TestNode[] = [];

  constructor(
    nodeType: number,
    nodeName: string,
    ownerDocument: TestDocument | null,
  ) {
    this.nodeType = nodeType;
    this.nodeName = nodeName;
    this.ownerDocument = ownerDocument;
  }

  addEventListener(): void {}
  removeEventListener(): void {}

  appendChild(child: TestNode): TestNode {
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }

  insertBefore(child: TestNode, before: TestNode | null): TestNode {
    child.parentNode = this;
    const index = before ? this.childNodes.indexOf(before) : -1;
    if (index < 0) this.childNodes.push(child);
    else this.childNodes.splice(index, 0, child);
    return child;
  }

  removeChild(child: TestNode): TestNode {
    const index = this.childNodes.indexOf(child);
    if (index >= 0) this.childNodes.splice(index, 1);
    child.parentNode = null;
    return child;
  }

  get firstChild(): TestNode | null {
    return this.childNodes[0] ?? null;
  }

  set textContent(value: string) {
    this.childNodes = value
      ? [new TestNode(3, "#text", this.ownerDocument)]
      : [];
  }
}

class TestElement extends TestNode {
  tagName: string;
  namespaceURI = "http://www.w3.org/1999/xhtml";
  style: Record<string, string> = {};

  constructor(tagName: string, ownerDocument: TestDocument) {
    super(1, tagName.toUpperCase(), ownerDocument);
    this.tagName = tagName.toUpperCase();
  }

  setAttribute(): void {}
  removeAttribute(): void {}
}

class TestDocument extends TestNode {
  defaultView: Record<string, unknown>;
  documentElement: TestElement;
  body: TestElement;
  activeElement: TestElement;

  constructor() {
    super(9, "#document", null);
    this.ownerDocument = this;
    this.documentElement = new TestElement("html", this);
    this.body = new TestElement("body", this);
    this.activeElement = this.body;
    this.defaultView = {};
  }

  createElement(tagName: string): TestElement {
    return new TestElement(tagName, this);
  }

  createElementNS(_namespace: string, tagName: string): TestElement {
    return new TestElement(tagName, this);
  }

  createTextNode(): TestNode {
    return new TestNode(3, "#text", this);
  }
}

type ConsumerState = {
  auth: AuthContextValue;
  requestContribution: ReturnType<typeof useContributionGate>["requestContribution"];
};

const consumers = new Map<string, ConsumerState>();
let root: Root | null = null;
let previousWindow: typeof globalThis.window | undefined;
let previousDocument: typeof globalThis.document | undefined;

async function commitReactWork(work: () => void | Promise<void>): Promise<void> {
  if (typeof reactAct === "function") {
    await reactAct(work);
    return;
  }

  let pending: void | Promise<void> = undefined;
  flushSync(() => {
    pending = work();
  });
  await pending;
}

function Consumer({ name }: { name: string }): ReactNode {
  const auth = useAuth();
  const { requestContribution } = useContributionGate();
  consumers.set(name, { auth, requestContribution });
  return null;
}

beforeEach(() => {
  consumers.clear();
  providerState.session = {
    access_token: "shared-session",
    user: { id: "account-a" },
  };
  clerkState.configured = true;
  providerState.supabaseOAuth.mockReset();
  providerState.supabaseOAuth.mockResolvedValue({ error: null });
  providerState.setSession.mockReset();
  providerState.setSession.mockResolvedValue({
    data: {
      session: {
        access_token: "account-b-access",
        refresh_token: "account-b-refresh",
        user: { id: "account-b" },
      },
    },
    error: null,
  });
  providerState.authChange = null;
  authAvailability.guard.mockReset();
  authAvailability.guard.mockResolvedValue({
    availability: { google: true, apple: false },
    result: { error: null },
  });
  authAvailability.loadSupabase.mockClear();
  authRedirect.begin.mockClear();
  authRedirect.scrub.mockReset();
  authRedirect.scrub.mockResolvedValue(null);
  authCallbackClient.establish.mockReset();
  authCallbackClient.establish.mockResolvedValue({
    session: {
      access_token: "account-b-access",
      refresh_token: "account-b-refresh",
      user: { id: "account-b" },
    },
    failed: false,
  });
  authBootstrap.run.mockReset();
  authBootstrap.run.mockImplementation(async () => providerState.session
    ? { status: "local", session: providerState.session }
    : { status: "none" });
  accountPush.retire.mockReset();
  accountPush.retire.mockResolvedValue({ status: "not_registered" });
  accountPush.verifyInitial.mockReset();
  accountPush.verifyInitial.mockResolvedValue({ status: "not_registered" });
  accountPush.verifySignedOut.mockReset();
  accountPush.verifySignedOut.mockResolvedValue({ status: "not_registered" });
  tokenQuarantine.set.mockReset();
  const document = new TestDocument();
  const window = {
    document,
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
    setTimeout,
    clearTimeout,
    location: { href: "http://localhost/map" },
    history: { state: null, replaceState: vi.fn() },
    localStorage: null,
    sessionStorage: null,
    HTMLElement: TestElement,
    HTMLIFrameElement: class {},
    Node: TestNode,
  };
  document.defaultView = window;
  previousWindow = globalThis.window;
  previousDocument = globalThis.document;
  Object.assign(globalThis, {
    window,
    document,
    IS_REACT_ACT_ENVIRONMENT: typeof reactAct === "function",
  });
});

afterEach(async () => {
  if (root) {
    await commitReactWork(() => root?.unmount());
    root = null;
  }
  Object.assign(globalThis, {
    window: previousWindow,
    document: previousDocument,
    IS_REACT_ACT_ENVIRONMENT: false,
  });
  vi.unstubAllEnvs();
});

describe("shared contribution auth invalidation", () => {
  it("blocks a live-session OAuth callback before installing the added account", async () => {
    authRedirect.scrub.mockResolvedValueOnce({
      attempt: {
        attemptId: null,
        tokens: {
          accessToken: "account-b-access",
          refreshToken: "account-b-refresh",
        },
        providerError: false,
      },
      cleanUrl: "http://localhost/map",
      localAttemptOwned: true,
      releaseCoordination: vi.fn(),
    });
    accountPush.retire.mockResolvedValueOnce({ status: "unavailable" });
    const container = globalThis.document.createElement("div");
    root = createRoot(container);

    await commitReactWork(async () => {
      root?.render(
        createElement(
          AuthProvider,
          { clerkIntegrationConfigured: false },
          createElement(Consumer, { name: "callback" }),
        ),
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(accountPush.retire).toHaveBeenCalledWith("shared-session");
    });
    expect(authCallbackClient.establish).not.toHaveBeenCalled();
    expect(providerState.setSession).not.toHaveBeenCalled();
  });

  it.each([
    {
      event: "SIGNED_IN" as const,
      nextSession: {
        access_token: "account-b-access",
        refresh_token: "account-b-refresh",
        user: { id: "account-b", email: "b@example.com" },
      },
      nextUserId: "account-b",
    },
    {
      event: "SIGNED_OUT" as const,
      nextSession: null,
      nextUserId: null,
    },
  ])("retires account A before applying a broadcast $event", async ({
    event,
    nextSession,
    nextUserId,
  }) => {
    const container = globalThis.document.createElement("div");
    root = createRoot(container);

    await commitReactWork(async () => {
      root?.render(
        createElement(
          AuthProvider,
          { clerkIntegrationConfigured: false },
          createElement(Consumer, { name: "broadcast" }),
        ),
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(consumers.get("broadcast")?.auth.user?.id).toBe("account-a");
      expect(providerState.authChange).not.toBeNull();
    });

    let finishRetirement!: () => void;
    accountPush.retire.mockImplementationOnce(
      () => new Promise((resolve) => {
        finishRetirement = () => resolve({ status: "not_registered" });
      }),
    );
    const transition = providerState.authChange?.(event, nextSession);
    await Promise.resolve();

    expect(accountPush.retire).toHaveBeenLastCalledWith("shared-session");
    expect(consumers.get("broadcast")?.auth.user?.id).toBe("account-a");

    await commitReactWork(async () => {
      finishRetirement();
      await transition;
    });
    await vi.waitFor(() => {
      expect(consumers.get("broadcast")?.auth.user?.id ?? null).toBe(nextUserId);
    });
  });

  it("quarantines token access and rendered identity when broadcast retirement fails", async () => {
    const container = globalThis.document.createElement("div");
    root = createRoot(container);
    await commitReactWork(async () => {
      root?.render(
        createElement(
          AuthProvider,
          { clerkIntegrationConfigured: false },
          createElement(Consumer, { name: "quarantine" }),
        ),
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(consumers.get("quarantine")?.auth.user?.id).toBe("account-a");
      expect(providerState.authChange).not.toBeNull();
    });

    accountPush.retire.mockResolvedValueOnce({ status: "unavailable" });
    await commitReactWork(async () => {
      await providerState.authChange?.("SIGNED_IN", {
        access_token: "account-b-access",
        refresh_token: "account-b-refresh",
        user: { id: "account-b" },
      });
    });

    expect(consumers.get("quarantine")?.auth.user).toBeNull();
    expect(consumers.get("quarantine")?.auth.contributionAuth).toBeNull();
    expect(tokenQuarantine.set).toHaveBeenLastCalledWith(true);

    accountPush.retire.mockResolvedValueOnce({ status: "not_registered" });
    await commitReactWork(async () => {
      await providerState.authChange?.("TOKEN_REFRESHED", {
        access_token: "account-b-access-2",
        refresh_token: "account-b-refresh-2",
        user: { id: "account-b" },
      });
    });
    await vi.waitFor(() => {
      expect(consumers.get("quarantine")?.auth.user?.id).toBe("account-b");
    });
    expect(accountPush.retire).toHaveBeenLastCalledWith("shared-session");
    expect(tokenQuarantine.set).toHaveBeenLastCalledWith(false);
  });

  it("does not publish a reloaded SDK session before durable push ownership is safe", async () => {
    providerState.session = {
      access_token: "account-b-access",
      user: { id: "account-b" },
    };
    accountPush.verifyInitial.mockResolvedValue({ status: "unavailable" });
    const container = globalThis.document.createElement("div");
    root = createRoot(container);

    await commitReactWork(async () => {
      root?.render(
        createElement(
          AuthProvider,
          { clerkIntegrationConfigured: false },
          createElement(Consumer, { name: "reload" }),
        ),
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    await vi.waitFor(() => {
      expect(accountPush.verifyInitial).toHaveBeenCalledWith(
        "account-b",
        "account-b-access",
      );
      expect(consumers.get("reload")?.auth.user).toBeNull();
    });
    expect(tokenQuarantine.set).toHaveBeenLastCalledWith(true);
  });

  it("does not publish cold signed-out state before stale push is retired", async () => {
    providerState.session = null;
    accountPush.verifySignedOut.mockResolvedValue({ status: "unavailable" });
    const container = globalThis.document.createElement("div");
    root = createRoot(container);
    await commitReactWork(async () => {
      root?.render(
        createElement(
          AuthProvider,
          { clerkIntegrationConfigured: false },
          createElement(Consumer, { name: "signed-out-reload" }),
        ),
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    await vi.waitFor(() => expect(providerState.authChange).not.toBeNull());
    await commitReactWork(async () => {
      await providerState.authChange?.("INITIAL_SESSION", null);
    });

    await vi.waitFor(() => {
      expect(accountPush.verifySignedOut).toHaveBeenCalled();
      expect(consumers.get("signed-out-reload")?.auth.user).toBeNull();
    });
    expect(tokenQuarantine.set).toHaveBeenLastCalledWith(true);
  });

  it("keeps bootstrap signed-out unavailable when stale push cleanup fails", async () => {
    providerState.session = null;
    authBootstrap.run.mockResolvedValueOnce({ status: "none" });
    accountPush.verifySignedOut.mockResolvedValue({ status: "unavailable" });
    const container = globalThis.document.createElement("div");
    root = createRoot(container);

    await commitReactWork(async () => {
      root?.render(
        createElement(
          AuthProvider,
          { clerkIntegrationConfigured: false },
          createElement(Consumer, { name: "bootstrap-unavailable" }),
        ),
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    await vi.waitFor(() => {
      expect(authBootstrap.run).toHaveBeenCalled();
      expect(accountPush.verifySignedOut).toHaveBeenCalled();
      expect(consumers.get("bootstrap-unavailable")?.auth.supabaseAuthState)
        .toBe("unavailable");
    });
    expect(consumers.get("bootstrap-unavailable")?.auth.providerAuthState)
      .toBe("unavailable");
    expect(tokenQuarantine.set).toHaveBeenLastCalledWith(true);
  });

  it("quarantines a conflicting bootstrap account when retirement fails", async () => {
    let resolveBootstrap!: (value: {
      status: "local";
      session: {
        access_token: string;
        refresh_token: string;
        user: { id: string };
      };
    }) => void;
    authBootstrap.run.mockImplementationOnce(() => new Promise((resolve) => {
      resolveBootstrap = resolve;
    }));
    const container = globalThis.document.createElement("div");
    root = createRoot(container);

    await commitReactWork(async () => {
      root?.render(
        createElement(
          AuthProvider,
          { clerkIntegrationConfigured: false },
          createElement(Consumer, { name: "bootstrap-conflict" }),
        ),
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(providerState.authChange).not.toBeNull();
      expect(authBootstrap.run).toHaveBeenCalled();
    });
    await commitReactWork(async () => {
      await providerState.authChange?.("INITIAL_SESSION", {
        access_token: "account-a-access",
        refresh_token: "account-a-refresh",
        user: { id: "account-a" },
      });
    });
    await vi.waitFor(() => {
      expect(consumers.get("bootstrap-conflict")?.auth.user?.id).toBe("account-a");
    });
    accountPush.retire.mockResolvedValueOnce({ status: "unavailable" });

    await commitReactWork(async () => {
      resolveBootstrap({
        status: "local",
        session: {
          access_token: "account-b-access",
          refresh_token: "account-b-refresh",
          user: { id: "account-b" },
        },
      });
      await Promise.resolve();
    });

    await vi.waitFor(() => {
      expect(accountPush.retire).toHaveBeenCalledWith("account-a-access");
      expect(consumers.get("bootstrap-conflict")?.auth.user).toBeNull();
      expect(consumers.get("bootstrap-conflict")?.auth.supabaseAuthState)
        .toBe("unavailable");
    });
    expect(tokenQuarantine.set).toHaveBeenLastCalledWith(true);
  });

  it("stops a second consumer from receiving a rejected token", async () => {
    const container = globalThis.document.createElement("div");
    root = createRoot(container);

    await commitReactWork(async () => {
      root?.render(
        createElement(
          AuthProvider,
          { clerkIntegrationConfigured: clerkState.configured },
          createElement(Consumer, { name: "visit" }),
          createElement(Consumer, { name: "weather" }),
        ),
      );
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await vi.waitFor(() => {
      expect(consumers.get("visit")?.auth.contributionAuth).toMatchObject({
        userId: "account-a",
        accessToken: "shared-session",
      });
      expect(consumers.get("weather")?.auth.contributionAuth).toMatchObject({
        userId: "account-a",
        accessToken: "shared-session",
      });
    });

    await commitReactWork(async () => {
      await consumers.get("visit")?.requestContribution(async () => ({
        status: "sign_in_required",
      }));
    });

    await vi.waitFor(() => {
      expect(consumers.get("weather")?.auth.contributionAuth).toBeNull();
    });

    let weatherActionCalled = false;
    await commitReactWork(async () => {
      await consumers.get("weather")?.requestContribution(async () => {
        weatherActionCalled = true;
      });
    });

    expect(consumers.get("weather")?.auth.contributionAuth).toBeNull();
    expect(weatherActionCalled).toBe(false);
  });

  it("keeps generic social sign-in on Supabase when Clerk account controls are available", async () => {
    const container = globalThis.document.createElement("div");
    root = createRoot(container);

    await commitReactWork(async () => {
      root?.render(
        createElement(
          AuthProvider,
          { clerkIntegrationConfigured: clerkState.configured },
          createElement(Consumer, { name: "social" }),
        ),
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    const auth = consumers.get("social")?.auth;
    expect(auth).toBeDefined();
    const supabaseLoadCallsBeforeClick = authAvailability.loadSupabase.mock.calls.length;

    await commitReactWork(async () => {
      await auth?.signInWithGoogle();
    });

    expect(authAvailability.guard).toHaveBeenCalledWith("google", expect.any(Function), expect.any(Function));
    const start = authAvailability.guard.mock.calls[0]?.[1] as (() => Promise<unknown>) | undefined;
    const load = authAvailability.guard.mock.calls[0]?.[2] as (() => Promise<unknown>) | undefined;
    await load?.();
    await start?.();

    expect(authAvailability.loadSupabase.mock.calls.length).toBe(
      supabaseLoadCallsBeforeClick + 1,
    );
    expect(providerState.supabaseOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: { redirectTo: "http://localhost/auth-callback" },
    });
  });

  it("uses an explicit destination for OAuth and welcome-back email callbacks", async () => {
    const container = globalThis.document.createElement("div");
    root = createRoot(container);
    const destination = "/add/karan?auto=1";

    await commitReactWork(async () => {
      root?.render(
        createElement(
          AuthProvider,
          { clerkIntegrationConfigured: false },
          createElement(Consumer, { name: "login" }),
        ),
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    authAvailability.guard.mockImplementationOnce(async (_provider, start) => ({
      availability: { google: true, apple: false },
      result: await start(),
    }));

    const auth = consumers.get("login")?.auth;
    await auth?.signInWithGoogle(destination);
    expect(authRedirect.begin).toHaveBeenLastCalledWith(
      "http://localhost/map",
      destination,
      expect.any(Object),
      expect.any(Function),
    );

    await auth?.resumeSignIn(destination);
    expect(authRedirect.begin).toHaveBeenLastCalledWith(
      "http://localhost/map",
      destination,
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("keeps the Supabase path without a product session even when Clerk is configured", async () => {
    providerState.session = null;
    const container = globalThis.document.createElement("div");
    root = createRoot(container);

    await commitReactWork(async () => {
      root?.render(
        createElement(
          AuthProvider,
          { clerkIntegrationConfigured: clerkState.configured },
          createElement(Consumer, { name: "social" }),
        ),
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    const auth = consumers.get("social")?.auth;
    expect(auth).toBeDefined();
    await commitReactWork(async () => {
      await auth?.signInWithGoogle();
    });

    const start = authAvailability.guard.mock.calls[0]?.[1] as (() => Promise<unknown>) | undefined;
    const load = authAvailability.guard.mock.calls[0]?.[2] as (() => Promise<unknown>) | undefined;
    await load?.();
    await start?.();

    expect(authAvailability.loadSupabase).toHaveBeenCalled();
    expect(providerState.supabaseOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: { redirectTo: "http://localhost/auth-callback" },
    });
  });

  it("keeps the Supabase path when only the Clerk publishable key is present", async () => {
    vi.stubEnv(
      "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
      "pk_test_cmFyZS10cm91dC0yOS5jbGVyay5hY2NvdW50cy5kZXYk",
    );
    clerkState.configured = false;
    const container = globalThis.document.createElement("div");
    root = createRoot(container);

    await commitReactWork(async () => {
      root?.render(
        createElement(
          AuthProvider,
          { clerkIntegrationConfigured: clerkState.configured },
          createElement(Consumer, { name: "social" }),
        ),
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    const supabaseLoadCallsBeforeClick = authAvailability.loadSupabase.mock.calls.length;
    expect(consumers.get("social")?.auth.clerkIntegrationConfigured).toBe(false);
    await commitReactWork(async () => {
      await consumers.get("social")?.auth.signInWithGoogle();
    });

    expect(authAvailability.guard).toHaveBeenCalledWith("google", expect.any(Function), expect.any(Function));

    const start = authAvailability.guard.mock.calls[0]?.[1] as (() => Promise<unknown>) | undefined;
    const load = authAvailability.guard.mock.calls[0]?.[2] as (() => Promise<unknown>) | undefined;
    await load?.();
    await start?.();

    expect(authAvailability.loadSupabase.mock.calls.length).toBe(supabaseLoadCallsBeforeClick + 1);
    expect(providerState.supabaseOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: { redirectTo: "http://localhost/auth-callback" },
    });
  });
});
