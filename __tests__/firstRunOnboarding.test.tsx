// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
const slim = vi.hoisted(() => ({ load: vi.fn() }));
const native = vi.hoisted(() => ({ enabled: false }));

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
vi.mock("@/lib/venuesSlim", () => ({ loadSlimVenuesForCityResult: slim.load }));
vi.mock("@/lib/nativePlatform", () => ({
  isNativeApp: () => native.enabled,
  nativePlatform: () => native.enabled ? "ios" : null,
}));

import FirstRunOnboarding from "@/components/onboarding/FirstRunOnboarding";
import { hasSeenTour } from "@/lib/firstRunTour";
import { ONBOARDING_STEPS, readBudgetChoice, readPlannerHandoff } from "@/lib/onboardingFlow";
import { readHistoryStep } from "@/lib/useStepHistory";
import { decideEntry, readEntryContext } from "@/lib/entryDecision";

let container: HTMLDivElement;
let root: Root | null = null;
// "Plan my night" leaves the app router for a document load; the spy stands in.
const openPlanner = vi.fn();

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

/** jsdom walks history on later tasks, so let each popstate land inside act. */
async function historySettles() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
}

async function browserBack() {
  await act(async () => {
    window.history.back();
  });
  await historySettles();
}

async function browserForward() {
  await act(async () => {
    window.history.forward();
  });
  await historySettles();
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
  native.enabled = false;
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/");
  // jsdom has no layout to scroll; the spy records where each step asked to open.
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  slim.load.mockResolvedValue({ rows: SOHO_PUBS, status: "ready" });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      createElement(FirstRunOnboarding, {
        reviewedAreas: [{ name: "Clapham", transportAnchor: "Clapham North" }],
        skipHref: "/near?locate=1",
        openPlanner,
      }),
    );
  });
});

describe("interrupted native onboarding", () => {
  async function relaunch() {
    await act(async () => root?.unmount());
    window.sessionStorage.clear();
    window.history.replaceState(null, "", "/onboarding");
    root = createRoot(container);
    await act(async () => root?.render(createElement(FirstRunOnboarding, {
      reviewedAreas: [], skipHref: "/tonight", openPlanner,
    })));
  }

  it("resumes the location question and budget after a fresh session, until Skip", async () => {
    native.enabled = true;
    await reachLocation();
    await relaunch();

    expect(container.querySelector("h1")?.textContent).toBe("Find the cheapest pint near you.");
    expect(readBudgetChoice()).toBe("six");
    expect(decideEntry(readEntryContext("/"))).toEqual({
      kind: "route", href: "/onboarding", reason: "native-first-run",
    });

    await tap("Skip");
    expect(decideEntry(readEntryContext("/"))).toEqual({
      kind: "route", href: "/tonight", reason: "shell-cold-start",
    });
  });

  it("asks for location again when an interrupted result cannot be rebuilt", async () => {
    native.enabled = true;
    await reachLocation();
    await tap("Pick a London patch instead");
    await tap("Soho");
    await settle();
    expect(container.querySelector("h1")?.textContent).toContain("The Crown");

    await relaunch();
    expect(container.querySelector("h1")?.textContent).toBe("Find the cheapest pint near you.");
    expect(window.localStorage.getItem("pubmax:nativeFirstRun:step:v1")).toBe("location");
  });

  it("keeps the companion choice on relaunch, and Plan my night completes the journey", async () => {
    native.enabled = true;
    await reachLocation();
    await tap("Pick a London patch instead");
    await tap("Soho");
    await settle();
    await tap("That looks right");
    await tap("Black Cat");
    await relaunch();

    expect(container.querySelector("h1")?.textContent).toBe("Pick your Pub Pal.");
    expect(buttonContaining("Black Cat").getAttribute("aria-pressed")).toBe("true");
    await tap("Plan my night");
    expect(openPlanner).toHaveBeenCalledOnce();
    expect(decideEntry(readEntryContext("/"))).toEqual({
      kind: "route", href: "/tonight", reason: "shell-cold-start",
    });
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
    // A visit of its own is a new history entry, not a reload of this one.
    window.history.replaceState(null, "", "/");
    root = createRoot(container);
    await act(async () => {
      root?.render(createElement(FirstRunOnboarding, { reviewedAreas: [], skipHref: "/tonight" }));
    });
    await tap("Use London");

    expect(buttonContaining("£7 or less").getAttribute("aria-pressed")).toBe("true");
  });

  it("reopens on the step the reader was on after a reload, with the answer kept", async () => {
    await tap("Use London");
    await tap("£5 or less");
    await act(async () => {
      root?.unmount();
    });
    // The same history entry survives a reload.
    root = createRoot(container);
    await act(async () => {
      root?.render(createElement(FirstRunOnboarding, { reviewedAreas: [], skipHref: "/tonight" }));
    });

    expect(container.querySelector("h1")?.textContent).toBe("What's a fair pint to you?");
    expect(buttonContaining("£5 or less").getAttribute("aria-pressed")).toBe("true");
  });

  it("sends browser Back one step back, not out of the journey", async () => {
    await tap("Use London");
    await tap("£5 or less");
    await tap("Continue");
    expect(container.querySelector("h1")?.textContent).toBe("Find the cheapest pint near you.");

    await browserBack();
    expect(container.querySelector("h1")?.textContent).toBe("What's a fair pint to you?");
    expect(buttonContaining("£5 or less").getAttribute("aria-pressed")).toBe("true");
  });

  it("leaves no later step behind browser Back after an in-app Back", async () => {
    await tap("Use London");
    await tap("£5 or less");
    await tap("Continue");
    await tap("Back");
    await historySettles();
    expect(container.querySelector("h1")?.textContent).toBe("What's a fair pint to you?");

    await browserBack();
    expect(container.querySelector("h1")?.textContent).toBe("London is ready.");
  });
});

describe("first-run location ask", () => {
  it("gives the reason on its own screen before the system prompt", async () => {
    stubGeolocation(() => {});
    await reachLocation();

    expect(container.querySelector("h1")?.textContent).toBe("Find the cheapest pint near you.");
    expect(container.textContent).toContain("We only use it to rank pubs nearby. Your location is never stored.");
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
    // The fix is ranked in the browser and never written down.
    expect(JSON.stringify({ ...window.localStorage })).not.toMatch(/51\.513|-0\.136/);
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
    // "Your location is never stored" has to stay true: neither the fix nor the picked
    // patch is written anywhere.
    expect(window.localStorage.getItem("pubmax:nightPatch:v1")).toBeNull();
    expect(JSON.stringify({ ...window.localStorage })).not.toMatch(/soho|51\.51/i);
  });

  it("says so, and offers the patches, when nothing is priced where the reader is", async () => {
    slim.load.mockResolvedValue({ rows: [], status: "ready" });
    stubGeolocation((ok) =>
      ok({ coords: { latitude: 53.4, longitude: -2.2 } } as GeolocationPosition),
    );
    await reachLocation();
    await tap("Use my location");
    await settle();

    expect(container.textContent).toContain("We don't list prices where you are yet. Pick a London patch.");
    expect(buttonContaining("Camden")).toBeTruthy();
  });

  it("treats a fix far from London as outside coverage, never as pubs near the reader", async () => {
    stubGeolocation((ok) =>
      ok({ coords: { latitude: 53.4808, longitude: -2.2426 } } as GeolocationPosition),
    );
    await reachLocation();
    await tap("Use my location");
    await settle();

    expect(container.querySelector("h1")?.textContent).toBe("Find the cheapest pint near you.");
    expect(container.textContent).toContain("We don't list prices where you are yet. Pick a London patch.");
    expect(container.textContent).not.toContain("The Crown");

    // The answer that never landed leaves no screen behind browser Back.
    await browserBack();
    expect(container.querySelector("h1")?.textContent).toBe("What's a fair pint to you?");
    // Forward reaches the question, and its entry, not the answer's.
    await browserForward();
    await browserForward();
    expect(container.querySelector("h1")?.textContent).toBe("Find the cheapest pint near you.");
    expect(readHistoryStep(ONBOARDING_STEPS)).toBe("location");
    await browserBack();
    expect(container.querySelector("h1")?.textContent).toBe("What's a fair pint to you?");
  });

  it("holds an honest empty answer when a picked patch has no priced pubs", async () => {
    slim.load.mockResolvedValue({ rows: [], status: "ready" });
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

describe("first-run answers that arrive late or not at all", () => {
  it("asks the question again when Forward returns to an answer dropped by Back", async () => {
    stubGeolocation((_ok, fail) =>
      fail({ code: 1, PERMISSION_DENIED: 1 } as GeolocationPositionError),
    );
    slim.load.mockReturnValueOnce(new Promise(() => {}));
    await reachLocation();
    await tap("Use my location");
    await tap("Soho");
    expect(container.textContent).toContain("Working out your nearest pints.");

    await browserBack();
    expect(container.querySelector("h1")?.textContent).toBe("Find the cheapest pint near you.");
    await browserForward();
    await settle();

    expect(container.textContent).not.toContain("Working out your nearest pints.");
    expect(container.querySelector("h1")?.textContent).toBe("Find the cheapest pint near you.");
    // History holds the step on screen, so the next Back is one step back.
    expect(readHistoryStep(ONBOARDING_STEPS)).toBe("location");
    await browserBack();
    expect(container.querySelector("h1")?.textContent).toBe("What's a fair pint to you?");
  });

  it("shows a venue read that came back incomplete as unavailable, with a retry that answers", async () => {
    slim.load.mockResolvedValueOnce({ rows: [], status: "unavailable" });
    stubGeolocation((ok) =>
      ok({ coords: { latitude: 51.5136, longitude: -0.1365 } } as GeolocationPosition),
    );
    await reachLocation();
    await tap("Use my location");
    await settle();

    expect(container.querySelector("h1")?.textContent).toBe("We couldn\u2019t load prices just now.");
    expect(container.textContent).not.toContain("We don't list prices where you are yet.");

    await tap("Try again");
    await settle();

    expect(container.querySelector("h1")?.textContent).toBe("£4.90 at The Crown.");
  });

  it("shows a venue read that threw as unavailable, never as an empty patch", async () => {
    slim.load.mockRejectedValueOnce(new Error("offline"));
    stubGeolocation((_ok, fail) =>
      fail({ code: 1, PERMISSION_DENIED: 1 } as GeolocationPositionError),
    );
    await reachLocation();
    await tap("Use my location");
    await tap("Soho");
    await settle();

    expect(container.querySelector("h1")?.textContent).toBe("We couldn\u2019t load prices just now.");
    expect(container.textContent).not.toContain("No listed prices around Soho");
  });

  it("ignores a fix that lands after the reader picked a patch", async () => {
    const pending: { grant?: PositionCallback } = {};
    stubGeolocation((ok) => {
      pending.grant = ok;
    });
    await reachLocation();
    await tap("Use my location");
    expect(buttonContaining("Finding your location").disabled).toBe(true);
    await tap("Pick a London patch instead");
    await tap("Soho");
    await settle();
    expect(container.textContent).toContain("Cheapest listed around Soho");

    await act(async () => {
      pending.grant?.({ coords: { latitude: 51.5136, longitude: -0.1365 } } as GeolocationPosition);
    });
    await settle();

    expect(container.textContent).toContain("Cheapest listed around Soho");
    expect(container.textContent).not.toContain("near you");

    await tap("Change area");
    await historySettles();
    expect(buttonContaining("Use my location").disabled).toBe(false);
  });

  it("ignores a fix or a refusal that lands after the reader went back", async () => {
    const pending: { grant?: PositionCallback; refuse?: PositionErrorCallback } = {};
    stubGeolocation((ok, fail) => {
      pending.grant = ok;
      pending.refuse = fail;
    });
    await reachLocation();
    await tap("Use my location");
    await tap("Back");
    await historySettles();
    expect(container.querySelector("h1")?.textContent).toBe("What's a fair pint to you?");

    await act(async () => {
      pending.grant?.({ coords: { latitude: 51.5136, longitude: -0.1365 } } as GeolocationPosition);
      pending.refuse?.({ code: 1, PERMISSION_DENIED: 1 } as GeolocationPositionError);
    });
    await settle();

    expect(container.querySelector("h1")?.textContent).toBe("What's a fair pint to you?");
    await tap("Continue");
    expect(container.textContent).not.toContain("No location, no problem.");
    expect(buttonContaining("Use my location").disabled).toBe(false);
  });
});

describe("first-run skip", () => {
  it("records the seen mark and lands where the reader was going", async () => {
    expect(hasSeenTour()).toBe(false);
    await tap("Skip");

    expect(hasSeenTour()).toBe(true);
    expect(router.replace).toHaveBeenCalledWith("/near?locate=1");
  });

  it("unwinds the steps it pushed before it leaves", async () => {
    let stepWhenLeaving: string | null = "unset";
    router.replace.mockImplementation(() => {
      stepWhenLeaving = readHistoryStep(ONBOARDING_STEPS);
    });
    await tap("Use London");
    await tap("£5 or less");
    await tap("Continue");
    await tap("Skip");
    await historySettles();

    expect(router.replace).toHaveBeenCalledWith("/near?locate=1");
    // The entry the journey opened on: one Back from here is the page before.
    expect(stepWhenLeaving).toBe("london");
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
    await historySettles();
    expect(container.querySelector("h1")?.textContent).toBe("What's a fair pint to you?");
    await tap("Continue");
    expect(container.querySelector("h1")?.textContent).toBe("Find the cheapest pint near you.");

    // Change budget went back, so browser Back is the step before the budget.
    await tap("Back");
    await historySettles();
    await browserBack();
    expect(container.querySelector("h1")?.textContent).toBe("London is ready.");
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

    let stepWhenLeaving: string | null = "unset";
    openPlanner.mockImplementation(() => {
      stepWhenLeaving = readHistoryStep(ONBOARDING_STEPS);
    });
    await tap("Plan my night");
    await historySettles();
    expect(openPlanner).toHaveBeenCalledTimes(1);
    expect(router.push).not.toHaveBeenCalled();
    // The steps the journey pushed are unwound before the planner opens.
    expect(stepWhenLeaving).toBe("london");
  });

  it("moves the progress bar one step per screen", async () => {
    const bar = () => container.querySelector('[role="progressbar"]');
    expect(bar()?.getAttribute("aria-valuenow")).toBe("1");
    await tap("Use London");
    expect(bar()?.getAttribute("aria-valuenow")).toBe("2");
    expect(bar()?.getAttribute("aria-valuemax")).toBe("5");
  });

  it("opens each new step at the top, whatever the last one was scrolled to", async () => {
    const scrollTo = vi.mocked(window.scrollTo);
    scrollTo.mockClear();
    await tap("Use London");
    expect(scrollTo).toHaveBeenCalledWith(0, 0);

    // A choice on the same step is not a new screen and keeps the reader put.
    scrollTo.mockClear();
    await tap("£6 or less");
    expect(scrollTo).not.toHaveBeenCalled();

    await tap("Continue");
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
  });
});

describe("first-run handoff to the planner", () => {
  it("hands the planner the patch and the budget the reader chose", async () => {
    stubGeolocation((_ok, fail) =>
      fail({ code: 1, PERMISSION_DENIED: 1 } as GeolocationPositionError),
    );
    await tap("Use London");
    await tap("£5 or less");
    await tap("Continue");
    await tap("Use my location");
    await tap("Soho");
    await settle();
    await tap("That looks right");
    await tap("Plan my night");

    expect(readPlannerHandoff()).toEqual({
      patch: { lat: 51.5136, lng: -0.1365 },
      budget: "five",
    });
  });

  it("still hands the planner the patch after a reload on the companion step", async () => {
    stubGeolocation((_ok, fail) =>
      fail({ code: 1, PERMISSION_DENIED: 1 } as GeolocationPositionError),
    );
    await tap("Use London");
    await tap("£5 or less");
    await tap("Continue");
    await tap("Use my location");
    await tap("Soho");
    await settle();
    await tap("That looks right");
    await act(async () => {
      root?.unmount();
    });
    // The same history entry survives a reload.
    root = createRoot(container);
    await act(async () => {
      root?.render(createElement(FirstRunOnboarding, { reviewedAreas: [], skipHref: "/tonight", openPlanner }));
    });
    expect(container.querySelector("h1")?.textContent).toBe("Pick your Pub Pal.");

    await tap("Plan my night");
    await historySettles();

    expect(openPlanner).toHaveBeenCalledTimes(1);
    expect(readPlannerHandoff()).toEqual({
      patch: { lat: 51.5136, lng: -0.1365 },
      budget: "five",
    });
  });

  it("asks the location question again on Back after a reload on the companion step", async () => {
    stubGeolocation((_ok, fail) =>
      fail({ code: 1, PERMISSION_DENIED: 1 } as GeolocationPositionError),
    );
    await tap("Use London");
    await tap("£5 or less");
    await tap("Continue");
    await tap("Use my location");
    await tap("Soho");
    await settle();
    await tap("That looks right");
    await act(async () => {
      root?.unmount();
    });
    root = createRoot(container);
    await act(async () => {
      root?.render(createElement(FirstRunOnboarding, { reviewedAreas: [], skipHref: "/tonight", openPlanner }));
    });

    await tap("Back");
    await historySettles();

    expect(container.textContent).not.toContain("Working out your nearest pints.");
    expect(container.querySelector("h1")?.textContent).toBe("Find the cheapest pint near you.");
    // The question is the entry Back reached: one more Back is the budget.
    await browserBack();
    expect(container.querySelector("h1")?.textContent).toBe("What's a fair pint to you?");
  });

  it("keeps browser Back one step back after a reload on the companion step", async () => {
    stubGeolocation((_ok, fail) =>
      fail({ code: 1, PERMISSION_DENIED: 1 } as GeolocationPositionError),
    );
    await reachLocation();
    await tap("Use my location");
    await tap("Soho");
    await settle();
    await tap("That looks right");
    await act(async () => {
      root?.unmount();
    });
    root = createRoot(container);
    await act(async () => {
      root?.render(createElement(FirstRunOnboarding, { reviewedAreas: [], skipHref: "/tonight", openPlanner }));
    });

    await browserBack();
    expect(container.querySelector("h1")?.textContent).toBe("Find the cheapest pint near you.");
    expect(readHistoryStep(ONBOARDING_STEPS)).toBe("location");
    await browserBack();
    expect(container.querySelector("h1")?.textContent).toBe("What's a fair pint to you?");
  });

  it("returns to the answer on Back from the companion step", async () => {
    stubGeolocation((_ok, fail) =>
      fail({ code: 1, PERMISSION_DENIED: 1 } as GeolocationPositionError),
    );
    await reachLocation();
    await tap("Use my location");
    await tap("Soho");
    await settle();
    await tap("That looks right");
    await tap("Back");
    await historySettles();

    expect(container.textContent).toContain("Cheapest listed around Soho");
  });

  it("hands over the budget alone after a located answer, and keeps no coordinates", async () => {
    stubGeolocation((ok) =>
      ok({ coords: { latitude: 51.5136, longitude: -0.1365 } } as GeolocationPosition),
    );
    await tap("Use London");
    await tap("£7 or less");
    await tap("Continue");
    await tap("Use my location");
    await settle();
    await tap("That looks right");
    await tap("Plan my night");

    expect(readPlannerHandoff()).toEqual({ patch: null, budget: "seven" });
  });
});
