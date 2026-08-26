import {
  drivesMap,
  isCorroborated,
  isWithinMaxAge,
  type CommunityPrice,
} from "@/lib/communityPrice";
import { DEFAULT_DRINK_LANE } from "@/lib/drinkLanes";
import type { DrinkCategory } from "@/lib/drinks";

/** Full choreography only when the previous reveal is at least this old. */
export const VENUE_REVEAL_STALE_MS = 8_000;

/** Short-form entrance duration when taps arrive in quick succession. */
export const VENUE_REVEAL_SHORT_MS = 160;

/** Total full-form choreography budget, overlapped with the camera move. */
export const VENUE_REVEAL_CINEMA_MS = 480;

export const VENUE_REVEAL_REDUCED_MOTION_QUERY =
  "(prefers-reduced-motion: reduce)";

export function venueRevealPrefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.(VENUE_REVEAL_REDUCED_MOTION_QUERY).matches === true
  );
}

export type VenueRevealForm = "full" | "short";

export type VenueRevealRequest = {
  sequence: number;
  venueId: string;
  startedAt: number;
  form: VenueRevealForm;
  rows: readonly CommunityPrice[] | undefined;
  lane: DrinkCategory;
  interrupted: boolean;
};

export type VenueDrinkPriceView = {
  rows: readonly CommunityPrice[] | undefined;
  lane: DrinkCategory;
};

export function venueDrinkPriceView(
  rows: readonly CommunityPrice[] | undefined,
  experienceLens: "all" | "no-alcohol" | "food",
  drinkLensCategory: DrinkCategory | null | undefined,
): VenueDrinkPriceView {
  if (experienceLens === "food") {
    return { rows: undefined, lane: DEFAULT_DRINK_LANE };
  }
  if (experienceLens === "no-alcohol") {
    return {
      rows: rows?.filter(
        (row) =>
          row.drinkCategory === "soft-drink" ||
          row.drinkCategory === "alcohol-free",
      ),
      lane: "alcohol-free",
    };
  }
  return {
    rows,
    lane: drinkLensCategory ?? DEFAULT_DRINK_LANE,
  };
}

/**
 * Whether a tap earns the four-beat entrance or the 160 ms short form.
 * Pure: pass timestamps through this helper in tests.
 */
export function revealForm(
  now: number,
  lastRevealAt: number | null,
): VenueRevealForm {
  if (lastRevealAt === null || !Number.isFinite(lastRevealAt)) return "full";
  if (now - lastRevealAt >= VENUE_REVEAL_STALE_MS) return "full";
  return "short";
}

/**
 * Beat 3 motion grammar: the Beermat Drop is earned only by a corroborated,
 * in-window community figure. Provisional rows slide flat; unknown stays still.
 */
export type VenuePriceRevealMotion = "drop" | "slide" | "static";

export type VenuePriceRevealInput = {
  /** Freshest community row for the lead drink lane, if any. */
  communityLead:
    | (Pick<CommunityPrice, "corroborations" | "submittedAt"> & {
        mapCandidate?: CommunityPrice["mapCandidate"] | null;
      })
    | null
    | undefined;
};

export function venuePriceRevealMotion(
  input: VenuePriceRevealInput,
  now: number = Date.now(),
): VenuePriceRevealMotion {
  const lead = input.communityLead;
  if (!lead) return "static";
  if (drivesMap(lead, now)) return "drop";
  if (isWithinMaxAge(lead, now) && !isCorroborated(lead)) return "slide";
  return "static";
}

/** CSS class suffix for beat 3 chrome animation. */
export function venuePriceRevealMotionClass(
  motion: VenuePriceRevealMotion,
): string {
  if (motion === "drop") return "venueRevealPriceChrome--drop";
  if (motion === "slide") return "venueRevealPriceChrome--slide";
  return "venueRevealPriceChrome--static";
}

/** Root reveal classes for the inspector shell. */
export function venueRevealRootClasses(input: {
  active: boolean;
  form: VenueRevealForm;
  interrupted: boolean;
}): string {
  if (!input.active || input.interrupted) return "";
  return `venueReveal venueReveal--${input.form}`;
}
