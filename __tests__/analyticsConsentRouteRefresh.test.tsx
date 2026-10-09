// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => window.location.pathname }));

import AnalyticsConsentPrompt from "@/components/AnalyticsConsentPrompt";
import { analyticsConsentDecision } from "@/lib/analytics";
import { consentAnswerMoment } from "@/lib/consentAnswerMoment";
import { promptBudgetHolder } from "@/lib/promptBudget";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.stubGlobal("navigator", { geolocation: {}, doNotTrack: "0" });
  vi.stubGlobal("matchMedia", () => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function navigate(pathname: string): Promise<void> {
  window.history.pushState(null, "", pathname);
  await act(async () => root.render(createElement(AnalyticsConsentPrompt)));
}

function prompt(): Element | null {
  return container.querySelector('[aria-label="Anonymous analytics choice"]');
}

describe("analytics consent across client route changes", () => {
  it.each(["/map", "/map/london"])("refreshes on returning from %s without another answer event", async (mapPath) => {
    await navigate("/places");
    expect(prompt()).toBeNull();
    expect(consentAnswerMoment()).toBeNull();
    expect(promptBudgetHolder()).toBeNull();

    await navigate(mapPath);
    expect(consentAnswerMoment()).toBe("second-route");
    expect(prompt()).toBeNull();
    expect(promptBudgetHolder()).toBeNull();

    await navigate("/places");
    expect(prompt()).not.toBeNull();
    expect(promptBudgetHolder()).toBe("analytics-consent");
    expect(analyticsConsentDecision()).toBeNull();

    const decline = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "No thanks");
    expect(decline).toBeDefined();
    await act(async () => decline!.click());
    expect(prompt()).toBeNull();
    expect(analyticsConsentDecision()).toBe("denied");
    await navigate(mapPath);
    await navigate("/places");
    expect(prompt()).toBeNull();
    expect(analyticsConsentDecision()).toBe("denied");
  });

  it("shows on an ordinary second route and keeps the existing claim", async () => {
    await navigate("/places");
    expect(prompt()).toBeNull();
    await navigate("/tonight");
    expect(prompt()).not.toBeNull();
    expect(promptBudgetHolder()).toBe("analytics-consent");
    await navigate("/places");
    expect(prompt()).not.toBeNull();
    expect(promptBudgetHolder()).toBe("analytics-consent");
  });

  it("defers to a profile's own control without spending the slot", async () => {
    await navigate("/places");
    await navigate("/u/you");
    expect(prompt()).toBeNull();
    expect(promptBudgetHolder()).toBeNull();
    await navigate("/tonight");
    expect(prompt()).not.toBeNull();
    expect(promptBudgetHolder()).toBe("analytics-consent");
  });
});
