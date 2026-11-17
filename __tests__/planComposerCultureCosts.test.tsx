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
vi.mock("@/components/wanted/WantedPlanChips", () => ({ default: () => null }));
vi.mock("@/components/plan/PlanRouteMiniMap", () => ({ default: () => null }));

vi.mock("@/lib/analytics", () => ({
  trackEvent: () => undefined,
  trackMeaningfulCoreAction: () => undefined,
  laneSourceFromSearch: () => null,
}));

import PlanComposer, { planComposerVenueIndexPath } from "@/components/plan/PlanComposer";
import { CULTURE_WAYPOINT_UNKNOWN_NOTE, type CultureOpenerDTO } from "@/lib/cultureCrawl";

// These prices and this observation date are test facts, not current pub claims.
// The action tests use the real clock and do not judge price freshness.
const PRICE_SOURCE = {
  label: "Test fixture pint price",
  url: "https://example.org/test-fixture/pint-prices",
  observedAt: "2026-10-01T00:00:00.000Z",
};

const CULTURE_OPENER: CultureOpenerDTO = {
  requested: ["gallery"],
  waypoint: {
    poiId: "poi-gallery-1",
    name: "Soho Photo Gallery",
    category: "sight",
    categoryLabel: "Sight",
    kind: "gallery",
    distanceKm: 0.4,
    coordinates: [-0.1365, 51.5136],
  },
  note: CULTURE_WAYPOINT_UNKNOWN_NOTE,
  costs: {
    limitPence: 4000,
    knownSubtotalPence: 1620,
    knownItems: [
      { venueId: "venue-a", venueName: "Pub A", pence: 520, source: PRICE_SOURCE },
      { venueId: "venue-b", venueName: "Pub B", pence: 610, source: PRICE_SOURCE },
      { venueId: "venue-c", venueName: "Pub C", pence: 490, source: PRICE_SOURCE },
    ],
    unknownItems: ["admission", "food", "transport"],
  },
};

const GENERATED = {
  routeRevision: 1,
  groundingProof: "test-proof",
  anchored: false,
  stops: [
    {
      venueId: "venue-a", venueName: "Pub A", estimatedPintPricePence: 520,
      priceEvidence: { source: PRICE_SOURCE },
    },
    {
      venueId: "venue-b", venueName: "Pub B", estimatedPintPricePence: 610,
      priceEvidence: { source: PRICE_SOURCE },
      alternatives: [{ venueId: "venue-d", venueName: "Pub D" }],
    },
    {
      venueId: "venue-c", venueName: "Pub C", estimatedPintPricePence: 490,
      priceEvidence: { source: PRICE_SOURCE },
    },
  ],
  inferredContext: { nightArea: "soho", daypart: "evening", groupSize: 2 },
  cultureOpener: CULTURE_OPENER,
};

const VENUE_INDEX = [
  { id: "venue-a", name: "Pub A", kind: "pub" },
  { id: "venue-b", name: "Pub B", kind: "pub" },
  { id: "venue-c", name: "Pub C", kind: "pub" },
  { id: "venue-d", name: "Pub D", kind: "pub" },
];

let root: Root | null = null;
let host: HTMLElement | null = null;

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    let body: unknown;
    if (url === "/api/plans/generate") body = GENERATED;
    else if (url === planComposerVenueIndexPath()) body = VENUE_INDEX;
    else throw new Error(`Unexpected fetch in culture cost fixture: ${url}`);
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }));
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

function stopIdentities() {
  return [...host!.querySelectorAll("li.planStop")].map((card) => {
    const link = card.querySelector<HTMLAnchorElement>(".planStop__open");
    return {
      name: card.querySelector(".planStop__name")?.textContent,
      venueId: link ? new URL(link.href).searchParams.get("sel") : null,
    };
  });
}

function cultureOpener(): HTMLElement {
  const opener = host!.querySelector<HTMLElement>("[data-testid='plan-culture-opener']");
  expect(opener).not.toBeNull();
  expect(opener!.querySelector(".planComposer__openerPlace strong")?.textContent).toBe("Soho Photo Gallery");
  expect(opener!.querySelector(".planComposer__openerNote")?.textContent).toBe(CULTURE_WAYPOINT_UNKNOWN_NOTE);
  return opener!;
}

function enabledButton(label: string): HTMLButtonElement {
  const button = host!.querySelector<HTMLButtonElement>(`button[aria-label='${label}']`);
  expect(button).not.toBeNull();
  expect(button!.disabled).toBe(false);
  return button!;
}

async function generateCultureRoute() {
  host = document.createElement("div");
  document.body.append(host);
  await act(async () => {
    root = createRoot(host!);
    root.render(createElement(PlanComposer));
  });
  await settle();

  const field = host.querySelector<HTMLInputElement>("#plan-describe-first-query");
  expect(field).not.toBeNull();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, "gallery then a pint in Soho for 2");
    field!.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const planIt = [...host.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Plan it");
  expect(planIt).toBeDefined();
  expect(planIt!.disabled).toBe(false);
  await act(async () => { planIt!.click(); });
  await settle();
  await vi.waitFor(() => {
    expect(stopIdentities()).toEqual([
      { name: "Pub A", venueId: "venue-a" },
      { name: "Pub B", venueId: "venue-b" },
      { name: "Pub C", venueId: "venue-c" },
    ]);
  }, { timeout: 4000 });

  const opener = cultureOpener();
  const known = opener.querySelector("[aria-label='Known costs']");
  expect(known).not.toBeNull();
  expect([...known!.querySelectorAll("li")].map((line) => line.textContent)).toEqual([
    "Pint at Pub A: £5.20, Test fixture pint price",
    "Pint at Pub B: £6.10, Test fixture pint price",
    "Pint at Pub C: £4.90, Test fixture pint price",
  ]);
  expect(opener.textContent).toContain("Partial subtotal: £16.20 each, before the costs below.");
  expect([...opener.querySelectorAll("[aria-label='Costs not known'] li")].map((line) => line.textContent))
    .toEqual(["Admission", "Food", "Transport"]);

  return {
    remove: enabledButton("Remove stop 2"),
    swap: enabledButton("Swap stop 2, currently Pub B"),
  };
}

describe("culture outing costs after changing a generated route", () => {
  it("stops presenting B's pint as a current known cost after removing stop 2", async () => {
    const { remove } = await generateCultureRoute();

    await act(async () => { remove.click(); });
    await settle();
    await vi.waitFor(() => {
      expect(stopIdentities()).toEqual([
        { name: "Pub A", venueId: "venue-a" },
        { name: "Pub C", venueId: "venue-c" },
      ]);
    }, { timeout: 4000 });

    await vi.waitFor(() => {
      const known = cultureOpener().querySelector("[aria-label='Known costs']");
      expect(known?.textContent ?? "").not.toContain("Pint at Pub B:");
    }, { timeout: 4000 });
  });

  it("stops presenting B's pint as a current known cost after swapping stop 2 to D", async () => {
    const { swap } = await generateCultureRoute();

    await act(async () => { swap.click(); });
    await settle();
    await vi.waitFor(() => {
      expect(stopIdentities()).toEqual([
        { name: "Pub A", venueId: "venue-a" },
        { name: "Pub D", venueId: "venue-d" },
        { name: "Pub C", venueId: "venue-c" },
      ]);
    }, { timeout: 4000 });

    await vi.waitFor(() => {
      const known = cultureOpener().querySelector("[aria-label='Known costs']");
      expect(known?.textContent ?? "").not.toContain("Pint at Pub B:");
    }, { timeout: 4000 });
  });
});
