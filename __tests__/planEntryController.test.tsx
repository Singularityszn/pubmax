// @vitest-environment jsdom

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) =>
    createElement("a", { href, className }, children),
}));

const routeQuery = vi.hoisted(() => ({ current: null as string | null }));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(routeQuery.current ?? window.location.search),
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
vi.mock("@/components/plan/PlanRouteMiniMap", () => ({ default: () => null }));

vi.mock("@/lib/analytics", () => ({
  trackEvent: () => undefined,
  trackMeaningfulCoreAction: () => undefined,
  laneSourceFromSearch: () => null,
}));

import PlanEntry from "@/components/plan/PlanEntry";
import { createPlanIntakeDraft, readPlanIntakeDraft, writePlanIntakeDraft } from "@/lib/planIntake";
import { writeRememberedArea } from "@/lib/nightPatches";

const GENERATED = {
  routeRevision: 1,
  groundingProof: "test-proof",
  stops: [
    { venueId: "venue-a", venueName: "Pub A", reason: "Close to the heart of the area." },
    { venueId: "venue-b", venueName: "Pub B", reason: "0.6 km from the area centre." },
  ],
  inferredContext: { nightArea: "clapham", daypart: "evening", groupSize: 4 },
};

let root: Root | null = null;
let host: HTMLElement | null = null;
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

beforeEach(() => {
  fetchMock = vi.fn<typeof fetch>(async (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    return new Response(JSON.stringify(url.includes("/api/plans/generate") ? GENERATED : []), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  sessionStorage.clear();
  localStorage.clear();
  window.history.replaceState({}, "", "/plan");
  routeQuery.current = null;
});

afterEach(async () => {
  if (root) {
    const current = root;
    await act(async () => { current.unmount(); });
  }
  root = null;
  host?.remove();
  host = null;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
  sessionStorage.clear();
  localStorage.clear();
});

async function settle(): Promise<void> {
  await act(async () => {
    for (let turn = 0; turn < 5; turn += 1) await Promise.resolve();
  });
}

async function mountComposer(strict = false, full = false): Promise<void> {
  const Composer = full ? (await import("@/components/plan/PlanComposer")).default : PlanEntry;
  host = document.createElement("div");
  document.body.append(host);
  await act(async () => {
    root = createRoot(host!);
    root.render(strict ? createElement(StrictMode, null, createElement(Composer)) : createElement(Composer));
  });
  await settle();
}

async function sortIt(query: string): Promise<void> {
  const field = document.querySelector<HTMLInputElement>("#plan-describe-first-query")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, query);
    field.dispatchEvent(new Event("input", { bubbles: true }));
    [...document.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Sort it")!.click();
    await Promise.resolve();
  });
  await act(async () => { await vi.dynamicImportSettled(); });
  await settle();
  await act(async () => { await vi.dynamicImportSettled(); });
  await vi.waitFor(() => {
    if (!document.querySelector(".planStop")) throw new Error("the stop cards have not mounted");
  }, { timeout: 4000 });
}

describe("the lightweight Plan entry", () => {
  it("protects an incoming router ask while the browser address still names Tonight", async () => {
    window.history.replaceState({}, "", "/tonight");
    routeQuery.current = "occasion=coffee&src=tonight-vibes";
    const observed: { readOnly: boolean; value: string }[] = [];
    const observer = new MutationObserver(() => {
      const field = document.querySelector<HTMLInputElement>("#plan-describe-first-query");
      if (field) observed.push({ readOnly: field.readOnly, value: field.value });
    });
    observer.observe(document.body, { subtree: true, childList: true, attributes: true });
    try {
      await mountComposer();
      await act(async () => { await vi.dynamicImportSettled(); });
      await settle();

      expect(observed.some((field) => !field.readOnly && field.value === "")).toBe(false);
      expect(document.querySelector<HTMLInputElement>("#plan-describe-first-query")?.value)
        .toBe("coffee and a catch-up in Clapham for 2");
    } finally {
      observer.disconnect();
    }
  });

  it("keeps the router ask ahead of a stored Ask when the full module is already cached", async () => {
    await import("@/components/plan/PlanComposer");
    window.history.replaceState({}, "", "/tonight");
    routeQuery.current = "occasion=coffee&src=tonight-vibes";
    sessionStorage.setItem("pubmax:ask-plan-draft:v1", JSON.stringify({ query: "Quiet in Soho for 5" }));

    await mountComposer();
    await act(async () => { await vi.dynamicImportSettled(); });
    await settle();

    expect(document.querySelector<HTMLInputElement>("#plan-describe-first-query")?.value)
      .toBe("coffee and a catch-up in Clapham for 2");
    expect(sessionStorage.getItem("pubmax:ask-plan-draft:v1")).toBeNull();
    expect(fetchMock.mock.calls.filter(([input]) => String(input).includes("/api/plans/generate")))
      .toHaveLength(0);
  });

  it("keeps a typed request editable before the full composer is needed", async () => {
    await mountComposer();
    const field = document.querySelector<HTMLInputElement>("#plan-describe-first-query")!;
    expect(field.readOnly).toBe(false);
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, "Quiet in Clapham for 4");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(field.value).toBe("Quiet in Clapham for 4");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("submits the captured request once through the grounded describe-first body", async () => {
    await mountComposer(true);
    await sortIt("Quiet in Clapham for 4");
    const generated = fetchMock.mock.calls.filter(([input]) => String(input).includes("/api/plans/generate"));
    expect(generated).toHaveLength(1);
    const body = JSON.parse(generated[0]![1]!.body as string);
    expect(body.query).toBe("Quiet in Clapham for 4");
    expect(body.intake.area).toEqual({ kind: "night-patch", id: "clapham" });
    expect(body.context.stopCount).toBe(3);
    expect(body.intake.skipped).toEqual(["time-window", "group-size", "budget", "accessibility"]);
    expect(document.querySelector("#plan-result-title")?.textContent).toContain("Clapham");
  });

  it("keeps the arrival's First pint when the full composer opens later", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-11T12:00:00Z"));
    await mountComposer();
    vi.setSystemTime(new Date("2026-10-11T19:00:00Z"));

    await sortIt("Quiet in Clapham for 4");

    expect(document.querySelector<HTMLInputElement>("#plan-time")?.value).toBe("2026-10-11T18:00");
  });

  it("opens the guide without showing its own just-written default as a recovered route", async () => {
    await mountComposer();
    await act(async () => {
      [...document.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Guide me instead")!.click();
      await vi.dynamicImportSettled();
    });
    await vi.waitFor(() => expect(document.querySelector("#plan-intake-title")).not.toBeNull());
    expect(document.querySelector("#plan-title")).toBeNull();
    expect(document.querySelector("#plan-describe-first-query")).toBeNull();
  });

  it("keeps the selected pub count when opening the real guide", async () => {
    await mountComposer();
    await act(async () => {
      [...document.querySelectorAll<HTMLButtonElement>(".planStopCount button")]
        .find((button) => button.textContent?.trim() === "5")!.click();
    });
    await act(async () => {
      [...document.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Guide me instead")!.click();
      await vi.dynamicImportSettled();
    });
    await vi.waitFor(() => expect(document.querySelector("#plan-intake-title")).not.toBeNull());
    expect(readPlanIntakeDraft()?.answers.stopCount).toBe(5);
  });

  it("keeps the selected count when a special link opens the full composer first", async () => {
    window.history.replaceState({}, "", "/plan?occasion=quiet");
    await mountComposer();
    await act(async () => { await vi.dynamicImportSettled(); });
    await vi.waitFor(() => expect(document.querySelector("#plan-describe-first-query")).not.toBeNull());
    await act(async () => {
      [...document.querySelectorAll<HTMLButtonElement>(".planStopCount button")]
        .find((button) => button.textContent?.trim() === "5")!.click();
    });
    await act(async () => {
      [...document.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Guide me instead")!.click();
      await vi.dynamicImportSettled();
    });
    await vi.waitFor(() => expect(document.querySelector("#plan-intake-title")).not.toBeNull());
    expect(readPlanIntakeDraft()?.answers.stopCount).toBe(5);
  });

  it("restores an unfinished guide before exposing an editable describe field", async () => {
    writePlanIntakeDraft(createPlanIntakeDraft());
    await mountComposer();
    await act(async () => { await vi.dynamicImportSettled(); });
    await vi.waitFor(() => expect(document.querySelector("#plan-intake-title")).not.toBeNull());
    expect(document.querySelector("#plan-describe-first-query")).toBeNull();
  });

  it.each([
    ["lightweight", "location", "shoreditch"],
    ["full composer", "location", "shoreditch"],
    ["lightweight", "denied", "camden"],
    ["full composer", "denied", "camden"],
    ["lightweight", "unavailable", "camden"],
    ["lightweight", "outside London", "camden"],
    ["lightweight", "resolver failure", "camden"],
    ["lightweight", "default", null],
    ["lightweight", "chosen area", "camden"],
  ] as const)("retains five stops through %s guide %s seeding and generation", async (entry, delivery, area) => {
    let locate: PositionCallback | undefined;
    let refuse: PositionErrorCallback | undefined;
    vi.stubGlobal("navigator", delivery === "unavailable" ? {} : { geolocation: {
      getCurrentPosition: vi.fn((success: PositionCallback, error?: PositionErrorCallback) => {
        locate = success;
        refuse = error;
      }),
    } });
    await mountComposer(false, entry === "full composer");
    await act(async () => { await vi.dynamicImportSettled(); });
    if (delivery !== "location" && delivery !== "default") {
      writeRememberedArea({ kind: "patch", id: "camden" });
    }
    await act(async () => {
      [...document.querySelectorAll<HTMLButtonElement>(".planStopCount button")]
        .find((button) => button.textContent?.trim() === "5")!.click();
    });
    await act(async () => {
      [...document.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Guide me instead")!.click();
      await vi.dynamicImportSettled();
    });
    if (delivery === "resolver failure") {
      const resolver = await import("@/lib/nearestNightPatch");
      vi.spyOn(resolver, "nearestNightPatch").mockImplementationOnce(() => { throw new Error("location resolver unavailable"); });
    }
    if (delivery !== "unavailable") {
      expect(readPlanIntakeDraft()?.answers.stopCount).toBe(5);
      expect(locate).toBeTypeOf("function");
      await act(async () => {
        if (delivery === "chosen area") {
          [...document.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Camden")!.click();
        }
        if (delivery === "denied" || delivery === "default") {
          refuse!({ code: 1, message: "denied", PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 });
        } else {
          locate!({ coords: { latitude: delivery === "outside London" ? 53.48 : 51.527, longitude: -0.08 } } as GeolocationPosition);
        }
        await vi.dynamicImportSettled();
      });
    }
    expect(readPlanIntakeDraft()?.answers.area).toBe(area);
    expect(readPlanIntakeDraft()?.answers.stopCount).toBe(5);
    expect(document.querySelector<HTMLButtonElement>(".planStopCount button[aria-pressed='true']")?.textContent?.trim()).toBe("5");
    if (area === null) {
      await act(async () => {
        [...document.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Clapham")!.click();
      });
    }
    await act(async () => {
      [...document.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Describe instead")!.click();
    });
    await act(async () => {
      [...document.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Make a plan")!.click();
    });
    const generated = fetchMock.mock.calls.filter(([input]) => String(input).includes("/api/plans/generate"));
    expect(generated).toHaveLength(1);
    const body = JSON.parse(generated[0]![1]!.body as string);
    expect(body.intake.area).toEqual({ kind: "night-patch", id: area ?? "clapham" });
    expect(body.context.stopCount).toBe(5);
    expect(body.intake.stopCount).toBe(5);
  });

  it("retains the wizard request's count when an accepted area seeds on mount", async () => {
    writeRememberedArea({ kind: "patch", id: "camden" });
    const { default: Composer } = await import("@/components/plan/PlanComposer");
    const { capturePlanEntryArrival } = await import("@/components/plan/PlanEntryArrival");
    const arrival = capturePlanEntryArrival();
    host = document.createElement("div");
    document.body.append(host);
    await act(async () => {
      root = createRoot(host!);
      root.render(<Composer
        arrival={arrival}
        entryRequest={{ mode: "wizard", query: "", capturedAt: arrival.capturedAt, stopCount: 5 }}
      />);
      await vi.dynamicImportSettled();
    });
    expect(readPlanIntakeDraft()?.answers.area).toBe("camden");
    expect(readPlanIntakeDraft()?.answers.stopCount).toBe(5);
    expect(document.querySelector("#plan-intake-title")?.textContent).toBe("When are you heading out?");
    expect(document.querySelector<HTMLButtonElement>(".planStopCount button[aria-pressed='true']")?.textContent?.trim()).toBe("5");
  });
});
