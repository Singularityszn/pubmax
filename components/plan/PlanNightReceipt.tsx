"use client";

import { useEffect, useMemo, useReducer, useSyncExternalStore } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import PriceBadge from "@/components/PriceBadge";
import Kicker from "@/components/ui/kicker";
import { Button } from "@/components/ui/button";
import { accountBoundFetch, captureAccountAuth, type AccountAuthSnapshot } from "@/lib/accountBoundFetch";
import { compositeActionSignal } from "@/lib/authedFetch";
import { readProviderAccountSignal } from "@/lib/authProviderRevision";
import { formatObservedDate } from "@/lib/dataFreshnessFormat";
import { formatPence } from "@/lib/formatGbp";
import { readNightReceiptPayload, type NightReceipt } from "@/lib/nightReceipt";
import { INITIAL_NIGHT_RECEIPT_READ, nextNightReceiptRead, type NightReceiptAnswer } from "@/lib/nightReceiptRead";
import type { CrawlEnding } from "@/lib/plan";
import {
  parsePlanCapabilitySnapshot,
  planAccountClaimEvent,
  planCapabilityEvent,
  readPlanCapabilitySnapshot,
} from "@/lib/planSessionCapability";
import { discardBody } from "@/lib/responseBody";
import { subscribeToReconnectRecovery } from "@/lib/useReconnectRecovery";

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

async function readOwnedReceipt(auth: AccountAuthSnapshot, planId: string, signal: AbortSignal): Promise<NightReceiptAnswer> {
  try {
    const response = await accountBoundFetch(auth, `/api/plans/${planId}?view=receipt`, { cache: "no-store", signal });
    if (!response.ok) {
      discardBody(response);
      return { status: [401, 403, 404].includes(response.status) ? "refused" : "unavailable" };
    }
    const payload: unknown = await response.json();
    const receipt = readNightReceiptPayload(payload);
    if (receipt) return { status: "ready", receipt };
    return payload !== null && typeof payload === "object" && "receipt" in payload && payload.receipt === null
      ? { status: "ready", receipt: null } : { status: "unavailable" };
  } catch {
    return { status: "unavailable" };
  }
}

function useReceiptRead(planId: string, userId: string, accessToken: string, capability: string, host: boolean) {
  const [state, dispatch] = useReducer(nextNightReceiptRead, INITIAL_NIGHT_RECEIPT_READ);
  const scope = useMemo(() => ({ capability, userId, accessToken }), [accessToken, capability, userId]);
  useEffect(() => { dispatch({ type: "scope", capability, scope, host }); }, [capability, host, scope]);
  useEffect(() => {
    const claimed = () => {
      if (document.visibilityState !== "hidden") dispatch({ type: "claimed" });
    };
    const stopRecovery = subscribeToReconnectRecovery(() => dispatch({ type: "check" }), { events: ["online", "visible", "focus"] });
    const event = planAccountClaimEvent(planId);
    window.addEventListener(event, claimed);
    return () => {
      stopRecovery();
      window.removeEventListener(event, claimed);
    };
  }, [planId]);
  const reading = state.phase === "reading" && state.scope === scope;
  const request = state.request;
  useEffect(() => {
    if (!host || !reading) return;
    const retired = new AbortController();
    const signal = compositeActionSignal([retired.signal, readProviderAccountSignal()]);
    void readOwnedReceipt({ userId, accessToken }, planId, signal).then((answer) => {
      if (!signal.aborted) dispatch({ type: "answer", capability, scope, request, answer });
    });
    return () => retired.abort();
  }, [accessToken, capability, host, planId, reading, request, scope, userId]);
  return { state, retry: () => dispatch({ type: "check" }) };
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
        <ol className="planNightReceipt__stops" role="list" aria-label="Stops on the plan">
          {receipt.stops.map((stop) => (
            <li key={`${stop.position}-${stop.venueName}`} className="planNightReceipt__stop">
              <span className="planNightReceipt__number" aria-hidden="true">{stop.position + 1}</span>
              <div className="planNightReceipt__stopBody">
                <span className="planNightReceipt__venue">{stop.venueName}</span>
                {stop.price ? (
                  <span className="planNightReceipt__price">
                    <PriceBadge variant="neutral">{formatPence(stop.price.pence)}</PriceBadge>
                    <span className="planNightReceipt__source">
                      {stop.price.drink}, logged by a drinker on{" "}
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
  const { state, retry } = useReceiptRead(planId, userId, accessToken, capability, role === "host");
  if (role !== "host" || state.capability !== capability) return null;
  if ((state.phase === "ready" || state.phase === "reading") && state.receipt) return <Receipt receipt={state.receipt} />;
  const busy = state.phase === "reading";
  if (state.phase !== "unavailable" && !(busy && state.recovering)) return null;
  return (
    <section className="planNightReceipt" aria-labelledby="plan-night-receipt-title" data-pending={busy}>
      <Kicker>Private to you</Kicker>
      <h2 id="plan-night-receipt-title" className="planNightReceipt__title">Your night receipt</h2>
      <p role="status">{busy ? "Checking your receipt…" : "We couldn't load your night receipt."}</p>
      <div><Button variant="secondary" aria-disabled={busy} aria-busy={busy} onClick={retry}>{busy ? "Checking…" : "Try again"}</Button></div>
    </section>
  );
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
