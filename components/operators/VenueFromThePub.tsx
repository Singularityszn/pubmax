"use client";

// "From the pub" on the venue sheet (launch plan 1 Nov 2026, section 7 item 1;
// launch review G1): the pub's own published word, and under it the quiet
// "Run this pub?" door that opens the operator panel. ONE row in the Overview's
// pub fold, never a section of its own.
//
// WHAT SHOWS. Only what GET /api/operator-facts answers, which is published
// facts alone: a pending or declined proposal never reaches it. Each item says
// its kind (event, offer, correction, response) and the day the pub said it,
// and a dated event or offer says its night too.
//
// WHAT IT NEVER DOES. It changes no rank, pin colour, price band or order, and
// it is not paid, so it never wears the "Sponsored" label
// (docs/SPONSORSHIP_POLICY.md; __tests__/operatorFactsFence.test.ts). A read
// that fails renders nothing rather than an empty block.
//
// The read waits for the sheet's last phase (lib/useStaggeredRead.ts): this row
// sits in a closed fold, so it must never join the first burst.

import { useEffect, useId, useState } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import OperatorRailPanel from "@/components/operators/OperatorRailPanel";
import {
  FROM_THE_PUB_LABEL,
  OPERATOR_FACT_KIND_LABEL,
  operatorFactAddedLine,
  operatorFactHeadline,
  operatorFactOnDay,
  type PublicOperatorFact,
} from "@/lib/operatorFacts";
import { discardBody } from "@/lib/responseBody";
import { useStaggeredRead } from "@/lib/useStaggeredRead";

import "./venueFromThePub.css";

type FactsRead = { venueId: string; facts: PublicOperatorFact[] };

function readFacts(body: unknown): PublicOperatorFact[] {
  const facts = (body as { facts?: unknown } | null)?.facts;
  return Array.isArray(facts) ? (facts as PublicOperatorFact[]) : [];
}

/** The labelled block itself. Exported for the tests; renders nothing with no facts. */
export function FromThePubFacts({ facts }: { facts: readonly PublicOperatorFact[] }) {
  const headingId = useId();
  if (facts.length === 0) return null;
  return (
    <section className="venueFromThePubBlock" aria-labelledby={headingId} data-from-the-pub>
      <h3 className="venueFromThePubHeading" id={headingId}>
        {FROM_THE_PUB_LABEL}
      </h3>
      <ul className="venueFromThePubList">
        {facts.map((fact) => {
          const headline = operatorFactHeadline(fact);
          const onDay = operatorFactOnDay(fact.onDate);
          return (
            <li key={fact.id} className="venueFromThePubItem" data-operator-fact-kind={fact.kind}>
              <p className="venueFromThePubMeta">
                <span className="venueFromThePubKind">{OPERATOR_FACT_KIND_LABEL[fact.kind]}</span>
                {onDay && fact.onDate ? (
                  <>
                    {" · "}
                    <time dateTime={fact.onDate}>{onDay}</time>
                  </>
                ) : null}
              </p>
              {headline ? <p className="venueFromThePubTitle">{headline}</p> : null}
              {fact.when ? <p className="venueFromThePubWhen">{fact.when}</p> : null}
              {fact.body ? <p className="venueFromThePubBody">{fact.body}</p> : null}
              <p className="venueFromThePubAdded">
                <time dateTime={fact.publishedAt}>{operatorFactAddedLine(fact)}</time>
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export default function VenueFromThePub({
  venueId,
  venueName,
  offerClaim,
}: {
  venueId: string;
  venueName: string;
  /** Offer the "Run this pub?" door. A pub offers it; a venue of another kind does not. */
  offerClaim: boolean;
}) {
  const { configured } = useAuth();
  const ready = useStaggeredRead(3, venueId);
  const [read, setRead] = useState<FactsRead | null>(null);

  useEffect(() => {
    if (!ready || !venueId) return;
    const controller = new AbortController();
    fetch(`/api/operator-facts?venueId=${encodeURIComponent(venueId)}`, {
      signal: controller.signal,
      headers: { accept: "application/json" },
    })
      .then((res) => {
        if (!res.ok) {
          discardBody(res);
          return null;
        }
        return res.json() as Promise<unknown>;
      })
      .then((body) => {
        if (body !== null) setRead({ venueId, facts: readFacts(body) });
      })
      .catch(() => {
        // No block rather than a broken one.
      });
    return () => controller.abort();
  }, [ready, venueId]);

  const facts = read && read.venueId === venueId ? read.facts : [];
  // The panel needs sign-in, so a deployment without it offers no door.
  const door = offerClaim && configured;
  if (facts.length === 0 && !door) return null;

  return (
    <div className="venueFromThePub">
      <FromThePubFacts facts={facts} />
      {door ? <OperatorRailPanel venueId={venueId} venueName={venueName} /> : null}
    </div>
  );
}
