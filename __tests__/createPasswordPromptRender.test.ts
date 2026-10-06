// @vitest-environment jsdom

import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({
  current: {
    configured: true,
    identityResolved: true,
    user: { id: "acct-1" },
  },
}));
const authedActionFetch = vi.hoisted(() => vi.fn());
const budgetState = vi.hoisted(() => ({
  holder: null as string | null,
  hasBudget: true,
  claimSucceeds: true,
  listeners: new Set<() => void>(),
}));
const releasePromptBudget = vi.hoisted(() => vi.fn());
const navigation = vi.hoisted(() => ({ pathname: "/tonight" }));

vi.mock("next/link", () => ({
  default: ({ children, ...props }: { children: ReactNode; href: string }) =>
    createElement("a", props, children),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
}));
vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => authState.current,
}));
vi.mock("@/lib/authedFetch", () => ({ authedActionFetch }));
vi.mock("@/lib/promptBudget", async (importOriginal) => ({
  // The route rule is the real one: it is the answer this card is asked about.
  routeOwnsScreenFoot: (await importOriginal<typeof import("@/lib/promptBudget")>())
    .routeOwnsScreenFoot,
  // The real module WRITES a holder and publishes it; a mock that only answered
  // "did the claim succeed" could not model the question the card actually
  // asks, which is whether IT holds the budget right now.
  claimPromptBudget: (surface: string) => {
    if (!budgetState.claimSucceeds) return false;
    budgetState.holder = surface;
    // The real module publishes every budget change, which is how a subscriber
    // learns it now holds the budget. A mock that mutated silently would leave
    // the card waiting for news that never came.
    for (const listener of budgetState.listeners) listener();
    return true;
  },
  promptBudgetHolder: () => budgetState.holder,
  hasPromptBudgetFor: () => budgetState.hasBudget,
  releasePromptBudget: (surface: string) => {
    if (budgetState.holder === surface) budgetState.holder = null;
    for (const listener of budgetState.listeners) listener();
    releasePromptBudget(surface);
  },
  subscribePromptBudget: (onChange: () => void) => {
    budgetState.listeners.add(onChange);
    return () => budgetState.listeners.delete(onChange);
  },
}));

import CreatePasswordPrompt from "@/components/auth/CreatePasswordPrompt";
import { forgetCurrentIdentityRead } from "@/lib/currentIdentityRead";
import {
  PASSWORD_PROMPT_DESTINATION,
  passwordPromptAnsweredKey,
} from "@/lib/passwordPrompt";

let container: HTMLDivElement;
let root: Root;

async function settle(): Promise<void> {
  for (let turn = 0; turn < 5; turn += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function renderPrompt(): Promise<void> {
  await act(async () => {
    root.render(createElement(CreatePasswordPrompt));
  });
  await settle();
}

function notifyBudget(): void {
  for (const listener of budgetState.listeners) listener();
}

beforeEach(() => {
  // The identity read is shared across surfaces for a moment (lib/currentIdentityRead.ts).
  forgetCurrentIdentityRead();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  authState.current = {
    configured: true,
    identityResolved: true,
    user: { id: "acct-1" },
  };
  authedActionFetch.mockReset().mockResolvedValue(
    Response.json({ handle: "karan", hasPassword: false }),
  );
  budgetState.hasBudget = true;
  budgetState.claimSucceeds = true;
  budgetState.listeners.clear();
  budgetState.holder = null;
  releasePromptBudget.mockReset();
  navigation.pathname = "/tonight";
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1024 });
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("CreatePasswordPrompt rendered behavior", () => {
  it("stays hidden when its budget claim loses a race, then shows when free", async () => {
    budgetState.claimSucceeds = false;
    await renderPrompt();

    expect(container.querySelector('[role="dialog"]')).toBeNull();

    budgetState.hasBudget = false;
    notifyBudget();
    await settle();

    budgetState.hasBudget = true;
    budgetState.claimSucceeds = true;
    notifyBudget();
    await settle();

    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it("neither claims nor paints on a phone-width map route", async () => {
    navigation.pathname = "/map/london";
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
    await renderPrompt();

    expect(authedActionFetch).toHaveBeenCalled();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(budgetState.holder).toBeNull();
  });

  it("still shows on the desktop map, which has no outing pill or dock at its foot", async () => {
    navigation.pathname = "/map/london";
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1280 });
    await renderPrompt();

    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    expect(budgetState.holder).not.toBeNull();
  });

  it("rechecks after another prompt releases the budget", async () => {
    budgetState.hasBudget = false;
    budgetState.claimSucceeds = false;
    await renderPrompt();

    expect(container.querySelector('[role="dialog"]')).toBeNull();

    budgetState.hasBudget = true;
    budgetState.claimSucceeds = true;
    notifyBudget();
    await settle();

    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it("renders an account link and spends marker on either answer", async () => {
    await renderPrompt();

    const link = container.querySelector<HTMLAnchorElement>("a");
    expect(link?.getAttribute("href")).toBe(PASSWORD_PROMPT_DESTINATION);
    expect(container.querySelector('input[type="password"]')).toBeNull();

    await act(async () => link?.click());

    expect(window.localStorage.getItem(passwordPromptAnsweredKey("acct-1"))).toBe("1");
    expect(releasePromptBudget).not.toHaveBeenCalled();
  });

  it("does not carry the previous account's status into a new account read", async () => {
    await renderPrompt();
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();

    let resolveStatus: ((response: Response) => void) | undefined;
    authedActionFetch.mockImplementationOnce(
      () => new Promise<Response>((resolve) => {
        resolveStatus = resolve;
      }),
    );
    authState.current = {
      configured: true,
      identityResolved: true,
      user: { id: "acct-2" },
    };

    await act(async () => {
      root.render(createElement(CreatePasswordPrompt));
      await Promise.resolve();
    });

    expect(container.querySelector('[role="dialog"]')).toBeNull();
    resolveStatus?.(Response.json({ handle: null, hasPassword: null }));
    await settle();
  });
});
