// One-shot amplify for the desktop map price key after the first-run tour is
// already done. Never stacks with FirstRunTour: the tour is the interruptive
// band-colour beat; this only auto-opens the existing MapPriceControl once the
// tour storage says the visitor has already seen it. Session-scoped so a
// refresh in the same tab does not re-open the panel.

import {
  ANALYTICS_CONSENT_STORAGE_KEY,
  isAnalyticsConsentDecision,
} from "@/lib/analyticsIdentity";
import {
  restoredSessionHasExplicitIntent,
  searchHasExplicitMapIntent,
} from "@/lib/explicitMapIntent";
import { hasSeenTour } from "@/lib/firstRunTour";
import { readMobileMapSession } from "@/lib/mobileShell";
import { safeLocalStorage, safeSessionStorage } from "@/lib/safeStorage";

/** sessionStorage key: written when the one-shot amplify has fired. */
export const MAP_LEGEND_ONESHOT_KEY = "pubmax:map-legend-oneshot:v1";

function consentIsDecided(consentStorage?: Storage | null): boolean {
  const store = consentStorage ?? safeLocalStorage();
  if (!store) return false;
  try {
    return isAnalyticsConsentDecision(store.getItem(ANALYTICS_CONSENT_STORAGE_KEY));
  } catch {
    return false;
  }
}

export function hasConsumedMapLegendOneshot(
  storage?: Storage | null,
): boolean {
  const store = storage ?? safeSessionStorage();
  if (!store) return true;
  try {
    return store.getItem(MAP_LEGEND_ONESHOT_KEY) === "1";
  } catch {
    return true;
  }
}

export function markMapLegendOneshotConsumed(
  storage?: Storage | null,
): void {
  const store = storage ?? safeSessionStorage();
  if (!store) return;
  try {
    store.setItem(MAP_LEGEND_ONESHOT_KEY, "1");
  } catch {
    // Storage full / private mode — degrade silently.
  }
}

/**
 * Whether MapPriceControl may auto-open once this session.
 * Requires: tour already seen (so we are not stacking), analytics consent
 * decided, no explicit map arrival, and oneshot not yet consumed.
 */
export function shouldAutoOpenMapLegendOneshot(params?: {
  storage?: Storage | null;
  consentStorage?: Storage | null;
  search?: string;
  hasExplicitIntent?: boolean;
}): boolean {
  if (typeof window === "undefined") return false;
  const storage = params?.storage ?? null;
  if (!hasSeenTour()) return false;
  if (hasConsumedMapLegendOneshot(storage)) return false;
  if (!consentIsDecided(params?.consentStorage)) return false;
  const explicit =
    params?.hasExplicitIntent ??
    (searchHasExplicitMapIntent(params?.search ?? window.location.search) ||
      restoredSessionHasExplicitIntent(readMobileMapSession()));
  if (explicit) return false;
  return true;
}
