// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const transport = vi.hoisted(() => ({
  authedActionFetch: vi.fn(),
}));
const trackEvent = vi.hoisted(() => vi.fn());
const priceState = vi.hoisted(() => ({
  current: null as unknown,
}));

vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => ({
    user: { id: "signed-in" },
    handle: "night_owl",
    identityResolved: true,
    loading: false,
    configured: true,
  }),
}));

vi.mock("@/lib/authedFetch", () => ({
  authedActionFetch: transport.authedActionFetch,
}));

vi.mock("@/lib/analytics", () => ({ trackEvent }));

vi.mock("@/components/identity/ContributionGateDialog", () => ({
  useContributionGate: () => ({
    requestContribution: async (
      run: (auth: { accessToken: string }) => Promise<void>,
    ) => {
      await run({ accessToken: "test-access-token" });
    },
    contributionGateDialog: null,
  }),
}));

vi.mock("@/components/map/PriceContributionImpact", () => ({
  default: () => null,
}));

vi.mock("@/components/map/useCommunityPrices", () => ({
  useCommunityPrices: () => priceState.current,
}));

import VenueSheetPriceEntry from "@/components/map/inspector/VenueSheetPriceEntry";
import type { CommunityPricesState } from "@/components/map/useCommunityPrices";
import NearPriceEvidenceMission from "@/components/nearme/NearPriceEvidenceMission";
import { usePriceEvidenceMission } from "@/components/nearme/usePriceEvidenceMission";
import { PRICE_EVIDENCE_MISSION_DISMISS_KEY } from "@/lib/priceEvidenceMissionDismiss";
import type { PriceEvidenceMission } from "@/lib/priceEvidenceMissions";

const VENUE_A_MISSION: PriceEvidenceMission = {
  venueId: "venue-a",
  reason: "provisional",
  drinkCategory: "beer",
  observedAt: Date.parse("2026-08-30T18:00:00.000Z"),
};

const VENUE_B_MISSION: PriceEvidenceMission = {
  venueId: "venue-b",
  reason: "missing",
};

const submit = vi.fn();
const communityPrices = {
  byVenueId: new Map(),
  signalsByVenueId: new Map(),
  freshestByVenueId: new Map(),
  venuePriceStatus: new Map(),
  loadVenue: vi.fn(),
  loadNoAlcoholIndex: vi.fn(),
  loadDrinkCategoryIndex: vi.fn(),
  submit,
  submitVenueSignal: vi.fn(),
  submitting: false,
  reportPrice: vi.fn(),
  reportedIds: new Set<string>(),
} as unknown as CommunityPricesState;

let container: HTMLDivElement;
let root: Root;
let requestedVenueIds: string[][];

function missionForRequest(url: string): PriceEvidenceMission | null {
  const venueIds = new URL(url, "http://localhost").searchParams.getAll("venueId");
  requestedVenueIds.push(venueIds);
  if (venueIds.includes(VENUE_A_MISSION.venueId)) return VENUE_A_MISSION;
  if (venueIds.includes(VENUE_B_MISSION.venueId)) return VENUE_B_MISSION;
  return null;
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

async function enterPrice(value: string): Promise<void> {
  const input = container.querySelector<HTMLInputElement>(".vpsubInput");
  if (!input) throw new Error("price input did not render");
  await act(async () => {
    const setValue = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    setValue?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function click(selector: string): Promise<void> {
  const button = container.querySelector<HTMLButtonElement>(selector);
  if (!button) throw new Error(`${selector} did not render`);
  await act(async () => {
    button.click();
    await Promise.resolve();
  });
}

function HookHarness() {
  const missionState = usePriceEvidenceMission({
    venueIds: ["venue-a", "venue-b"],
    enabled: true,
    surface: "near",
  }) as ReturnType<typeof usePriceEvidenceMission> & {
    complete?: (mission: PriceEvidenceMission) => void;
  };
  return createElement(
    "div",
    null,
    createElement("output", { "data-mission": true }, missionState.mission?.venueId ?? "none"),
    createElement(
      "button",
      {
        type: "button",
        "data-complete": true,
        onClick: () => {
          if (missionState.mission) missionState.complete?.(missionState.mission);
        },
      },
      "Complete",
    ),
  );
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;
  window.sessionStorage.clear();
  requestedVenueIds = [];
  submit.mockReset();
  trackEvent.mockReset();
  transport.authedActionFetch.mockReset();
  transport.authedActionFetch.mockImplementation(async (input: RequestInfo | URL) => (
    Response.json({
      status: "ready",
      mission: missionForRequest(String(input)),
    })
  ));
  submit.mockResolvedValue({
    ok: true,
    attribution: { status: "credited", handle: "night_owl" },
    price: {
      id: "price-a",
      venueId: "venue-a",
      drinkCategory: "beer",
      priceGbp: 5.2,
      submittedAt: Date.now(),
      source: "community",
      corroborations: 1,
    },
  });
  priceState.current = communityPrices;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe("price evidence mission completion", () => {
  it("reranks without writing a dismissal or emitting mission_dismissed", async () => {
    const storageWrite = vi.spyOn(Storage.prototype, "setItem");
    await act(async () => {
      root.render(createElement(HookHarness));
    });
    await settle();
    expect(container.querySelector("[data-mission]")?.textContent).toBe("venue-a");

    await click("[data-complete]");
    await settle();

    expect(requestedVenueIds).toEqual([
      ["venue-a", "venue-b"],
      ["venue-b"],
    ]);
    expect(container.querySelector("[data-mission]")?.textContent).toBe("venue-b");
    expect(window.sessionStorage.getItem(PRICE_EVIDENCE_MISSION_DISMISS_KEY)).toBeNull();
    expect(
      storageWrite.mock.calls.some(([key]) => key === PRICE_EVIDENCE_MISSION_DISMISS_KEY),
    ).toBe(false);
    expect(trackEvent).not.toHaveBeenCalledWith(
      "mission_dismissed",
      expect.anything(),
    );
  });

  it("keeps the completed Near receipt and hides stale task controls while reranking", async () => {
    await act(async () => {
      root.render(createElement(NearPriceEvidenceMission, {
        cards: [
          {
            id: "venue-a",
            name: "Alpha Arms",
            borough: "Camden",
            cheapestPrice: 5.2,
          },
          {
            id: "venue-b",
            name: "Bravo Arms",
            borough: "Camden",
            cheapestPrice: 5.4,
          },
        ],
        enabled: true,
      }));
    });
    await settle();
    expect(container.textContent).toContain("Check the beer price at Alpha Arms");

    await click(".pemOpen");
    await enterPrice("5.20");
    await click(".vpsubLog");
    await settle();

    expect(requestedVenueIds).toEqual([
      ["venue-a", "venue-b"],
      ["venue-b"],
    ]);
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      "Another independent check is still needed.",
    );
    expect(container.querySelector<HTMLInputElement>(".vpsubInput")?.getAttribute("aria-label"))
      .toContain("Alpha Arms");
    expect(container.querySelector(".pemHeading")).toBeNull();
    expect(container.querySelector(".pemOpen")).toBeNull();
    expect(container.querySelector(".pemSkip")).toBeNull();
    expect(container.textContent).not.toContain("Bravo Arms");
  });

  it("keeps Near Venue A mounted when ranking moves to Venue B before its write answers", async () => {
    let resolveSubmit:
      | ((result: Awaited<ReturnType<CommunityPricesState["submit"]>>) => void)
      | undefined;
    submit.mockReturnValueOnce(new Promise((resolve) => {
      resolveSubmit = resolve;
    }));
    await act(async () => {
      root.render(createElement(NearPriceEvidenceMission, {
        cards: [
          {
            id: "venue-a",
            name: "Alpha Arms",
            borough: "Camden",
            cheapestPrice: 5.2,
          },
          {
            id: "venue-b",
            name: "Bravo Arms",
            borough: "Camden",
            cheapestPrice: 5.4,
          },
        ],
        enabled: true,
      }));
    });
    await settle();

    await click(".pemOpen");
    await enterPrice("5.20");
    const venueAComposer = container.querySelector("#venue-price-submit-venue-a");
    if (!venueAComposer) throw new Error("Venue A composer did not open");
    await click(".vpsubLog");

    await act(async () => {
      root.render(createElement(NearPriceEvidenceMission, {
        cards: [
          {
            id: "venue-b",
            name: "Bravo Arms",
            borough: "Camden",
            cheapestPrice: 5.4,
          },
        ],
        enabled: true,
      }));
    });
    await settle();

    expect(requestedVenueIds).toEqual([
      ["venue-a", "venue-b"],
      ["venue-b"],
    ]);
    expect(container.querySelector("#venue-price-submit-venue-a"))
      .toBe(venueAComposer);
    expect(container.textContent).not.toContain("Bravo Arms");
    expect(trackEvent).not.toHaveBeenCalledWith("mission_viewed", {
      surface: "near",
      reason: "missing",
    });

    if (!resolveSubmit) throw new Error("deferred Venue A write did not start");
    const finishSubmit = resolveSubmit;
    await act(async () => {
      finishSubmit({
        ok: true,
        attribution: { status: "credited", handle: "night_owl" },
        price: {
          id: "price-a",
          venueId: "venue-a",
          drinkCategory: "beer",
          priceGbp: 5.2,
          submittedAt: Date.now(),
          source: "community",
          corroborations: 1,
        },
      });
      await Promise.resolve();
    });
    await settle();

    expect(container.querySelector("#venue-price-submit-venue-a"))
      .toBe(venueAComposer);
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      "Another independent check is still needed.",
    );
  });

  it("ignores a dismissed deferred mission when its write resolves later", async () => {
    let resolveSubmit:
      | ((result: Awaited<ReturnType<CommunityPricesState["submit"]>>) => void)
      | undefined;
    submit.mockReturnValueOnce(new Promise((resolve) => {
      resolveSubmit = resolve;
    }));
    await act(async () => {
      root.render(createElement(NearPriceEvidenceMission, {
        cards: [
          {
            id: "venue-a",
            name: "Alpha Arms",
            borough: "Camden",
            cheapestPrice: 5.2,
          },
          {
            id: "venue-b",
            name: "Bravo Arms",
            borough: "Camden",
            cheapestPrice: 5.4,
          },
        ],
        enabled: true,
      }));
    });
    await settle();

    await click(".pemOpen");
    await enterPrice("5.20");
    await click(".vpsubLog");
    await click(".pemSkip");
    await settle();

    expect(container.textContent).toContain("Log a price at Bravo Arms");
    expect(container.querySelector("#venue-price-submit-venue-a")).toBeNull();

    if (!resolveSubmit) throw new Error("deferred Venue A write did not start");
    const finishSubmit = resolveSubmit;
    await act(async () => {
      finishSubmit({
        ok: true,
        attribution: { status: "credited", handle: "night_owl" },
        price: {
          id: "price-a",
          venueId: "venue-a",
          drinkCategory: "beer",
          priceGbp: 5.2,
          submittedAt: Date.now(),
          source: "community",
          corroborations: 1,
        },
      });
      await Promise.resolve();
    });
    await settle();

    expect(container.textContent).toContain("Log a price at Bravo Arms");
    expect(container.querySelector(".pemOpen")).not.toBeNull();
    expect(container.querySelector("#venue-price-submit-venue-a")).toBeNull();
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(container.querySelector('[aria-label="Price check complete"]')).toBeNull();
    expect(container.textContent).not.toContain("Alpha Arms");
  });

  it("releases a completed Near receipt when Venue A leaves the card set", async () => {
    await act(async () => {
      root.render(createElement(NearPriceEvidenceMission, {
        cards: [
          {
            id: "venue-a",
            name: "Alpha Arms",
            borough: "Camden",
            cheapestPrice: 5.2,
          },
          {
            id: "venue-b",
            name: "Bravo Arms",
            borough: "Camden",
            cheapestPrice: 5.4,
          },
        ],
        enabled: true,
      }));
    });
    await settle();

    await click(".pemOpen");
    await enterPrice("5.20");
    await click(".vpsubLog");
    await settle();
    expect(container.querySelector("#venue-price-submit-venue-a")).not.toBeNull();
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      "Another independent check is still needed.",
    );

    await act(async () => {
      root.render(createElement(NearPriceEvidenceMission, {
        cards: [
          {
            id: "venue-b",
            name: "Bravo Arms",
            borough: "Camden",
            cheapestPrice: 5.4,
          },
          {
            id: "venue-c",
            name: "Charlie Arms",
            borough: "Camden",
            cheapestPrice: 5.6,
          },
        ],
        enabled: true,
      }));
    });
    await settle();

    expect(container.querySelector("#venue-price-submit-venue-a")).toBeNull();
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(container.textContent).not.toContain("Alpha Arms");
    expect(container.textContent).toContain("Log a price at Bravo Arms");
    expect(container.querySelector(".pemOpen")).not.toBeNull();
    expect(container.querySelector(".venuePriceSubmit")).toBeNull();
  });

  it("does not carry a failed receipt or open composer into the next Near Venue", async () => {
    submit.mockResolvedValueOnce({
      ok: false,
      error: "Alpha write failed.",
      reason: "rejected",
    });
    await act(async () => {
      root.render(createElement(NearPriceEvidenceMission, {
        cards: [
          {
            id: "venue-a",
            name: "Alpha Arms",
            borough: "Camden",
            cheapestPrice: 5.2,
          },
          {
            id: "venue-b",
            name: "Bravo Arms",
            borough: "Camden",
            cheapestPrice: 5.4,
          },
        ],
        enabled: true,
      }));
    });
    await settle();

    await click(".pemOpen");
    await enterPrice("5.20");
    await click(".vpsubLog");
    await settle();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "Alpha write failed.",
    );

    await click(".pemSkip");
    await settle();

    expect(container.textContent).toContain("Log a price at Bravo Arms");
    expect(container.querySelector(".pemOpen")).not.toBeNull();
    expect(container.querySelector(".venuePriceSubmit")).toBeNull();
    expect(container.textContent).not.toContain("Alpha write failed.");
  });

  it("removes the Map mission banner without remounting its confirmed receipt", async () => {
    const onLogged = vi.fn();
    await act(async () => {
      root.render(createElement(VenueSheetPriceEntry, {
        venueId: "venue-a",
        venueName: "Alpha Arms",
        isPub: true,
        communityPrices,
        canSubmitPrice: true,
        showSignInGate: false,
        authLoading: false,
        onLogged,
      }));
    });
    await settle();
    expect(container.textContent).toContain("Check the beer price at Alpha Arms");
    const composer = container.querySelector(".venuePriceSubmit");
    if (!composer) throw new Error("Map price composer did not render");

    await enterPrice("5.20");
    await click(".vpsubLog");
    await settle();

    expect(container.querySelector(".pemSlotSheet")).toBeNull();
    expect(container.querySelector(".venuePriceSubmit")).toBe(composer);
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      "Another independent check is still needed.",
    );
    expect(onLogged).toHaveBeenCalledWith("venue-a");
    expect(trackEvent).not.toHaveBeenCalledWith(
      "mission_dismissed",
      expect.anything(),
    );
  });
});
