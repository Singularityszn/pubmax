import { act as reactAct, createElement, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const providerState = vi.hoisted(() => ({
  session: {
    access_token: "shared-session",
    user: { id: "account-a" },
  },
}));

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
  exchangeAuthCallbackCode: vi.fn(),
}));
vi.mock("@/lib/authClient", () => ({
  ensureSupabaseBrowser: async () => ({
    auth: {
      getSession: async () => ({ data: { session: providerState.session } }),
      onAuthStateChange: () => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      }),
      signOut: vi.fn(),
    },
  }),
  isAuthConfigured: () => true,
}));
vi.mock("@/lib/authProviderAvailability", () => ({
  guardSocialAuthProvider: vi.fn(),
  loadSocialAuthProviders: async () => ({ google: false, apple: false }),
  NO_SOCIAL_AUTH_PROVIDERS: { google: false, apple: false },
}));
vi.mock("@/lib/authRedirect", () => ({
  AUTH_RETURN_FRAGMENT_RESTORED_EVENT: "pubmax:auth-fragment-restored",
  beginCanonicalAuthAttempt: vi.fn(),
  cancelAuthAttempt: vi.fn(),
  releaseAuthAttempt: vi.fn(),
  scrubAuthCallback: async () => null,
}));
vi.mock("@/lib/identityClient", () => ({
  IDENTITY_HANDLE_CHANGED_EVENT: "pubmax:identity-handle-changed",
  identityHandleForOwner: () => null,
  resolveCanonicalIdentity: async () => null,
}));
vi.mock("@/lib/referralClaimClient", () => ({
  claimSignupReferralFromAuthCallback: vi.fn(),
  withReferralSignupProof: vi.fn(),
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
});

describe("shared contribution auth invalidation", () => {
  it("stops a second consumer from receiving a rejected token", async () => {
    const container = globalThis.document.createElement("div");
    root = createRoot(container);

    await commitReactWork(async () => {
      root?.render(
        createElement(
          AuthProvider,
          null,
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
});
