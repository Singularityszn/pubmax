"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import PriceBadge from "@/components/PriceBadge";
import Kicker from "@/components/ui/kicker";
import { accountBoundFetch, captureAccountAuth, type AccountAuthSnapshot } from "@/lib/accountBoundFetch";
import { compositeActionSignal } from "@/lib/authedFetch";
import { readProviderAccountSignal } from "@/lib/authProviderRevision";
import { formatObservedDate } from "@/lib/dataFreshnessFormat";
import { formatPence } from "@/lib/formatGbp";
import { readNightReceiptPayload, type NightReceipt } from "@/lib/nightReceipt";
import type { CrawlEnding } from "@/lib/plan";
import {
  parsePlanCapabilitySnapshot,
  planAccountClaimEvent,
  planCapabilityEvent,
  readPlanCapabilitySnapshot,
} from "@/lib/planSessionCapability";
import { discardBody } from "@/lib/responseBody";

import "./planNightReceipt.css";

// The owner's private receipt for a completed Plan. The server never renders
// it. A Plan capability cookie belongs to the device, so it cannot prove which
// account is reading: one device can hold A's host cookie while B is signed in.
// Only the account-bound receipt read can answer (lib/nightReceipt.server.ts),
// and it checks that the host seat's account is the signed-in account. Each
// account gets its own component lifetime and its own reads. A refusal, an
// unavailable check or an unreadable answer clears the receipt, and the page
// asks again when the app comes back into view.

const ENDING_WORDS: Record<CrawlEnding, string> = {
  food: "With food",
  get_home: "Heading home",
  keep_going: "Carrying on",
};

const PLANNED_FOR = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

/** "Friday 14 November 2026, 7pm" in London time. */
function plannedForWords(iso: string): string {
  const parts = PLANNED_FOR.formatToParts(new Date(iso));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === type)?.value ?? "";
  const minute = part("minute");
  const period = part("dayPeriod").replace(/[\s.]/g, "").toLowerCase();
  const clock = `${String(Number(part("hour")) || 12)}${minute && minute !== "00" ? `:${minute}` : ""}${period}`;
  return `${part("weekday")} ${part("day")} ${part("month")} ${part("year")}, ${clock}`;
}

function usePlanCapabilitySnapshot(planId: string): string {
  return useSyncExternalStore(
    (onChange) => {
      const event = planCapabilityEvent(planId);
      window.addEventListener(event, onChange);
      return () => window.removeEventListener(event, onChange);
    },
    () => readPlanCapabilitySnapshot(planId),
    () => "|0|",
  );
}

/** The receipt this account may see, or null for any refusal or doubt. */
async function readOwnedReceipt(auth: AccountAuthSnapshot, planId: string, signal: AbortSignal): Promise<NightReceipt | null> {
  try {
    const response = await accountBoundFetch(auth, `/api/plans/${planId}?view=receipt`, { cache: "no-store", signal });
    if (!response.ok) {
      discardBody(response);
      return null;
    }
    return readNightReceiptPayload(await response.json());
  } catch {
    return null;
  }
}

function useRecheckCount(planId: string): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const recheck = () => {
      if (document.visibilityState !== "hidden") setCount((current) => current + 1);
    };
    window.addEventListener("focus", recheck);
    const claimed = planAccountClaimEvent(planId);
    window.addEventListener(claimed, recheck);
    document.addEventListener("visibilitychange", recheck);
    return () => {
      window.removeEventListener("focus", recheck);
      window.removeEventListener(claimed, recheck);
      document.removeEventListener("visibilitychange", recheck);
    };
  }, [planId]);
  return count;
}

function Receipt({ receipt }: { receipt: NightReceipt }) {
  return (
    <section className="planNightReceipt" aria-labelledby="plan-night-receipt-title" data-testid="plan-night-receipt">
      <Kicker>Private to you</Kicker>
      <h2 id="plan-night-receipt-title" className="planNightReceipt__title">Your night receipt</h2>
      <p className="planNightReceipt__name">{receipt.title}</p>
      {receipt.plannedFor ? (
        <p className="planNightReceipt__when">
          Planned for <time dateTime={receipt.plannedFor}>{plannedForWords(receipt.plannedFor)}</time>
        </p>
      ) : null}
      {receipt.stops.length ? (
        <ol className="planNightReceipt__stops" aria-label="Stops on the plan">
          {receipt.stops.map((stop) => (
            <li key={`${stop.position}-${stop.venueName}`} className="planNightReceipt__stop">
              <span className="planNightReceipt__number" aria-hidden="true">{stop.position + 1}</span>
              <div className="planNightReceipt__stopBody">
                <span className="planNightReceipt__venue">{stop.venueName}</span>
                {stop.price ? (
                  <span className="planNightReceipt__price">
                    <PriceBadge variant="neutral">{formatPence(stop.price.pence)}</PriceBadge>
                    <span className="planNightReceipt__source">
                      {stop.price.drink}, logged by a drinker{" "}
                      <time dateTime={stop.price.reportedAt}>{formatObservedDate(new Date(stop.price.reportedAt))}</time>
                      {" · "}Serving size not recorded
                    </span>
                  </span>
                ) : (
                  <span className="planNightReceipt__source">No price saved with this plan</span>
                )}
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="planNightReceipt__source">No stops on record.</p>
      )}
      <p className="planNightReceipt__note">
        A price here is one a drinker logged, saved with the plan. It is not what you paid.
      </p>
      <dl className="planNightReceipt__facts">
        <div className="planNightReceipt__fact">
          <dt>What you paid</dt>
          <dd>Not recorded</dd>
        </div>
        {receipt.ending ? (
          <div className="planNightReceipt__fact">
            <dt>How the plan ended</dt>
            <dd>{ENDING_WORDS[receipt.ending]}</dd>
          </div>
        ) : null}
      </dl>
      <p className="planNightReceipt__privacy">Crew names stay off this receipt. We share none of it.</p>
    </section>
  );
}

function OwnerReceipt({ planId, userId, accessToken }: { planId: string; userId: string; accessToken: string }) {
  const capability = usePlanCapabilitySnapshot(planId);
  const { role } = parsePlanCapabilitySnapshot(capability);
  const returns = useRecheckCount(planId);
  const [shown, setShown] = useState<{ capability: string; receipt: NightReceipt } | null>(null);
  useEffect(() => {
    if (role !== "host") return;
    const retired = new AbortController();
    const signal = compositeActionSignal([retired.signal, readProviderAccountSignal()]);
    void readOwnedReceipt({ userId, accessToken }, planId, signal).then((receipt) => {
      if (!signal.aborted) setShown(receipt ? { capability, receipt } : null);
    });
    return () => retired.abort();
  }, [accessToken, capability, planId, returns, role, userId]);
  return shown?.capability === capability ? <Receipt receipt={shown.receipt} /> : null;
}

export default function PlanNightReceipt({ planId }: { planId: string }) {
  const { identityResolved, user, session } = useAuth();
  const auth = identityResolved ? captureAccountAuth(user?.id ?? null, session) : null;
  if (!auth) return null;
  return (
    <OwnerReceipt
      key={`${auth.userId}:${planId}`}
      planId={planId}
      userId={auth.userId}
      accessToken={auth.accessToken}
    />
  );
}
