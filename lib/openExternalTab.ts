/**
 * Open a link in a new tab and say whether it opened.
 *
 * `window.open(href, "_blank", "noopener")` opens the tab and then returns
 * null, by the HTML spec, every time. Four share buttons read that null as a
 * blocked popup: the tab opened, the drinker was told "Could not open
 * WhatsApp", and the share event was never sent, so `plan_invite_sent` had
 * never reached PostHog. Opening without the feature and cutting `opener` by
 * hand keeps the return value honest (null means a blocker really ate it) and
 * still leaves the new tab no handle on this page.
 */
export function openExternalTab(href: string): boolean {
  if (typeof window === "undefined") return false;
  const tab = window.open(href, "_blank");
  if (!tab) return false;
  try {
    tab.opener = null;
  } catch {
    // A tab that refuses the write is cross-origin already and has no handle.
  }
  return true;
}
