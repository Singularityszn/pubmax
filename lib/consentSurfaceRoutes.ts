// A reader is offered the analytics decision ONCE per screen.
//
// The account settings block (`#analytics-settings` in
// `components/profile/PubmaxxAccountHub.tsx`) is a LIVE consent control: while
// the choice is open it paints the same Allow / No thanks pair the fixed
// arrival bar does, and once it is made it keeps a one-line status carrying the
// way to reverse it. So on a route whose own document carries that block the
// arrival bar (`components/AnalyticsConsentPrompt.tsx`) does not render, and
// everywhere else it stays exactly as it was.
//
// The rule is stated over the ROUTE rather than earned by the block announcing
// itself at mount, because the hub is a dynamic import: a registration seam
// would paint the bar first and take it away a chunk-load later, which is a
// flash rather than a fix.
//
// The block lives on the `/u/` profile family alone: `app/u/[handle]/
// ProfilePageClient.tsx` mounts it for the owner's own profile and on the
// `/u/you` sentinel. A stranger's profile carries no block and merely DEFERS
// the ask to the next route rather than losing it, because this answer is
// pathname-driven and the session's prompt budget is never spent on a route
// the bar does not paint on.
//
// The SIGNED-OUT `/u/you` panel is the same deferral. It used to carry a
// SECOND Allow / No thanks pair of its own, so a stranger met the analytics
// question twice in one column of copy; that pair is gone
// (components/profile/PubmaxxAccountHub.tsx) and the settings block is now the
// signed-in control alone, where a decision can be REVERSED. Signed out, the
// profile family therefore asks nothing and the docked card catches the reader
// on the next route, which is also one of the moments that ends the card's own
// wait (lib/consentAnswerMoment.ts). Keeping the rule pathname-driven rather
// than branching on the live session is deliberate: a session-driven answer
// would paint the card and take it away once the session resolved, which is a
// flash rather than a fix, and that is the same reason the block does not
// announce itself at mount.

/** The one route family whose own document carries a live consent control. */
const CONSENT_CONTROL_ROUTE_PREFIX = "/u";

/**
 * Whether the page at `pathname` carries its own live consent control, and so
 * owns the analytics decision on that screen. A pathname we cannot read answers
 * false, because the arrival bar staying is the behaviour every other route has.
 */
export function routeCarriesConsentControl(
  pathname: string | null | undefined,
): boolean {
  if (typeof pathname !== "string") return false;
  const path = (pathname.split(/[?#]/)[0] ?? "").replace(/\/+$/, "");
  if (path === "") return false;
  return (
    path === CONSENT_CONTROL_ROUTE_PREFIX
    || path.startsWith(`${CONSENT_CONTROL_ROUTE_PREFIX}/`)
  );
}
