// @vitest-environment jsdom

import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const submit = vi.hoisted(() => vi.fn());
const trackEvent = vi.hoisted(() => vi.fn());

vi.mock("@/components/identity/ContributionGateDialog", () => ({
  useContributionGate: () => ({
    requestContribution: async (action: (auth: { accessToken: string }) => unknown) => {
      await action({ accessToken: "test-access-token" });
    },
    contributionGateDialog: null,
  }),
}));

vi.mock("@/lib/analytics", () => ({ trackEvent }));
vi.mock("@/components/map/PriceContributionImpact", () => ({
  default: () => null,
}));

import VenuePriceSubmit, {
  type VenuePriceSubmitMission,
} from "@/components/map/VenuePriceSubmit";
import type { CommunityPricesState } from "@/components/map/useCommunityPrices";

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

const WINE_MISSION: VenuePriceSubmitMission = {
  reason: "stale",
  drinkCategory: "wine",
  surface: "map",
};

function WineMissionLifecycleHarness({
  onLogged,
  onMissionComplete,
}: {
  onLogged: (venueId: string) => void;
  onMissionComplete: (venueId: string) => void;
}) {
  const [mission, setMission] =
    useState<VenuePriceSubmitMission | null>(null);
  return createElement(
    "div",
    null,
    createElement(
      "button",
      {
        type: "button",
        "data-attach-wine-mission": true,
        onClick: () => setMission(WINE_MISSION),
      },
      "Attach wine mission",
    ),
    createElement(VenuePriceSubmit, {
      venueId: "venue-1",
      venueName: "The Test Arms",
      communityPrices,
      laneCategory: "beer",
      mission,
      onLogged,
      onMissionComplete: (venueId) => {
        onMissionComplete(venueId);
        setMission(null);
      },
    }),
  );
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;
  submit.mockReset();
  trackEvent.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("Pint Drop sheet refresh", () => {
  it("notifies the open venue after the price write succeeds", async () => {
    submit.mockResolvedValue({
      ok: true,
      attribution: { status: "credited", handle: "alice" },
      price: {
        id: "price-1",
        venueId: "venue-1",
        drinkCategory: "beer",
        priceGbp: 4.2,
        submittedAt: Date.parse("2026-08-31T18:00:00.000Z"),
        source: "community",
        corroborations: 1,
      },
    });
    const onLogged = vi.fn();

    await act(async () => {
      root.render(
        createElement(VenuePriceSubmit, {
          venueId: "venue-1",
          venueName: "The Test Arms",
          communityPrices,
          onLogged,
        }),
      );
    });

    const quickPrice = container.querySelector<HTMLButtonElement>(".vpsubQuickChip");
    if (!quickPrice) throw new Error("quick price button did not render");
    await act(async () => {
      quickPrice.click();
    });

    const logButton = container.querySelector<HTMLButtonElement>(".vpsubLog");
    if (!logButton) throw new Error("Log it button did not render");
    await act(async () => {
      logButton.click();
      await Promise.resolve();
    });

    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({ venueId: "venue-1" }),
      { accessToken: "test-access-token" },
    );
    expect(onLogged).toHaveBeenCalledTimes(1);
    expect(onLogged).toHaveBeenCalledWith("venue-1");
  });

  it("completes a confirmed mission separately from the Pint Drop refresh", async () => {
    submit.mockResolvedValue({
      ok: true,
      attribution: { status: "credited", handle: "alice" },
      price: {
        id: "price-1",
        venueId: "venue-1",
        drinkCategory: "beer",
        priceGbp: 5.2,
        submittedAt: Date.parse("2026-08-31T18:00:00.000Z"),
        source: "community",
        corroborations: 1,
      },
    });
    const onLogged = vi.fn();
    const onMissionComplete = vi.fn();

    await act(async () => {
      root.render(
        createElement(VenuePriceSubmit, {
          venueId: "venue-1",
          venueName: "The Test Arms",
          communityPrices,
          mission: {
            reason: "provisional",
            drinkCategory: "beer",
            surface: "map",
          },
          onLogged,
          onMissionComplete,
        }),
      );
    });

    const priceInput = container.querySelector<HTMLInputElement>(".vpsubInput");
    const logButton = container.querySelector<HTMLButtonElement>(".vpsubLog");
    if (!priceInput || !logButton) throw new Error("mission price fields did not render");
    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setValue?.call(priceInput, "5.20");
      priceInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      logButton.click();
      await Promise.resolve();
    });

    const receiptStatus = container.querySelector('[role="status"]');
    expect(receiptStatus).not.toBeNull();
    expect(receiptStatus?.textContent ?? "").toContain(
      "Another independent check is still needed.",
    );
    expect(onLogged).toHaveBeenCalledTimes(1);
    expect(onLogged).toHaveBeenCalledWith("venue-1");
    expect(onMissionComplete).toHaveBeenCalledTimes(1);
    expect(onMissionComplete).toHaveBeenCalledWith("venue-1");
  });

  it("keeps a wine receipt when completion removes the late mission from the same beer composer", async () => {
    submit.mockResolvedValue({
      ok: true,
      attribution: { status: "credited", handle: "alice" },
      price: {
        id: "price-wine",
        venueId: "venue-1",
        drinkCategory: "wine",
        priceGbp: 5.75,
        submittedAt: Date.now(),
        source: "community",
        corroborations: 1,
      },
    });
    const onLogged = vi.fn();
    const onMissionComplete = vi.fn();

    await act(async () => {
      root.render(createElement(WineMissionLifecycleHarness, {
        onLogged,
        onMissionComplete,
      }));
    });
    const composer = container.querySelector("#venue-price-submit-venue-1");
    const attachMission = container.querySelector<HTMLButtonElement>(
      "[data-attach-wine-mission]",
    );
    if (!composer || !attachMission) throw new Error("wine mission harness did not render");
    await act(async () => attachMission.click());
    expect(container.querySelector("#venue-price-submit-venue-1")).toBe(composer);
    expect(container.querySelector(".vpsubLockedDrink")?.textContent).toBe("Wine");

    const priceInput = container.querySelector<HTMLInputElement>(".vpsubInput");
    const logButton = container.querySelector<HTMLButtonElement>(".vpsubLog");
    if (!priceInput || !logButton) throw new Error("wine mission fields did not render");
    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setValue?.call(priceInput, "5.75");
      priceInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      logButton.click();
      await Promise.resolve();
    });

    expect(container.querySelector("#venue-price-submit-venue-1")).toBe(composer);
    expect(container.querySelector(".vpsubLockedDrink")).toBeNull();
    expect(
      Array.from(container.querySelectorAll<HTMLButtonElement>(".vpsubCat"))
        .find((button) => button.textContent === "Beer")
        ?.getAttribute("aria-checked"),
    ).toBe("true");
    const wineReceiptStatus = container.querySelector('[role="status"]');
    expect(wineReceiptStatus).not.toBeNull();
    expect(wineReceiptStatus?.textContent ?? "").toContain("Wine");
    expect(wineReceiptStatus?.textContent ?? "").toContain(
      "Another independent check is still needed.",
    );
    expect(onMissionComplete).toHaveBeenCalledWith("venue-1");
    expect(onLogged).toHaveBeenCalledWith("venue-1");
  });

  it("does not complete a named wine mission when the held submission is beer", async () => {
    submit.mockResolvedValue({
      ok: true,
      attribution: { status: "credited", handle: "alice" },
      price: {
        id: "price-beer",
        venueId: "venue-1",
        drinkCategory: "beer",
        priceGbp: 5.2,
        submittedAt: Date.now(),
        source: "community",
        corroborations: 1,
      },
    });
    const onLogged = vi.fn();
    const onMissionComplete = vi.fn();

    await act(async () => {
      root.render(createElement(VenuePriceSubmit, {
        venueId: "venue-1",
        venueName: "The Test Arms",
        communityPrices,
        laneCategory: "beer",
        mission: null,
        onLogged,
        onMissionComplete,
      }));
    });
    const composer = container.querySelector("#venue-price-submit-venue-1");
    const priceInput = container.querySelector<HTMLInputElement>(".vpsubInput");
    if (!composer || !priceInput) throw new Error("beer composer did not render");
    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setValue?.call(priceInput, "5.20");
      priceInput.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await act(async () => {
      root.render(createElement(VenuePriceSubmit, {
        venueId: "venue-1",
        venueName: "The Test Arms",
        communityPrices,
        laneCategory: "beer",
        mission: WINE_MISSION,
        onLogged,
        onMissionComplete,
      }));
    });
    expect(container.querySelector("#venue-price-submit-venue-1")).toBe(composer);
    expect(container.querySelector(".vpsubHeldDrink")?.textContent).toContain(
      "Clear the price to log wine instead.",
    );

    const logButton = container.querySelector<HTMLButtonElement>(".vpsubLog");
    if (!logButton) throw new Error("held beer Log it did not render");
    await act(async () => {
      logButton.click();
      await Promise.resolve();
    });

    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({ drinkCategory: "beer", priceGbp: "5.20" }),
      { accessToken: "test-access-token" },
    );
    expect(onLogged).toHaveBeenCalledWith("venue-1");
    expect(onMissionComplete).not.toHaveBeenCalled();
    expect(trackEvent.mock.calls.some(([name]) => name === "mission_submitted"))
      .toBe(false);
    expect(trackEvent.mock.calls.some(([name]) => name === "mission_newly_trusted"))
      .toBe(false);
  });

  it("lets a missing-price mission complete under the contributor's chosen drink", async () => {
    submit.mockResolvedValue({
      ok: true,
      attribution: { status: "credited", handle: "alice" },
      price: {
        id: "price-wine",
        venueId: "venue-1",
        drinkCategory: "wine",
        priceGbp: 5.75,
        submittedAt: Date.now(),
        source: "community",
        corroborations: 1,
      },
    });
    const onMissionComplete = vi.fn();

    await act(async () => {
      root.render(createElement(VenuePriceSubmit, {
        venueId: "venue-1",
        venueName: "The Test Arms",
        communityPrices,
        laneCategory: "beer",
        mission: { reason: "missing", surface: "map" },
        onMissionComplete,
      }));
    });
    const wineButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".vpsubCat"),
    ).find((button) => button.textContent === "Wine");
    const priceInput = container.querySelector<HTMLInputElement>(".vpsubInput");
    if (!wineButton || !priceInput) throw new Error("missing-price mission fields did not render");
    await act(async () => wineButton.click());
    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setValue?.call(priceInput, "5.75");
      priceInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const logButton = container.querySelector<HTMLButtonElement>(".vpsubLog");
    if (!logButton) throw new Error("missing-price mission Log it did not render");
    await act(async () => {
      logButton.click();
      await Promise.resolve();
    });

    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({ drinkCategory: "wine", priceGbp: "5.75" }),
      { accessToken: "test-access-token" },
    );
    expect(onMissionComplete).toHaveBeenCalledWith("venue-1");
    expect(trackEvent).toHaveBeenCalledWith(
      "mission_submitted",
      { surface: "map", reason: "missing", outcome: "needs_check" },
    );
  });

  it("shows a failed mission receipt without losing the price or drink", async () => {
    submit.mockResolvedValue({
      ok: false,
      error: "Could not confirm that price. It may still be logged.",
      reason: "rejected",
    });
    const onLogged = vi.fn();
    const onMissionComplete = vi.fn();

    await act(async () => {
      root.render(
        createElement(VenuePriceSubmit, {
          venueId: "venue-1",
          venueName: "The Test Arms",
          communityPrices,
          mission: { reason: "missing", surface: "map" },
          onLogged,
          onMissionComplete,
        }),
      );
    });

    const wineButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".vpsubCat"),
    ).find((button) => button.textContent === "Wine");
    const priceInput = container.querySelector<HTMLInputElement>(".vpsubInput");
    if (!wineButton || !priceInput) throw new Error("mission price fields did not render");

    await act(async () => {
      wineButton.click();
    });
    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setValue?.call(priceInput, "5.75");
      priceInput.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const logButton = container.querySelector<HTMLButtonElement>(".vpsubLog");
    if (!logButton) throw new Error("Log it button did not render");
    await act(async () => {
      logButton.click();
      await Promise.resolve();
    });

    expect(priceInput.value).toBe("5.75");
    expect(wineButton.getAttribute("aria-checked")).toBe("true");
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "Could not confirm that price. It may still be logged.",
    );
    expect(
      container.querySelector('.vpsubStampBlock[data-outcome="failed"]'),
    ).not.toBeNull();
    expect(container.querySelector(".vpsubStampTick")).toBeNull();
    expect(onLogged).not.toHaveBeenCalled();
    expect(onMissionComplete).not.toHaveBeenCalled();
    expect(trackEvent.mock.calls).toEqual([
      ["price_submit_failed", { category: "wine", reason: "rejected" }],
      [
        "mission_submitted",
        { surface: "map", reason: "missing", outcome: "failed" },
      ],
    ]);
  });

  it("records a failed mission before handing a stale session to the gate", async () => {
    submit.mockResolvedValue({
      ok: false,
      error: "Sign in to log that price.",
      reason: "rejected",
      status: "sign_in_required",
    });
    const onLogged = vi.fn();
    const onMissionComplete = vi.fn();

    await act(async () => {
      root.render(
        createElement(VenuePriceSubmit, {
          venueId: "venue-1",
          venueName: "The Test Arms",
          communityPrices,
          mission: {
            reason: "provisional",
            drinkCategory: "beer",
            surface: "near",
          },
          onLogged,
          onMissionComplete,
        }),
      );
    });

    const priceInput = container.querySelector<HTMLInputElement>(".vpsubInput");
    const logButton = container.querySelector<HTMLButtonElement>(".vpsubLog");
    if (!priceInput || !logButton) throw new Error("mission price fields did not render");
    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setValue?.call(priceInput, "5.20");
      priceInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      logButton.click();
      await Promise.resolve();
    });

    expect(onLogged).not.toHaveBeenCalled();
    expect(onMissionComplete).not.toHaveBeenCalled();
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(trackEvent.mock.calls).toEqual([
      ["price_submit_failed", { category: "beer", reason: "rejected" }],
      [
        "mission_submitted",
        {
          surface: "near",
          reason: "provisional",
          category: "beer",
          outcome: "failed",
        },
      ],
    ]);
  });
});
