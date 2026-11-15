/** Cross-component cue: open Night Crawl on the plan page (first "here"). */
export const NIGHT_CRAWL_ENGAGE_EVENT = "pubmax:night-crawl-engage";

/** A stop action Night Crawl confirmed, so other surfaces of the plan read it again. */
export const NIGHT_CRAWL_STOP_CONFIRMED_EVENT = "pubmax:night-crawl-stop-confirmed";

export function announceNightCrawlStopConfirmed(planId: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(NIGHT_CRAWL_STOP_CONFIRMED_EVENT, { detail: { planId } }));
}
