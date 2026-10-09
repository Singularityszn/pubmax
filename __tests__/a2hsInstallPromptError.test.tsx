// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/firstRunTour", () => ({ hasSeenTour: () => true }));
vi.mock("@/lib/crawlCompletion", () => ({ completedCrawlCount: () => 1 }));
vi.mock("@/lib/promptBudget", () => ({
  hasPromptBudgetFor: () => true,
  claimPromptBudget: () => true,
}));
vi.mock("@/lib/a2hsPrompt", async (original) => ({
  ...(await original<typeof import("@/lib/a2hsPrompt")>()),
  detectA2hsPlatform: () => "android",
}));

import A2HSInstallPrompt from "@/components/pwa/A2HSInstallPrompt";
import {
  clearA2hsInstallPrompt,
  storeA2hsInstallPrompt,
  type BeforeInstallPromptEvent,
} from "@/lib/a2hsInstallEvent";

let container: HTMLDivElement;
let root: Root | null = null;

async function settle(): Promise<void> {
  for (let turn = 0; turn < 4; turn += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  container.remove();
  clearA2hsInstallPrompt();
});

describe("A2HS install prompt", () => {
  it("tells the reader when the browser install prompt fails to start", async () => {
    const failingPrompt = Object.assign(new Event("beforeinstallprompt"), {
      platforms: ["web"],
      prompt: () => Promise.reject(new Error("prompt blocked")),
      userChoice: new Promise<never>(() => undefined),
    }) as BeforeInstallPromptEvent;
    storeA2hsInstallPrompt(failingPrompt);

    await act(async () => root?.render(createElement(A2HSInstallPrompt)));
    await settle();

    const install = [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "Install");
    expect(install).toBeTruthy();

    await act(async () => install!.click());
    await settle();

    expect(container.querySelector('[role="status"]')?.textContent)
      .toBe("Couldn't start the install. Try again.");
    expect(container.textContent).toContain("Install PUBMAXX");
  });
});
