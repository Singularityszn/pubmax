// @vitest-environment jsdom

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

// The wizard stays real. Browser location callbacks exercise saved intake behavior.

vi.mock("server-only", () => ({}));

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) =>
    createElement("a", { href }, children),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/plan",
  useRouter: () => ({
    back: () => undefined,
    forward: () => undefined,
    refresh: () => undefined,
    push: () => undefined,
    replace: () => undefined,
    prefetch: () => Promise.resolve(),
  }),
}));

vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => ({ user: null, session: null, loading: false, identityResolved: true }),
}));

vi.mock("@/components/plan/PlanCultureOpener", () => ({ default: () => null }));
vi.mock("@/components/wanted/WantedPlanChips", () => ({ default: () => null }));

vi.mock("@/lib/analytics", () => ({
  trackEvent: () => undefined,
  trackMeaningfulCoreAction: () => undefined,
  laneSourceFromSearch: () => null,
}));

import PlanComposer from "@/components/plan/PlanComposer";
import { createPlanIntakeDraft, readPlanIntakeDraft, writePlanIntakeDraft } from "@/lib/planIntake";
import { writeRememberedArea } from "@/lib/nightPatches";

let root: Root | null = null;
let host: HTMLElement | null = null;
let locate: PositionCallback;
let refuse: PositionErrorCallback | undefined;

async function click(label: string): Promise<void> {
  await vi.waitFor(() => expect(Array.from(document.querySelectorAll("button"))
    .some((button) => button.textContent?.trim() === label)).toBe(true));
  await act(async () => {
    Array.from(document.querySelectorAll("button"))
      .find((button) => button.textContent?.trim() === label)!.click();
  });
}

const position: GeolocationPosition = {
  coords: {
    latitude: 51.527, longitude: -0.08, accuracy: 10,
    altitude: null, altitudeAccuracy: null, heading: null, speed: null,
    toJSON: () => ({}),
  },
  timestamp: 1,
  toJSON: () => ({}),
};

beforeEach(async () => {
  sessionStorage.clear();
  localStorage.clear();
  window.history.replaceState({}, "", "/plan");
  vi.stubGlobal("fetch", vi.fn(async () => new Response("[]", { status: 200 })));
  vi.stubGlobal("navigator", { geolocation: {
    getCurrentPosition: vi.fn((success: PositionCallback, error?: PositionErrorCallback) => {
      locate = success;
      refuse = error;
    }),
  } });
  host = document.createElement("div");
  document.body.append(host);
  await act(async () => {
    root = createRoot(host!);
    root.render(createElement(PlanComposer));
  });
});

afterEach(async () => {
  await act(async () => { root?.unmount(); });
  root = null;
  host?.remove();
  host = null;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("seeds the wizard from a location resolved asynchronously", async () => {
  await click("Guide me instead");
  await act(async () => {
    locate(position);
    await vi.dynamicImportSettled();
  });
  expect(readPlanIntakeDraft()?.answers.area).toBe("shoreditch");
});

it("keeps a chosen area when an earlier geolocation result arrives", async () => {
  await click("Guide me instead");
  await click("Camden");
  await act(async () => {
    locate(position);
    await vi.dynamicImportSettled();
  });
  expect(readPlanIntakeDraft()?.answers.area).toBe("camden");
});

it("uses the remembered area when geolocation fails", async () => {
  writeRememberedArea({ kind: "patch", id: "camden" });
  await click("Guide me instead");
  await act(async () => {
    refuse!({ code: 1, message: "Location denied", PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 });
    await vi.dynamicImportSettled();
  });
  expect(readPlanIntakeDraft()?.answers.area).toBe("camden");
});

it("does not persist a location after the wizard closes during resolution", async () => {
  await click("Guide me instead");
  await act(async () => {
    locate(position);
    root!.unmount();
    root = null;
    await vi.dynamicImportSettled();
  });
  expect(readPlanIntakeDraft()).toBeNull();
});

it("restores the unfinished guide after hydration", async () => {
  await act(async () => { root!.unmount(); });
  writePlanIntakeDraft(createPlanIntakeDraft({ kind: "patch", id: "camden" }));
  await act(async () => {
    root = createRoot(host!);
    root.render(createElement(PlanComposer));
    await vi.dynamicImportSettled();
  });
  await vi.waitFor(() => expect(document.querySelector("h2")?.textContent)
    .toBe("When are you heading out?"));
  expect(document.querySelector("#plan-describe-first-query")).toBeNull();
});
