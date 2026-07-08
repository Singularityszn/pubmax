// G3 — Place story deep-link onboarding chip.
// Pure helpers for when `?band={id}` should surface a dismissible corridor
// explainer, and for suppressing the curated "Start with a story" overlay so
// the two never fight. Session dismiss key is distinct from curated onboarding.

/** sessionStorage key prefix; append `:${bandId}` for per-band dismiss. */
export const BAND_CHIP_DISMISSED_KEY_PREFIX = "pubmax_band_chip_dismissed";

export function bandChipDismissedKey(bandId: string): string {
  return `${BAND_CHIP_DISMISSED_KEY_PREFIX}:${bandId}`;
}

/** One short line for the chip; ellipsis when the band copy runs long. */
export function truncateBandCopy(copy: string, maxChars = 96): string {
  const trimmed = copy.trim().replace(/\s+/g, " ");
  if (trimmed.length <= maxChars) return trimmed;
  const cut = trimmed.slice(0, Math.max(1, maxChars - 1));
  const lastSpace = cut.lastIndexOf(" ");
  const base = lastSpace > Math.floor(maxChars * 0.4) ? cut.slice(0, lastSpace) : cut;
  return `${base.replace(/[.,;:\s]+$/u, "")}…`;
}

export function shouldShowBandOnboardingChip(input: {
  loaded: boolean;
  activeBandId: string;
  bandResolved: boolean;
  chipDismissed: boolean;
}): boolean {
  return (
    input.loaded &&
    Boolean(input.activeBandId) &&
    input.bandResolved &&
    !input.chipDismissed
  );
}

/**
 * Curated crawl onboarding. When the band deep-link chip is showing, curated
 * onboarding is suppressed so the deep link feels intentional (G3 priority).
 */
export function shouldShowCuratedOnboarding(input: {
  loaded: boolean;
  onboardingDismissed: boolean;
  arrivedWithCrawlParams: boolean;
  mode: string;
  builtIdsCount: number;
  hasActiveCrawl: boolean;
  selectedVenueId: string;
  showBandChip: boolean;
}): boolean {
  if (input.showBandChip) return false;
  return (
    input.loaded &&
    !input.onboardingDismissed &&
    !input.arrivedWithCrawlParams &&
    input.mode === "suggest" &&
    input.builtIdsCount === 0 &&
    !input.hasActiveCrawl &&
    !input.selectedVenueId
  );
}
