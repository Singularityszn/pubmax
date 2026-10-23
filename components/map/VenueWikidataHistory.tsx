"use client";

// Wikidata history on a base-layer pub sheet (UnverifiedPubSheet).
//
// A curated pub's Lore tab already lists these under "On record"; a base pub
// opened from the UK layer has no Lore tab, so its history lands here. Only the
// EXACT join is shown: a Wikidata fact carrying the day its pack was read came
// through the pub's own OSM wikidata tag (lib/wikidataHistory.ts), whereas the
// name-keyed heritage cache can belong to another pub of the same name. Each
// line carries its source, that day and a link to the statement. Fail-soft:
// nothing on record or any error renders nothing.

import { useEffect, useRef, useState } from "react";
import { ExternalLink, History } from "lucide-react";

import { heritageReadLabel, sanitizeHeritageFacts, type HeritageFact } from "@/lib/heritageFacts";
import { discardBody } from "@/lib/responseBody";
import { useStaggeredRead } from "@/lib/useStaggeredRead";

type Props = { venueId: string; venueName: string };

async function fetchHistory(venueId: string, venueName: string, signal: AbortSignal): Promise<HeritageFact[]> {
  const params = new URLSearchParams({ venueId, venueName });
  const res = await fetch(`/api/heritage?${params.toString()}`, { signal, headers: { accept: "application/json" } });
  if (!res.ok) {
    discardBody(res);
    return [];
  }
  const body = (await res.json()) as { facts?: unknown };
  return sanitizeHeritageFacts(body.facts).filter((fact) => fact.source === "wikidata" && fact.observedAt);
}

export default function VenueWikidataHistory({ venueId, venueName }: Props) {
  const [facts, setFacts] = useState<HeritageFact[]>([]);
  const [factsFor, setFactsFor] = useState(venueId);
  if (factsFor !== venueId) {
    setFactsFor(venueId);
    setFacts([]);
  }
  const generationRef = useRef(0);
  const ready = useStaggeredRead(2, venueId);

  useEffect(() => {
    if (!ready || !venueId || !venueName) return;
    const generation = ++generationRef.current;
    const controller = new AbortController();
    (async () => {
      try {
        const next = await fetchHistory(venueId, venueName, controller.signal);
        if (controller.signal.aborted || next.length === 0) return;
        void Promise.resolve().then(() => {
          if (generationRef.current === generation) setFacts(next);
        });
      } catch {
        // Fail-soft: no history is fine.
      }
    })();
    return () => {
      generationRef.current += 1;
      controller.abort();
    };
  }, [ready, venueId, venueName]);

  if (facts.length === 0) return null;
  const read = heritageReadLabel(facts[0]?.observedAt);
  return (
    <section className="unverifiedPubHistory" aria-label={`On record about ${venueName}`}>
      <ul>
        {facts.map((fact) => (
          <li key={fact.fact}>
            <History size={14} aria-hidden="true" />
            {fact.sourceRef ? (
              <a href={fact.sourceRef} target="_blank" rel="noopener noreferrer">
                {fact.fact}
                <ExternalLink size={14} aria-hidden="true" />
              </a>
            ) : (
              <span>{fact.fact}</span>
            )}
          </li>
        ))}
      </ul>
      <small className="unverifiedPubHistorySource">Wikidata (CC0){read ? `, ${read}` : ""}</small>
    </section>
  );
}
