import { act as reactAct, createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
}));

vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => authState.current,
}));
vi.mock("@/components/auth/MagicLinkForm", () => ({
  default: () => createElement("span", null, "Email sign-in"),
}));
vi.mock("@/components/auth/SocialSignInButtons", () => ({
  default: () => createElement("span", null, "Social sign-in"),
}));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("@/lib/identityNudge", () => ({
  IDENTITY_NUDGE_FIRST_PAINT_GRACE_MS: 8_000,
  getIdentityNudgeClientSnapshot: () => "plan",
  getIdentityNudgeServerSnapshot: () => null,
  markIdentityNudgeAccepted: vi.fn(),
  markIdentityNudgeDismissed: vi.fn(),
  subscribeIdentityNudge: () => () => {},
}));
vi.mock("@/lib/promptBudget", () => ({
  claimPromptBudget: () => true,
  hasPromptBudgetFor: () => true,
}));
vi.mock("@/lib/useDismissOnEscape", () => ({
  useDismissOnEscape: vi.fn(),
}));

import IdentityNudge from "@/components/identity/IdentityNudge";

class TestNode {
  nodeType: number;
  nodeName: string;
  ownerDocument: TestDocument | null;
  parentNode: TestNode | null = null;
  childNodes: TestNode[] = [];

  constructor(nodeType: number, nodeName: string, ownerDocument: TestDocument | null) {
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
    this.childNodes = value ? [new TestNode(3, "#text", this.ownerDocument)] : [];
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

let root: Root | null = null;
let container: TestElement;
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

async function renderAfterGrace(): Promise<void> {
  await commitReactWork(() => {
    root?.render(createElement(IdentityNudge));
  });
  await commitReactWork(() => {
    vi.advanceTimersByTime(8_000);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  authState.current = {
    user: null,
    loading: false,
    configured: false,
    clerkIntegrationConfigured: false,
    socialProviders: { google: false, apple: false },
    signInWithGoogle: vi.fn(),
    signInWithApple: vi.fn(),
    signInWithEmail: vi.fn(),
    cancelAuthAttempt: vi.fn(),
  };

  const document = new TestDocument();
  const window = {
    document,
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
    setTimeout,
    clearTimeout,
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
  container = document.createElement("div");
  root = createRoot(container as unknown as Element);
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
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("IdentityNudge visibility", () => {
  it("stays hidden when Clerk has no product-identity bridge", async () => {
    vi.stubEnv(
      "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
      "pk_test_cmFyZS10cm91dC0yOS5jbGVyay5hY2NvdW50cy5kZXYk",
    );
    authState.current.clerkIntegrationConfigured = true;

    await renderAfterGrace();

    expect(container.childNodes).toHaveLength(0);
  });

  it("renders after grace when the product Supabase sign-in path is configured", async () => {
    authState.current.configured = true;

    await renderAfterGrace();

    expect(container.childNodes.length).toBeGreaterThan(0);
  });
});
