// @vitest-environment jsdom

// THE ONE-TAP PRICE DOOR ASKS THE MEASURE (review finding F-2, battle test D04).
//
// #1517 made "What's it tonight?" the single primary price door on a pub's
// Overview. It offered a closed Beer chip, a price field and nothing else, and
// `lib/oneTapPintDrop.server.ts` stamped the paired `pint_drops` row
// `measure: "pint"` on a value nobody was asked. A drinker holding a half tapped
// Beer, typed 2.60, and got a pint-measured row with a real authority key that a
// second reporter could confirm into pin colour, the cheapest-pint buckets and
// the Pint Index at a pub whose pint is £5.50 - the production defect the whole
// half-pint work exists to close, reached through the busiest door.
//
// These tests check the serving choices and the measure sent by this form.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DRINK_MEASURES,
  DRINK_MEASURE_LABEL,
  NON_PINT_PRICE_REACH_LINE,
} from "@/lib/drinkMeasure";

const submit = vi.hoisted(() => vi.fn());

vi.mock("@/components/identity/ContributionGateDialog", () => ({
  useContributionGate: () => ({
    requestContribution: async (action: (auth: { accessToken: string }) => unknown) => {
      await action({ accessToken: "test-access-token" });
    },
    contributionGateDialog: null,
  }),
}));

vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("@/components/map/PriceContributionImpact", () => ({ default: () => null }));

import { attachBill } from "./helpers/oneTapBill";

import VenuePriceSubmit from "@/components/map/VenuePriceSubmit";
import type { CommunityPricesState } from "@/components/map/useCommunityPrices";
import { defined } from "@/__tests__/helpers/defined";

const communityPrices = {
  byVenueId: new Map(),
  signalsByVenueId: new Map(),
  freshestByVenueId: new Map(),
  venuePriceStatus: new Map(),
  loadVenue: vi.fn(),
  submit,
  submitVenueSignal: vi.fn(),
  submitting: false,
  reportPrice: vi.fn(),
  reportedIds: new Set<string>(),
} as unknown as CommunityPricesState;

let container: HTMLDivElement;
let root: Root;

function measureChips(): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll<HTMLButtonElement>(".measureChip"));
}

async function renderDoor(props: Record<string, unknown> = {}) {
  await act(async () => {
    root.render(
      createElement(VenuePriceSubmit, {
        venueId: "venue-1",
        venueName: "The Test Arms",
        communityPrices,
        ...props,
      } as never),
    );
  });
}

async function logPrice() {
  const quickPrice = container.querySelector<HTMLButtonElement>(".vpsubQuickChip");
  if (!quickPrice) throw new Error("quick price button did not render");
  await act(async () => {
    quickPrice.click();
  });
  await attachBill(container);
  const logButton = container.querySelector<HTMLButtonElement>(".vpsubLog");
  if (!logButton) throw new Error("Log it button did not render");
  await act(async () => {
    logButton.click();
    await Promise.resolve();
  });
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;
  submit.mockReset();
  submit.mockResolvedValue({
    ok: true,
    attribution: { status: "credited", handle: "alice" },
    price: null,
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("the one-tap price door asks the measure", () => {
  it("renders the closed measure chips on the beer lane", async () => {
    await renderDoor();

    // Pint and Half first, the glass and spirit sizes after them under their
    // own heading, Other last (review item B1).
    expect(measureChips().map((chip) => chip.textContent)).toEqual(
      DRINK_MEASURES.map((measure) => DRINK_MEASURE_LABEL[measure]),
    );
    expect(container.querySelector(".measureGroupLabel")?.textContent).toBe("Wine and spirits");
    // The closed question stands ABOVE the figure, so the answer is never
    // inferred from what somebody typed afterwards.
    const chipRow = container.querySelector(".measureChips");
    const priceField = container.querySelector(".vpsubEntry");
    expect(chipRow).toBeTruthy();
    expect(priceField).toBeTruthy();
    expect(
      chipRow!.compareDocumentPosition(priceField!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("sends pint when the drinker leaves the default alone", async () => {
    await renderDoor();
    await logPrice();

    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({ drinkCategory: "beer", measure: "pint" }),
      { accessToken: "test-access-token" },
    );
  });

  it("sends the half the drinker picked, and never a pint", async () => {
    await renderDoor();
    const half = defined(measureChips()[1]);
    await act(async () => {
      half.click();
    });
    expect(half.getAttribute("aria-checked")).toBe("true");

    await logPrice();

    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({ measure: "half" }),
      { accessToken: "test-access-token" },
    );
  });

  it("asks nothing about a measure on a lane a measure says nothing about", async () => {
    await renderDoor({ laneCategory: "cocktail" });
    expect(measureChips()).toHaveLength(0);
  });

  it("does not let a picked half follow the reader onto another drink", async () => {
    await renderDoor();
    await act(async () => {
      defined(measureChips()[1]).click();
    });
    const cocktail = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".vpsubCat"),
    ).find((chip) => chip.textContent?.toLowerCase().includes("cocktail"));
    if (!cocktail) throw new Error("cocktail chip did not render");
    await act(async () => {
      cocktail.click();
    });
    expect(measureChips()).toHaveLength(0);

    await logPrice();
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({ drinkCategory: "cocktail", measure: "pint" }),
      { accessToken: "test-access-token" },
    );
  });

  it("stops promising the map the moment a half is picked", async () => {
    await renderDoor();
    const note = () => container.querySelector(".vpsubNote")?.textContent ?? "";
    expect(note()).toMatch(/moves the map/i);

    await act(async () => {
      defined(measureChips()[1]).click();
    });
    // A half never moves the map at any count, so the sentence beside the
    // field may not say a second drinker will.
    expect(note()).toContain(NON_PINT_PRICE_REACH_LINE);
    expect(note()).not.toMatch(/moves the map/i);
  });

  it("starts the next log from the default rather than the last serving", async () => {
    await renderDoor();
    await act(async () => {
      defined(measureChips()[1]).click();
    });
    await logPrice();

    expect(defined(measureChips()[0]).getAttribute("aria-checked")).toBe("true");
    expect(defined(measureChips()[1]).getAttribute("aria-checked")).toBe("false");
  });
});
