import { act as reactAct, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const authState = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
}));

const requestState = vi.hoisted(() => ({
  calls: [] as string[],
  responses: [] as Array<Response | Error>,
}));

vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => authState.current,
}));

vi.mock("@/lib/accountBoundFetch", () => ({
  captureAccountAuth: (userId: string | null, session: { access_token?: string } | null) =>
    userId && session?.access_token
      ? { userId, accessToken: session.access_token }
      : null,
  accountBoundFetch: async (
    _auth: unknown,
    input: RequestInfo | URL,
  ) => {
    requestState.calls.push(String(input));
    const response = requestState.responses.shift() ?? Response.json({ complete: true });
    if (response instanceof Error) throw response;
    return response;
  },
}));

import AccountOnboarding, {
  AccountOnboardingLoadError,
} from "@/components/identity/AccountOnboarding";

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
  defaultView: unknown;
  documentElement: TestElement;
  body: TestElement;
  activeElement: TestElement;
  visibilityState: DocumentVisibilityState = "visible";

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

async function commit(work: () => void | Promise<void>): Promise<void> {
  if (typeof reactAct === "function") {
    await reactAct(work);
    return;
  }
  work();
  await Promise.resolve();
}

function settleOnboarding(): Promise<void> {
  return commit(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  authState.current = {
    user: { id: "user-a" },
    session: { user: { id: "user-a" }, access_token: "token-a" },
    loading: false,
    identityResolved: false,
  };
  requestState.calls = [];
  requestState.responses = [];

  const document = new TestDocument();
  const window = Object.assign(new EventTarget() as EventTarget & {
    document: TestDocument;
    navigator: { onLine: true },
    setTimeout: typeof setTimeout;
    clearTimeout: typeof clearTimeout;
    HTMLElement: typeof TestElement;
    HTMLIFrameElement: typeof HTMLIFrameElement;
    Node: typeof TestNode;
    localStorage: {
      getItem: () => null,
      setItem: (key: string, value: string) => void;
    },
    sessionStorage: Storage | null,
  }, {
    document,
    navigator: { onLine: true },
    setTimeout,
    clearTimeout,
    HTMLElement: TestElement,
    HTMLIFrameElement: class {},
    Node: TestNode,
    localStorage: {
      getItem: () => null,
      setItem: () => {},
    },
    sessionStorage: null,
  });
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
    await commit(() => root?.unmount());
    root = null;
  }
  Object.assign(globalThis, {
    window: previousWindow,
    document: previousDocument,
    IS_REACT_ACT_ENVIRONMENT: false,
  });
  vi.useRealTimers();
});

describe("AccountOnboarding cold-open identity race", () => {
  it("does not read onboarding status without a live session", async () => {
    authState.current = {
      user: null,
      session: null,
      loading: false,
      identityResolved: true,
    };

    await commit(() => root?.render(createElement(AccountOnboarding)));

    expect(requestState.calls).toHaveLength(0);
    expect(container.childNodes).toHaveLength(0);
  });

  it("waits for identity resolution before reading onboarding status", async () => {
    await commit(() => root?.render(createElement(AccountOnboarding)));
    expect(requestState.calls).toHaveLength(0);

    authState.current.identityResolved = true;
    await commit(() => root?.render(createElement(AccountOnboarding)));

    await vi.waitFor(() => expect(requestState.calls).toHaveLength(1));
    expect(requestState.calls).toEqual(["/api/identity/onboarding"]);
  });

  it("does not restart the status read when an identity event rerenders its parent", async () => {
    requestState.responses = Array.from({ length: 20 }, () =>
      Response.json({ complete: true, handle: "night_owl" }),
    );
    authState.current.identityResolved = true;

    await commit(() => root?.render(createElement(AccountOnboarding)));
    await settleOnboarding();
    for (let rerender = 0; rerender < 5; rerender += 1) {
      await commit(() => root?.render(createElement(AccountOnboarding)));
      await settleOnboarding();
    }

    expect(requestState.calls).toHaveLength(1);
  });

  it("retries one failed authenticated read before showing a failure", async () => {
    vi.useFakeTimers();
    requestState.responses = [
      new TypeError("Failed to fetch"),
      Response.json({ complete: true }),
    ];
    authState.current.identityResolved = true;

    await commit(() => root?.render(createElement(AccountOnboarding)));
    await commit(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(requestState.calls).toHaveLength(1);

    await commit(() => {
      vi.advanceTimersByTime(249);
    });
    expect(requestState.calls).toHaveLength(1);
    await commit(() => {
      vi.advanceTimersByTime(1);
    });
    await commit(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(requestState.calls).toHaveLength(2);
    expect(requestState.calls).toEqual([
      "/api/identity/onboarding",
      "/api/identity/onboarding",
    ]);
    vi.useRealTimers();
  });

  it("keeps the quiet loading state while a failed read is retrying", async () => {
    vi.useFakeTimers();
    requestState.responses = [
      new TypeError("Failed to fetch"),
      Response.json({ complete: true }),
    ];
    authState.current.identityResolved = true;

    await commit(() => root?.render(createElement(AccountOnboarding)));
    await settleOnboarding();

    expect(requestState.calls).toHaveLength(1);
    expect(container.childNodes).toHaveLength(0);

    await commit(() => {
      vi.advanceTimersByTime(250);
    });
    await settleOnboarding();

    expect(requestState.calls).toHaveLength(2);
    expect(container.childNodes).toHaveLength(0);
    vi.useRealTimers();
  });

  it("shows persistent failure only after the quiet retry, inline", async () => {
    vi.useFakeTimers();
    requestState.responses = [
      new TypeError("Failed to fetch"),
      new TypeError("Failed to fetch"),
      new TypeError("Failed to fetch"),
    ];
    authState.current.identityResolved = true;

    await commit(() => root?.render(createElement(AccountOnboarding)));
    await commit(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    await commit(() => {
      vi.advanceTimersByTime(250);
    });
    await commit(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    await commit(() => {
      vi.advanceTimersByTime(1_500);
    });
    await commit(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(requestState.calls).toHaveLength(3);
    expect(container.childNodes[0]?.nodeName).toBe("SECTION");
    vi.useRealTimers();
  });

  it("reloads an unavailable status after connectivity returns without caching identity", async () => {
    vi.useFakeTimers();
    window.setTimeout = setTimeout;
    window.clearTimeout = clearTimeout;
    const sessionValues = new Map<string, string>();
    window.sessionStorage = {
      get length() {
        return sessionValues.size;
      },
      clear: () => sessionValues.clear(),
      getItem: (key: string) => sessionValues.get(key) ?? null,
      key: (index: number) => Array.from(sessionValues.keys())[index] ?? null,
      removeItem: (key: string) => sessionValues.delete(key),
      setItem: (key: string, value: string) => sessionValues.set(key, value),
    } as Storage;
    requestState.responses = [
      new TypeError("Failed to fetch"),
      new TypeError("Failed to fetch"),
      new TypeError("Failed to fetch"),
      Response.json({ complete: true, handle: "night_owl" }),
    ];
    authState.current.identityResolved = true;

    await commit(() => root?.render(createElement(AccountOnboarding)));
    await settleOnboarding();
    await commit(() => {
      vi.advanceTimersByTime(250);
    });
    await settleOnboarding();
    await commit(() => {
      vi.advanceTimersByTime(1_500);
    });
    await settleOnboarding();
    expect(requestState.calls).toHaveLength(3);
    expect(container.childNodes[0]?.nodeName).toBe("SECTION");
    expect(sessionValues).toEqual(new Map());

    await commit(() => {
      window.dispatchEvent(new Event("online"));
    });
    await commit(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    await settleOnboarding();

    expect(requestState.calls).toHaveLength(4);
    expect(container.childNodes).toHaveLength(0);
    expect(sessionValues).toEqual(new Map());
    vi.useRealTimers();
  });

  it("keeps persistent read failure inline instead of taking over the surface", () => {
    const html = renderToStaticMarkup(
      createElement(AccountOnboardingLoadError, {
        error: "Account setup is unavailable right now.",
        onRetry: () => {},
      }),
    );
    expect(html).toContain("Account setup is unavailable right now.");
    expect(html).toContain("Try again");
    expect(html).toContain('role="alert"');
    expect(html).not.toContain('role="dialog"');
    expect(html).not.toContain('aria-modal="true"');
    expect(html).not.toContain("accountOnboardingBackdrop");
  });
});
