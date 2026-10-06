// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }));
const shell = vi.hoisted(() => ({ native: false, handoff: false }));

vi.mock("next/navigation", () => ({
  useRouter: () => router,
}));
vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => {
    const rest = { ...props };
    delete rest.fill;
    delete rest.priority;
    delete rest.sizes;
    return createElement("img", rest);
  },
}));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("@/lib/nativePlatform", () => ({ isNativeApp: () => shell.native }));
vi.mock("@/lib/nativeFirstRun", () => ({
  consumeNativeFirstRunHandoff: () => shell.handoff,
}));

import LandingHero from "@/components/landing/LandingHero";
import FirstRunOnboardingGate from "@/components/onboarding/FirstRunOnboardingGate";
import { hasSeenTour, markTourSeen } from "@/lib/firstRunTour";

// The landing hero is the web's one door into the first-run journey (THE FRONT
// DOOR, docs/rules/components-design-system-and-launch-primitives.md). A
// first-time visitor's tap opens the journey, a returning visitor's goes
// straight to /near, and the journey's Skip lands where the tap was going.

let container: HTMLDivElement;
let root: Root | null = null;

async function render(element: ReturnType<typeof createElement>) {
  await act(async () => {
    root?.render(element);
  });
}

function primaryHref(): string | null {
  const link = [...container.querySelectorAll("a")].find(
    (anchor) => anchor.textContent === "Cheapest pints near me",
  );
  return link?.getAttribute("href") ?? null;
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.localStorage.clear();
  window.sessionStorage.clear();
  shell.native = false;
  shell.handoff = false;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  root = null;
  container.remove();
  vi.clearAllMocks();
  window.history.replaceState(null, "", "/");
});

describe("the landing hero's primary", () => {
  it("opens the first-run journey for a first-time visitor", async () => {
    await render(createElement(LandingHero, { card: null, archive: {}, rail: [] }));

    expect(primaryHref()).toBe("/onboarding?start=web");
  });

  it("keeps /near for a returning visitor with the seen mark", async () => {
    markTourSeen();
    await render(createElement(LandingHero, { card: null, archive: {}, rail: [] }));

    expect(primaryHref()).toBe("/near?locate=1");
  });

  it("moves to /near as soon as the mark is recorded", async () => {
    await render(createElement(LandingHero, { card: null, archive: {}, rail: [] }));
    expect(primaryHref()).toBe("/onboarding?start=web");

    await act(async () => {
      markTourSeen();
    });

    expect(primaryHref()).toBe("/near?locate=1");
  });
});

describe("the first-run gate", () => {
  async function renderGate() {
    await render(createElement(FirstRunOnboardingGate, { reviewedAreas: [] }));
    await act(async () => {
      await Promise.resolve();
    });
  }

  function tapSkip() {
    const skip = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Skip",
    );
    if (!skip) throw new Error("Skip not found");
    act(() => skip.click());
  }

  it("lets the hero's start mark in, and a web Skip lands where the hero was going", async () => {
    window.history.replaceState(null, "", "/onboarding?start=web");
    await renderGate();

    expect(container.querySelector("h1")?.textContent).toBe("London is ready.");
    tapSkip();

    expect(hasSeenTour()).toBe(true);
    expect(router.replace).toHaveBeenCalledWith("/near?locate=1");
  });

  it("sends a start-marked visit that already holds the seen mark to the hero's door", async () => {
    markTourSeen();
    window.history.replaceState(null, "", "/onboarding?start=web");
    await renderGate();

    expect(container.querySelector("h1")).toBeNull();
    expect(router.replace).toHaveBeenCalledWith("/near?locate=1");
  });

  it("does not replay the journey on Back after the visitor finished it", async () => {
    window.history.replaceState(null, "", "/onboarding?start=web");
    await renderGate();
    expect(container.querySelector("h1")?.textContent).toBe("London is ready.");
    tapSkip();
    await act(async () => {
      root?.unmount();
    });
    vi.clearAllMocks();
    root = createRoot(container);
    await renderGate();

    expect(container.querySelector("h1")).toBeNull();
    expect(router.replace).toHaveBeenCalledWith("/near?locate=1");
  });

  it("returns a web visit without the start mark home", async () => {
    window.history.replaceState(null, "", "/onboarding");
    await renderGate();

    expect(container.querySelector("h1")).toBeNull();
    expect(router.replace).toHaveBeenCalledWith("/");
    expect(hasSeenTour()).toBe(false);
  });

  it("keeps the shell's Skip on Tonight", async () => {
    shell.native = true;
    shell.handoff = true;
    window.history.replaceState(null, "", "/onboarding");
    await renderGate();

    expect(container.querySelector("h1")?.textContent).toBe("London is ready.");
    tapSkip();

    expect(router.replace).toHaveBeenCalledWith("/tonight");
  });
});
