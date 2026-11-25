// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const submit = vi.hoisted(() => vi.fn());
const shell = vi.hoisted(() => ({ native: false, pick: vi.fn() }));
vi.mock("@/lib/nativePlatform", () => ({
  isNativeApp: () => shell.native,
  nativePlatform: () => shell.native ? "android" : null,
}));
vi.mock("@/lib/nativeCamera", () => ({ pickNativePhoto: shell.pick }));

vi.mock("@/components/identity/ContributionGateDialog", () => ({
  useContributionGate: () => ({
    requestContribution: async (action: (auth: { accessToken: string }) => unknown) => {
      await action({ accessToken: "test-access-token" });
    },
    contributionGateDialog: null,
  }),
}));

vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("@/components/map/PriceContributionImpact", () => ({
  default: () => null,
}));

import { attachBill } from "./helpers/oneTapBill";

import VenuePriceSubmit from "@/components/map/VenuePriceSubmit";
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

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;
  shell.native = false;
  shell.pick.mockReset();
  submit.mockReset();
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
      price: null,
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

    await attachBill(container);
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
});

describe("Pint Drop native picker recovery", () => {
  it.each([
    ["receipt-photo-btn", "blocked"], ["receipt-photo-btn", "cancelled"],
    ["pint-photo-btn", "blocked"], ["pint-photo-btn", "cancelled"],
    ["receipt-photo-btn", "failed"], ["pint-photo-btn", "failed"],
  ])("handles %s returning %s without submitting", async (testId, outcome) => {
    shell.native = true;
    const message = outcome === "failed" ? "Selected photo unreadable." : "Enable the camera in Settings.";
    shell.pick.mockResolvedValue({ outcome, message });
    await act(async () => root.render(createElement(VenuePriceSubmit, {
      venueId: "venue-1", venueName: "The Test Arms", communityPrices,
    })));
    if (testId === "pint-photo-btn") await attachBill(container);
    const before = container.querySelector('[role="alert"]')?.textContent ?? "";
    await act(async () => container.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`)!.click());
    expect(shell.pick).toHaveBeenCalledWith("pint");
    expect(container.querySelector('[role="alert"]')?.textContent ?? "").toBe(outcome === "cancelled" ? before : message);
    expect(container.querySelectorAll(".vpsubPhotoClear")).toHaveLength(testId === "pint-photo-btn" ? 1 : 0);
    expect(submit).not.toHaveBeenCalled();
  });
});
