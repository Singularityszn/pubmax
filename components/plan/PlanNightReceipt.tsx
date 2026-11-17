"use client";

import { useCallback, useState, useSyncExternalStore } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import { useLiveAccountGeneration } from "@/components/auth/useLiveAccountGeneration";
import PriceBadge from "@/components/PriceBadge";
import { canonicalStateFromBody } from "@/components/plan/PlanSummary";
import { readPlanMemberProjection, usePlanMemberRead } from "@/components/plan/usePlanMemberRead";
import Kicker from "@/components/ui/kicker";
import { formatObservedDate } from "@/lib/dataFreshnessFormat";
import { formatPence } from "@/lib/formatGbp";
import { projectNightReceipt, type NightReceipt } from "@/lib/nightReceipt";
import type { CrawlEnding, PlanState } from "@/lib/plan";
import { isPlanPreviewProjection } from "@/lib/planPrivacy";
import {
  parsePlanCapabilitySnapshot,
  planCapabilityEvent,
  readPlanCapabilitySnapshot,
} from "@/lib/planSessionCapability";

import "./planNightReceipt.css";

// The owner's private receipt for a completed Plan. The server never renders
// it: it appears only after the capability-gated member read answers, and only
// for the host role that the Plan session reported. A change of account
// remounts it, so no receipt survives into the next account.

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

function usePlanRole(planId: string) {
  const snapshot = useSyncExternalStore(
    (onChange) => {
      const event = planCapabilityEvent(planId);
      window.addEventListener(event, onChange);
      return () => window.removeEventListener(event, onChange);
    },
    () => readPlanCapabilitySnapshot(planId),
    () => "|0|",
  );
  return parsePlanCapabilitySnapshot(snapshot).role;
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

function AccountReceipt({ planId }: { planId: string }) {
  const [state, setState] = useState<PlanState | null>(null);
  const role = usePlanRole(planId);
  const read = useCallback((isActive: () => boolean) => {
    void readPlanMemberProjection(planId).then((body) => {
      if (!isActive()) return;
      const canonical = canonicalStateFromBody(body);
      if (canonical) setState(canonical);
      else if (isPlanPreviewProjection(body)) setState(null);
    });
  }, [planId]);
  usePlanMemberRead(planId, read);
  const projection = projectNightReceipt({ state, role });
  return projection.kind === "receipt" ? <Receipt receipt={projection.receipt} /> : null;
}

export default function PlanNightReceipt({ planId }: { planId: string }) {
  const { identityResolved } = useAuth();
  const accountGeneration = useLiveAccountGeneration();
  if (!identityResolved) return null;
  return <AccountReceipt key={accountGeneration} planId={planId} />;
}
