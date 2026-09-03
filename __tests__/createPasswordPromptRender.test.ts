// @vitest-environment jsdom

import { act, createElement } from "react";
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
  hasBudget: true,
  claimSucceeds: true,
  listeners: new Set<() => void>(),
}));
const releasePromptBudget = vi.hoisted(() => vi.fn());

vi.mock("next/link", () => ({
  default: ({ children, ...props }: { children: unknown; href: string }) =>
    createElement("a", props, children),
}));
vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => authState.current,
}));
vi.mock("@/lib/authedFetch", () => ({ authedActionFetch }));
vi.mock("@/lib/promptBudget", () => ({
  claimPromptBudget: () => budgetState.claimSucceeds,
  hasPromptBudgetFor: () => budgetState.hasBudget,
  releasePromptBudget,
  subscribePromptBudget: (onChange: () => void) => {
    budgetState.listeners.add(onChange);
    return () => budgetState.listeners.delete(onChange);
  },
}));

import CreatePasswordPrompt from "@/components/auth/CreatePasswordPrompt";
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
  releasePromptBudget.mockReset();
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
});
