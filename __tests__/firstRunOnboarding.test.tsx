// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
const slim = vi.hoisted(() => ({ load: vi.fn() }));

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
vi.mock("@/lib/venuesSlim", () => ({ loadSlimVenuesForCity: slim.load }));

import FirstRunOnboarding from "@/components/onboarding/FirstRunOnboarding";
import { readBudgetChoice } from "@/lib/onboardingFlow";

let container: HTMLDivElement;
let root: Root | null = null;

// Pubs around Soho (51.5136, -0.1365), cheapest first by price. Three sit inside
// the walkable ring so the answer is not widened.
const SOHO_PUBS = [
  { id: "a", name: "The Crown", lat: 51.514, lng: -0.137, cheapestPrice: 4.9, borough: "Westminster" },
  { id: "b", name: "The Lamb", lat: 51.5142, lng: -0.1355, cheapestPrice: 5.8, borough: "Westminster" },
  { id: "c", name: "The Anchor", lat: 51.5125, lng: -0.1372, cheapestPrice: 6.6, borough: "Westminster" },
  { id: "d", name: "The Swan", lat: 51.5131, lng: -0.1361, cheapestPrice: 7.4, borough: "Westminster" },
];

function buttonContaining(text: string): HTMLButtonElement {
  const button = [...container.querySelectorAll<HTMLButtonElement>("button")]
    .find((candidate) => candidate.textContent?.includes(text));
  if (!button) throw new Error(`Button not found: ${text}`);
  return button;
}

async function tap(text: string) {
  await act(async () => {
    buttonContaining(text).click();
  });
}

/** Resolve the slim-index read and the state update that follows it. */
async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function stubGeolocation(impl: (ok: PositionCallback, fail: PositionErrorCallback) => void) {
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: { getCurrentPosition: vi.fn(impl) },
  });
}

async function reachLocation() {
  await tap("Use London");
  await tap("£6 or less");
  await tap("Continue");
}

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.localStorage.clear();
  slim.load.mockResolvedValue(SOHO_PUBS);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(createElement(FirstRunOnboarding, { reviewedAreas: [{ name: "Clapham", transportAnchor: "Clapham North" }] }));
  });
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  root = null;
  container.remove();
  vi.clearAllMocks();
  Reflect.deleteProperty(navigator, "geolocation");
});

describe("first-run budget question", () => {
  it("states why it asks and what stays private, and holds Continue until answered", async () => {
    await tap("Use London");

    expect(container.querySelector("h1")?.textContent).toBe("What's a fair pint to you?");
    expect(container.textContent).toContain("We use this to count the pubs near you that come in under it.");
    expect(container.textContent).toContain("Only you see your answer. It stays on this device.");
    expect(buttonContaining("Continue").disabled).toBe(true);

    await tap("£6 or less");

    expect(buttonContaining("£6 or less").getAttribute("aria-pressed")).toBe("true");
    expect(buttonContaining("Continue").disabled).toBe(false);
    expect(readBudgetChoice()).toBe("six");
  });

  it("remembers the answer for the next visit", async () => {
    await tap("Use London");
    await tap("£7 or less");
    await act(async () => {
      root?.unmount();
    });
    root = createRoot(container);
    await act(async () => {
      root?.render(createElement(FirstRunOnboarding, { reviewedAreas: [] }));
    });
    await tap("Use London");

    expect(buttonContaining("£7 or less").getAttribute("aria-pressed")).toBe("true");
  });
});

describe("first-run location ask", () => {
  it("gives the reason on its own screen before the system prompt", async () => {
    stubGeolocation(() => {});
    await reachLocation();

    expect(container.querySelector("h1")?.textContent).toBe("Find the cheapest pint near you.");
    expect(container.textContent).toContain("We only use it to rank pubs nearby. Nothing is stored.");
    // The ask has not been made yet.
    expect(navigator.geolocation.getCurrentPosition).not.toHaveBeenCalled();
  });

  it("answers from the reader's own position and counts the pubs inside the budget", async () => {
    stubGeolocation((ok) =>
      ok({ coords: { latitude: 51.5136, longitude: -0.1365 } } as GeolocationPosition),
    );
    await reachLocation();
    await tap("Use my location");
    await settle();

    expect(container.querySelector("h1")?.textContent).toBe("£4.90 at The Crown.");
    expect(container.textContent).toMatch(/2 pubs within a \d+ minute walk come in at £6 or less\./);
    expect(container.textContent).toContain("The Lamb");
    expect(container.textContent).toContain("Pub list refreshed");
  });

  it("offers the patches when location is refused, and answers from the one picked", async () => {
    stubGeolocation((_ok, fail) =>
      fail({ code: 1, PERMISSION_DENIED: 1 } as GeolocationPositionError),
    );
    await reachLocation();
    await tap("Use my location");

    expect(container.textContent).toContain("No location, no problem. Pick where you're drinking.");
    await tap("Soho");
    await settle();

    expect(container.textContent).toContain("Cheapest listed around Soho");
    expect(container.querySelector("h1")?.textContent).toBe("£4.90 at The Crown.");
    expect(window.localStorage.getItem("pubmax:nightPatch:v1")).toContain("soho");
  });

  it("says so, and offers the patches, when nothing is priced where the reader is", async () => {
    slim.load.mockResolvedValue([]);
    stubGeolocation((ok) =>
      ok({ coords: { latitude: 53.4, longitude: -2.2 } } as GeolocationPosition),
    );
    await reachLocation();
    await tap("Use my location");
    await settle();

    expect(container.textContent).toContain("We don't list prices where you are yet. Pick a London patch.");
    expect(buttonContaining("Camden")).toBeTruthy();
  });

  it("holds an honest empty answer when a picked patch has no priced pubs", async () => {
    slim.load.mockResolvedValue([]);
    stubGeolocation((_ok, fail) =>
      fail({ code: 2, PERMISSION_DENIED: 1 } as GeolocationPositionError),
    );
    await reachLocation();
    await tap("Use my location");
    await tap("Brixton");
    await settle();

    expect(container.querySelector("h1")?.textContent).toBe("No listed prices around Brixton yet.");
  });
});

describe("first-run result and companion choice", () => {
  async function reachResult() {
    stubGeolocation((ok) =>
      ok({ coords: { latitude: 51.5136, longitude: -0.1365 } } as GeolocationPosition),
    );
    await reachLocation();
    await tap("Use my location");
    await settle();
  }

  it("lets the reader adjust the budget or the area from the result", async () => {
    await reachResult();

    await tap("Change budget");
    expect(container.querySelector("h1")?.textContent).toBe("What's a fair pint to you?");
    await tap("Continue");
    expect(container.querySelector("h1")?.textContent).toBe("Find the cheapest pint near you.");
  });

  it("preselects robin and enables planning when companion step opens", async () => {
    await reachResult();
    await tap("That looks right");

    const robin = buttonContaining("Circuit Robin");
    const plan = buttonContaining("Plan my night");
    expect(robin.getAttribute("aria-pressed")).toBe("true");
    expect(plan.disabled).toBe(false);
    expect(container.querySelector('img[alt="Pub Pal"]')).not.toBeNull();

    await tap("Greyhound");

    expect(robin.getAttribute("aria-pressed")).toBe("false");
    expect(buttonContaining("Greyhound").getAttribute("aria-pressed")).toBe("true");
    // The greyhound ships its own master, so the preview swaps the portrait
    // rather than keeping the robin's.
    const greyhoundImg = container.querySelector('img[alt="Pub Pal"]');
    expect(greyhoundImg?.getAttribute("src")).toContain("circuit-greyhound");

    await tap("Plan my night");
    expect(router.push).toHaveBeenCalledWith("/map?plan=1");
  });

  it("moves the progress bar one step per screen", async () => {
    const bar = () => container.querySelector('[role="progressbar"]');
    expect(bar()?.getAttribute("aria-valuenow")).toBe("1");
    await tap("Use London");
    expect(bar()?.getAttribute("aria-valuenow")).toBe("2");
    expect(bar()?.getAttribute("aria-valuemax")).toBe("5");
  });
});
