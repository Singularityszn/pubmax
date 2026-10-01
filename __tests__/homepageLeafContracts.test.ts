// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { formatPrice } from "@/lib/formatGbp";
import { formatPrice as venueFormatPrice } from "@/lib/venues";
import {
  dismissMapFirstVisitArrival,
  mapFirstVisitArrivalBlocksConsent as legacyArrivalBlocksConsent,
  setMapFirstVisitArrivalCardVisible as legacySetArrivalVisible,
} from "@/lib/mapFirstVisitArrival";
import {
  MAP_FIRST_VISIT_ARRIVAL_KEY,
  hasDismissedMapFirstVisitArrival,
  mapFirstVisitArrivalBlocksConsent,
  setMapFirstVisitArrivalCardVisible,
  subscribeMapFirstVisitArrival,
} from "@/lib/mapFirstVisitArrivalStore";
import { locationAllowsInterruptivePrompt } from "@/lib/promptBudget";
import {
  MOBILE_SHEET_DISMISS_EVENT,
  requestMobileSheetDismiss,
} from "@/lib/mobileSheetDismiss";
import { requestMobileSheetDismiss as legacyRequestSheetDismiss } from "@/lib/mobileShell";
import { isPlanId } from "@/lib/planId";
import { isPlanId as legacyIsPlanId } from "@/lib/plan";
import { safePlanReturnTo } from "@/lib/accountClaimReturnTo";

beforeEach(() => {
  window.localStorage.clear();
  setMapFirstVisitArrivalCardVisible(false);
});

afterEach(() => {
  setMapFirstVisitArrivalCardVisible(false);
});

describe("homepage leaf contracts", () => {
  it("shares arrival visibility and consent blocking across both imports", () => {
    legacySetArrivalVisible(true);
    expect(mapFirstVisitArrivalBlocksConsent()).toBe(true);
    expect(locationAllowsInterruptivePrompt()).toBe(false);
    setMapFirstVisitArrivalCardVisible(false);
    expect(legacyArrivalBlocksConsent()).toBe(false);
    expect(locationAllowsInterruptivePrompt()).toBe(true);
  });

  it("keeps dismissal, visibility and storage notifications on one subscription", () => {
    const changed = vi.fn();
    const unsubscribe = subscribeMapFirstVisitArrival(changed);
    try {
      dismissMapFirstVisitArrival();
      expect(hasDismissedMapFirstVisitArrival()).toBe(true);
      expect(window.localStorage.getItem(MAP_FIRST_VISIT_ARRIVAL_KEY)).toBe("dismissed");
      expect(changed).toHaveBeenCalledTimes(1);
      legacySetArrivalVisible(true);
      setMapFirstVisitArrivalCardVisible(true);
      expect(changed).toHaveBeenCalledTimes(2);
      window.dispatchEvent(new StorageEvent("storage"));
      expect(changed).toHaveBeenCalledTimes(3);
      unsubscribe();
      setMapFirstVisitArrivalCardVisible(false);
      window.dispatchEvent(new StorageEvent("storage"));
      expect(changed).toHaveBeenCalledTimes(3);
    } finally {
      unsubscribe();
    }
  });

  it("dispatches the same sheet-dismiss event through leaf and existing imports", () => {
    const dismissed = vi.fn();
    window.addEventListener(MOBILE_SHEET_DISMISS_EVENT, dismissed);
    try {
      requestMobileSheetDismiss();
      legacyRequestSheetDismiss();
      expect(dismissed).toHaveBeenCalledTimes(2);
      expect(dismissed.mock.calls[0]?.[0]).toBeInstanceOf(CustomEvent);
      expect(dismissed.mock.calls[0]?.[0].type).toBe("pubmax:mobile-sheet-dismiss");
    } finally {
      window.removeEventListener(MOBILE_SHEET_DISMISS_EVENT, dismissed);
    }
  });

  it("keeps one price formatter behind both imports", () => {
    expect(venueFormatPrice).toBe(formatPrice);
    expect(formatPrice(5.4)).toBe("£5.40");
    expect(formatPrice(null)).toBe("No price");
  });

  it("keeps one plan-ID guard behind return-to validation and existing imports", () => {
    const planId = "123e4567-e89b-12d3-a456-426614174000";
    expect(legacyIsPlanId).toBe(isPlanId);
    expect(isPlanId(planId)).toBe(true);
    expect(isPlanId(null)).toBe(false);
    expect(safePlanReturnTo(`/plan/${planId}`)).toBe(`/plan/${planId}`);
    expect(safePlanReturnTo("/plan/not-a-plan")).toBeNull();
  });
});
