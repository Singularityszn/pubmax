"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BRAND_NAME } from "@/lib/brandNaming";
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

import {
  analyticsConsentDecision,
  setAnalyticsConsent,
  subscribeAnalyticsConsent,
} from "@/lib/analytics";
import type { AnalyticsConsentDecision } from "@/lib/analyticsIdentity";
import {
  hasAnsweredThisSession,
  noteConsentRouteVisited,
  subscribeConsentAnswerMoment,
} from "@/lib/consentAnswerMoment";
import { routeCarriesConsentControl } from "@/lib/consentSurfaceRoutes";
import {
  ANALYTICS_CONSENT_PROMPT_SURFACE,
  claimPromptBudget,
  hasPromptBudgetFor,
  subscribePromptBudget,
} from "@/lib/promptBudget";

type AnalyticsConsentPromptContentProps = {
  onDecision: (granted: boolean) => void;
};

// ONE ROW. The sentence sits beside both choices in a 56px strip, so it is kept
// short enough to wrap inside that row on a 320px phone
// (__tests__/analyticsConsentRow.test.ts). It still names the brand
// (lib/brandNaming.ts), says what is collected and why, and that it is never
// sold and carries no ads; the rest is one tap away on /privacy.
// The page reserves the card's REAL height while it is mounted, so the foot
// clears the card at every text size and wrap, and the reserve is gone the
// moment the card is (app/globals.css reads --analytics-consent-reserve).
function useConsentReserve(card: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const element = card.current;
    if (!element) return;
    const root = document.documentElement;
    const publish = () => {
      root.style.setProperty(
        "--analytics-consent-reserve",
        `${Math.ceil(element.getBoundingClientRect().height)}px`,
      );
    };
    publish();
    const onFocusIn = (event: FocusEvent) => {
      const focused = event.target;
      if (!(focused instanceof HTMLElement)) return;
      clearFocusedFieldAboveConsentCard(element, focused);
    };
    document.addEventListener("focusin", onFocusIn);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(publish);
    observer?.observe(element);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      observer?.disconnect();
      root.style.removeProperty("--analytics-consent-reserve");
    };
  }, [card]);
}

type Box = { top: number; bottom: number; height: number; width: number };

/** Pixels to scroll so a focused box finishes fully above the consent card. */
export function consentFocusScrollDelta(box: Box, lane: { top: number; bottom: number }): number {
  if (box.height <= 0 || box.width <= 0) return 0;
  if (box.bottom <= lane.top || box.top >= lane.bottom) return 0;
  return box.bottom - lane.top;
}

function scrollingAncestor(node: HTMLElement): HTMLElement | null {
  let parent = node.parentElement;
  while (parent) {
    const overflow = getComputedStyle(parent).overflowY;
    if (
      (overflow === "auto" || overflow === "scroll")
      && parent.scrollHeight > parent.clientHeight + 1
    ) {
      return parent;
    }
    parent = parent.parentElement;
  }
  return null;
}

function clearFocusedFieldAboveConsentCard(card: HTMLElement, focused: HTMLElement): void {
  if (card.contains(focused) || focused.closest(".mobileTabBar")) return;
  // An open sheet hides the card (app/globals.css), and a hidden card covers
  // nothing. Clearing its lane anyway scrolled the sheet between pointerdown
  // and pointerup, so a tap on a control there landed on the line below it.
  if (getComputedStyle(card).visibility === "hidden") return;
  const lane = card.getBoundingClientRect();
  const delta = Math.ceil(consentFocusScrollDelta(focused.getBoundingClientRect(), lane));
  if (delta <= 0) return;
  // The root scroll-padding already names this lane. Chromium's own focus
  // scroll still leaves a field under the card, so the field is moved by the
  // overlap itself. The card is fixed, so the lane does not move with the page.
  window.scrollBy(0, delta);
  const remaining = Math.ceil(
    consentFocusScrollDelta(focused.getBoundingClientRect(), lane),
  );
  if (remaining <= 0) return;
  const scroller = scrollingAncestor(focused);
  if (scroller) scroller.scrollTop += remaining;
}

export function AnalyticsConsentPromptContent({
  onDecision,
}: AnalyticsConsentPromptContentProps) {
  const cardRef = useRef<HTMLElement | null>(null);
  useConsentReserve(cardRef);
  return (
    <aside
      ref={cardRef}
      className="analyticsConsentPrompt"
      aria-label="Anonymous analytics choice"
    >
      <p>
        {BRAND_NAME} analytics show us what people use. Never sold, no ads.{" "}
        <Link href="/privacy">Privacy</Link>
      </p>
      <div className="analyticsConsentPromptActions">
        <button type="button" onClick={() => onDecision(true)}>Allow</button>
        <button type="button" onClick={() => onDecision(false)}>No thanks</button>
      </div>
    </aside>
  );
}

export default function AnalyticsConsentPrompt() {
  const [decision, setDecision] = useState<AnalyticsConsentDecision | null | "checking">("checking");
  const pathname = usePathname();
  // One decision per screen: a route carrying its own live consent control owns
  // the ask, so the arrival bar neither paints there nor spends the session's
  // prompt budget on a moment nobody sees (lib/consentSurfaceRoutes.ts).
  const pageOwnsConsent = routeCarriesConsentControl(pathname);

  // THE ROUTE IS RECORDED ON EVERY SCREEN, INCLUDING THE ONES THE BAR NEVER
  // PAINTS ON. Reaching a second route is one of the answers that ends the
  // wait (lib/consentAnswerMoment.ts), and a reader who arrives on /u/you and
  // moves on has still been given somewhere to go; skipping the note there
  // would make the profile family invisible to the count and delay the ask by
  // a whole extra route.
  useEffect(() => {
    noteConsentRouteVisited(pathname);
  }, [pathname]);

  useEffect(() => {
    if (pageOwnsConsent) return;
    let cancelled = false;
    const refresh = () => {
      const nextDecision = analyticsConsentDecision();
      if (nextDecision !== null) {
        setDecision(nextDecision);
        return;
      }
      // THE ANSWER COMES FIRST. Until the product has answered this reader the
      // card neither paints nor CLAIMS the session's one interruptive slot:
      // claiming it early would hold the slot open across the whole wait and
      // starve whichever surface is genuinely next.
      if (!hasAnsweredThisSession()) {
        setDecision("checking");
        return;
      }
      const canShow = hasPromptBudgetFor(ANALYTICS_CONSENT_PROMPT_SURFACE);
      const claimed = canShow
        && claimPromptBudget(ANALYTICS_CONSENT_PROMPT_SURFACE);
      setDecision(claimed ? null : "checking");
    };
    void Promise.resolve().then(() => {
      if (!cancelled) refresh();
    });
    const unsubscribeConsent = subscribeAnalyticsConsent(refresh);
    const unsubscribeBudget = subscribePromptBudget(refresh);
    const unsubscribeAnswer = subscribeConsentAnswerMoment(refresh);
    return () => {
      cancelled = true;
      unsubscribeConsent();
      unsubscribeBudget();
      unsubscribeAnswer();
    };
  }, [pageOwnsConsent, pathname]);

  if (pageOwnsConsent) return null;
  if (decision !== null) return null;

  function decide(granted: boolean) {
    setAnalyticsConsent(granted);
    setDecision(granted ? "granted" : "denied");
  }

  return <AnalyticsConsentPromptContent onDecision={decide} />;
}
