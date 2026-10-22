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
vi.mock("@/components/plan/PlanRouteMiniMap", () => ({ default: () => null }));

vi.mock("@/lib/analytics", () => ({
  trackEvent: () => undefined,
  trackMeaningfulCoreAction: () => undefined,
  laneSourceFromSearch: () => null,
}));

import PlanEntry from "@/components/plan/PlanEntry";
import { createPlanIntakeDraft, readPlanIntakeDraft, writePlanIntakeDraft } from "@/lib/planIntake";

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
  sessionStorage.clear();
  localStorage.clear();
});

async function settle(): Promise<void> {
  await act(async () => {
    for (let turn = 0; turn < 5; turn += 1) await Promise.resolve();
  });
}

async function mountComposer(strict = false): Promise<void> {
  host = document.createElement("div");
  document.body.append(host);
  await act(async () => {
    root = createRoot(host!);
    root.render(strict ? createElement(StrictMode, null, createElement(PlanEntry)) : createElement(PlanEntry));
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
});
