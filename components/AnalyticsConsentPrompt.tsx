"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BRAND_NAME } from "@/lib/brandNaming";
import { type Ref, useEffect, useLayoutEffect, useRef, useState } from "react";

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
  ref?: Ref<HTMLElement>;
};

/** The phone lane the page, the first-run surface and the map controls read. */
const CONSENT_LANE_PROPERTY = "--analytics-consent-mobile-clearance";
/** The row's own bottom padding, without any home-indicator inset. */
const ROW_FOOT_PX = 6;

// ONE ROW. The sentence sits beside both choices in a 56px strip, so it is kept
// short enough to wrap inside that row on a 320px phone
// (__tests__/analyticsConsentRow.test.ts). It still names the brand
// (lib/brandNaming.ts), says what is collected and why, and that it is never
// sold and carries no ads; the rest is one tap away on /privacy.
export function AnalyticsConsentPromptContent({
  onDecision,
  ref,
}: AnalyticsConsentPromptContentProps) {
  return (
    <aside
      ref={ref}
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
  }, [pageOwnsConsent]);

  // THE LANE IS THE ROW AS IT PAINTS. At an ordinary text size that is 56px,
  // but larger text grows the row, and a fixed lane would leave the page foot
  // and the map controls under it. The inset padding is left out, because the
  // rules that read the lane add the inset themselves.
  const rowRef = useRef<HTMLElement>(null);
  const showing = !pageOwnsConsent && decision === null;
  useLayoutEffect(() => {
    const row = rowRef.current;
    if (!showing || !row) return;
    const root = document.documentElement;
    const publish = () => {
      const top = row.getBoundingClientRect().top;
      const foot = Math.max(
        top,
        ...Array.from(row.children, (child) => child.getBoundingClientRect().bottom),
      );
      root.style.setProperty(CONSENT_LANE_PROPERTY, `${Math.ceil(foot - top + ROW_FOOT_PX)}px`);
    };
    publish();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(publish);
    observer?.observe(row);
    return () => {
      observer?.disconnect();
      root.style.removeProperty(CONSENT_LANE_PROPERTY);
    };
  }, [showing]);

  if (pageOwnsConsent) return null;
  if (decision !== null) return null;

  function decide(granted: boolean) {
    setAnalyticsConsent(granted);
    setDecision(granted ? "granted" : "denied");
  }

  return <AnalyticsConsentPromptContent ref={rowRef} onDecision={decide} />;
}
