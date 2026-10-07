// @vitest-environment jsdom

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

import { act, createElement } from "react";
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

vi.mock("@/components/plan/PlanIntake", () => ({ default: () => null }));
vi.mock("@/components/plan/PlanCultureOpener", () => ({ default: () => null }));
vi.mock("@/components/wanted/WantedPlanChips", () => ({ default: () => null }));
vi.mock("@/components/plan/PlanRouteMiniMap", () => ({ default: () => null }));

vi.mock("@/lib/analytics", () => ({
  trackEvent: () => undefined,
  trackMeaningfulCoreAction: () => undefined,
  laneSourceFromSearch: () => null,
}));

import PlanComposer, { planComposerVenueIndexPath } from "@/components/plan/PlanComposer";

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

async function mountComposer(): Promise<void> {
  host = document.createElement("div");
  document.body.append(host);
  await act(async () => {
    root = createRoot(host!);
    root.render(createElement(PlanComposer));
  });
  await settle();
}

function venueIndexReads(): number {
  const path = planComposerVenueIndexPath();
  return fetchMock.mock.calls.filter(([input]) => String(input) === path).length;
}

async function sortIt(query: string): Promise<void> {
  const field = document.querySelector<HTMLInputElement>("#plan-describe-first-query")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, query);
    field.dispatchEvent(new Event("input", { bubbles: true }));
    [...document.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Sort it")!.click();
    await Promise.resolve();
  });
  await settle();
  await vi.waitFor(() => {
    if (!document.querySelector(".planStop")) throw new Error("the stop cards have not mounted");
  }, { timeout: 4000 });
}

describe("the Plan result", () => {
  it("reads the venue index and draws its datalist only once the composer is up", async () => {
    await mountComposer();
    expect(document.querySelector("#plan-describe-first-query")).not.toBeNull();
    expect(document.querySelector("#plan-venue-options")).toBeNull();
    expect(venueIndexReads()).toBe(0);

    await sortIt("Quiet in Clapham for 4");

    expect(document.querySelector("#plan-composer #plan-venue-options")).not.toBeNull();
    expect(venueIndexReads()).toBe(1);
  });

  it("keeps the area the route was sorted for when the night's area is changed", async () => {
    await mountComposer();
    await sortIt("Quiet in Clapham for 4");
    const heading = () => document.querySelector("#plan-result-title")?.textContent;
    expect(heading()).toBe("Tonight in Clapham");

    const tune = [...document.querySelectorAll("button")].find((button) => button.textContent?.includes("Tune details"))!;
    await act(async () => { tune.click(); });
    await vi.waitFor(() => {
      if (!document.querySelector("#plan-context-area")) throw new Error("Tune details has not mounted");
    }, { timeout: 4000 });
    const area = document.querySelector<HTMLSelectElement>("#plan-context-area")!;
    await act(async () => {
      area.value = "victoria";
      area.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle();

    expect(area.value).toBe("victoria");
    expect(heading()).toBe("Tonight in Clapham");
    const meta = [...document.querySelectorAll(".planStop__meta")].map((node) => node.textContent);
    expect(meta).toEqual(["Clapham", "Clapham"]);
  });
});
