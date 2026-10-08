// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({ pathname: "/map" }));
vi.mock("next/navigation", () => ({ usePathname: () => navigation.pathname }));

import NativePushPrompt from "@/components/native/NativePushPrompt";
import { setMapFirstVisitArrivalCardVisible } from "@/lib/mapFirstVisitArrival";
import {
  markPushPromptDismissed,
  recordPlanHighIntentAction,
} from "@/lib/nativePushPrompt";
import { claimPromptBudget, promptBudgetHolder } from "@/lib/promptBudget";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(window, "Capacitor", {
    configurable: true,
    value: { isNativePlatform: () => true, getPlatform: () => "ios" },
  });
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
  markPushPromptDismissed();
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
  setMapFirstVisitArrivalCardVisible(false);
  navigation.pathname = "/map";
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  setMapFirstVisitArrivalCardVisible(false);
  Reflect.deleteProperty(window, "Capacitor");
});

async function renderPrompt(): Promise<void> {
  await act(async () => root.render(createElement(NativePushPrompt)));
}

describe("native push prompt lifecycle", () => {
  it("shows the useful-action ask when the previous map arrival card releases the next route", async () => {
    await renderPrompt();
    await act(async () => {
      recordPlanHighIntentAction();
      setMapFirstVisitArrivalCardVisible(true);
    });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(promptBudgetHolder()).toBeNull();

    navigation.pathname = "/tonight";
    await renderPrompt();
    expect(container.querySelector('[role="dialog"]')).toBeNull();

    // Route render can precede the map card's effect cleanup.
    await act(async () => setMapFirstVisitArrivalCardVisible(false));
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain("Know when tonight changes");
    expect(promptBudgetHolder()).toBe("native-push");
  });

  it("keeps an undecided consent choice and its session claim ahead of the useful-action ask", async () => {
    window.localStorage.removeItem("pubmaxx:analytics-consent:v1");
    navigation.pathname = "/tonight";
    await renderPrompt();
    await act(async () => recordPlanHighIntentAction());
    expect(container.querySelector('[role="dialog"]')).toBeNull();

    await act(async () => {
      claimPromptBudget("analytics-consent");
      window.localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
      window.dispatchEvent(new Event("storage"));
      setMapFirstVisitArrivalCardVisible(true);
    });
    await act(async () => setMapFirstVisitArrivalCardVisible(false));
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(promptBudgetHolder()).toBe("analytics-consent");
  });

  it("keeps Not now dismissed through budget changes until the next useful Plan", async () => {
    navigation.pathname = "/tonight";
    await renderPrompt();
    await act(async () => recordPlanHighIntentAction());
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    const later = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Not now",
    );
    expect(later).toBeDefined();
    await act(async () => later!.click());
    await act(async () => setMapFirstVisitArrivalCardVisible(true));
    await act(async () => setMapFirstVisitArrivalCardVisible(false));
    expect(container.querySelector('[role="dialog"]')).toBeNull();

    await act(async () => recordPlanHighIntentAction());
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    expect(window.localStorage.getItem("pubmax:nativePush:actionSeq:v1")).toBe("2");
    expect(promptBudgetHolder()).toBe("native-push");
  });
});
