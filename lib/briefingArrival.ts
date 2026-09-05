// The daily brief's own landing marker, in ONE place.
//
// `broadcastDailyBrief` (lib/pushSender.ts) sends the reader to /today, and the
// service worker's `safeNotificationPath` keeps a same-origin path AND its
// search string, so the notification can name itself on the way in. That marker
// is what lets `briefing_opened` mean "the brief was reached from the brief"
// rather than "somebody was on /today", and a URL written in the sender that
// drifts from the string the page reads would answer zero forever with nothing
// saying so. Both sides read this module.
//
// The marker carries no campaign, no identity and no timestamp: it is one fixed
// key and one fixed value, which is the whole reason it may ride in a URL at
// all (see docs/analytics/TRACKING_PLAN.md section 7).

/** Query key the daily-brief notification lands with. */
export const BRIEFING_ARRIVAL_PARAM = "from";

/** Its one permitted value. Anything else is an ordinary arrival. */
export const BRIEFING_ARRIVAL_VALUE = "brief";

/** The surface a daily brief opens. */
export const BRIEFING_ARRIVAL_PATH = "/today";

/** The exact URL `broadcastDailyBrief` puts in its notification payload. */
export const BRIEFING_PUSH_URL =
  `${BRIEFING_ARRIVAL_PATH}?${BRIEFING_ARRIVAL_PARAM}=${BRIEFING_ARRIVAL_VALUE}`;

/**
 * Did this arrival come from the daily-brief notification?
 *
 * Takes the search string rather than reading `window.location` itself, so the
 * rule is testable and the caller owns when it is asked (after mount, never
 * during a server render, because the server has no reader's URL to read).
 */
export function arrivedFromBriefingPush(search: string | null | undefined): boolean {
  if (!search) return false;
  try {
    return new URLSearchParams(search).get(BRIEFING_ARRIVAL_PARAM) === BRIEFING_ARRIVAL_VALUE;
  } catch {
    // A search string a browser would not have produced is not an arrival.
    return false;
  }
}
