"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BRAND_NAME } from "@/lib/brandNaming";
import { useEffect, useState } from "react";

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
  claimScreenFoot,
  hasScreenFootFor,
  routeOwnsScreenFoot,
  subscribePromptBudget,
} from "@/lib/promptBudget";

type AnalyticsConsentPromptContentProps = {
  onDecision: (granted: boolean) => void;
};

// ONE ROW. The sentence sits beside both choices in a 56px strip, so it is kept
// short enough to wrap inside that row on a 320px phone
// (__tests__/analyticsConsentRow.test.ts). It still names the brand
// (lib/brandNaming.ts), says what is collected and why, and that it is never
// sold; the rest is one tap away on /privacy.
export function AnalyticsConsentPromptContent({
  onDecision,
}: AnalyticsConsentPromptContentProps) {
  return (
    <aside
      className="analyticsConsentPrompt"
      aria-label="Anonymous analytics choice"
    >
      <p>
        {BRAND_NAME} optional analytics: what people use. Never sold.{" "}
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
  // A route whose own chrome owns the foot of the screen (the map: its outing
  // pill and the dock) is never stacked on. The ask waits for the next route
  // and the session's slot stays unspent (lib/promptBudget.ts). Read in render
  // as well as in the effect, so the card cannot paint for one frame on the
  // way into the map.
  const routeOwnsFoot = routeOwnsScreenFoot(pathname);

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
      const canShow = hasScreenFootFor(ANALYTICS_CONSENT_PROMPT_SURFACE, pathname);
      const claimed = canShow
        && claimScreenFoot(ANALYTICS_CONSENT_PROMPT_SURFACE, pathname);
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
  if (routeOwnsFoot) return null;
  if (decision !== null) return null;

  function decide(granted: boolean) {
    setAnalyticsConsent(granted);
    setDecision(granted ? "granted" : "denied");
  }

  return <AnalyticsConsentPromptContent onDecision={decide} />;
}
