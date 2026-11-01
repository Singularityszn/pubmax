"use client";

import { useEffect, useState } from "react";

import { RowList, RowListItem } from "@/components/ui/row-list";
import {
  FROM_THE_PUBS_TONIGHT_LABEL,
  OPERATOR_FACT_KIND_LABEL,
  operatorFactAddedLine,
  operatorFactHeadline,
  operatorFactOnDay,
  tonightOperatorFacts,
  type TonightOperatorFact,
} from "@/lib/operatorFacts";
import { venueMapUrl } from "@/lib/venueMapUrl";

/** The one line under the heading: whose words these are. */
export const FROM_THE_PUBS_TONIGHT_LINE =
  "In the pubs' own words. We read each one before it goes up.";

/**
 * What the pubs themselves said is on tonight (launch plan 1 Nov 2026, section
 * 7 item 1). Published operator events and offers dated for this London
 * service day, each under the pub's name with its kind and its date.
 *
 * ITS OWN BLOCK, UNDER THE CONFIRMED LISTINGS, NEVER LEADING. It sits after
 * the lede region (docs/rules/app-proxy-csp-caching-and-file-tracing.md, "THE
 * ANSWER IS THREE CARDS"), never inside it, and it is not a listing we checked,
 * so it never joins the listings, their counts or their order. It changes no
 * rank and no colour, and it is not paid, so it never says "Sponsored".
 *
 * The rows are read on the server when the page is prepared, so they cost the
 * reader no request. The page is held for five minutes at most, so the block
 * reads its own clock after load and drops a row once its night has turned.
 */
export default function TonightFromThePubs({
  facts = [],
  preparedAt = 0,
  held = false,
}: {
  facts?: readonly TonightOperatorFact[];
  /**
   * When the server prepared the page: the first render's clock, so hydration
   * matches. With no stamp the first render shows nothing and the browser's own
   * clock decides after load.
   */
  preparedAt?: number;
  /** True while the page's first listings read is still running. */
  held?: boolean;
}) {
  const [clock, setClock] = useState(preparedAt);
  useEffect(() => {
    void Promise.resolve().then(() => setClock(Date.now()));
  }, []);

  const rows = tonightOperatorFacts(facts, clock);
  if (held || rows.length === 0) return null;
  return (
    <section
      className="tonightSection tonightFromThePubs"
      aria-labelledby="tonight-from-the-pubs-title"
      data-testid="tonight-from-the-pubs"
    >
      <h2 className="tonightSectionTitle" id="tonight-from-the-pubs-title">
        {FROM_THE_PUBS_TONIGHT_LABEL}
      </h2>
      <p className="tonightSectionLine">{FROM_THE_PUBS_TONIGHT_LINE}</p>
      <RowList>
        {rows.map((fact) => {
          const headline = operatorFactHeadline(fact);
          const onDay = operatorFactOnDay(fact.onDate);
          return (
            <RowListItem
              key={fact.id}
              href={venueMapUrl(fact.venueId)}
              title={fact.venueName}
              meta={
                <>
                  <span className="tonightFromThePubsKind" data-operator-fact-kind={fact.kind}>
                    {OPERATOR_FACT_KIND_LABEL[fact.kind]}
                    {onDay && fact.onDate ? (
                      <>
                        {" · "}
                        <time dateTime={fact.onDate}>{onDay}</time>
                      </>
                    ) : null}
                  </span>
                  {headline ? <span className="tonightFromThePubsWhat">{headline}</span> : null}
                  {fact.when ? <span className="tonightFromThePubsWhat">{fact.when}</span> : null}
                  <span className="tonightFromThePubsAdded">
                    <time dateTime={fact.publishedAt}>{operatorFactAddedLine(fact)}</time>
                  </span>
                </>
              }
            />
          );
        })}
      </RowList>
    </section>
  );
}
