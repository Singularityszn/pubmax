"use client";

// The NHLE listed-building line on a base-layer pub sheet (UnverifiedPubSheet).
//
// A curated pub's Lore tab already carries this fact under "On record"; a base
// pub opened from the UK layer has no Lore tab, so this one line is where the
// listing reaches it. It shows ONLY the Historic England fact, with the source,
// the day the NHLE was read and the list entry link. Fail-soft: nothing on
// record, any error, or no answer renders nothing, never "not listed".

import { useEffect, useRef, useState } from "react";
import { ExternalLink, Landmark } from "lucide-react";

import { heritageReadLabel, sanitizeHeritageFacts, type HeritageFact } from "@/lib/heritageFacts";
import { discardBody } from "@/lib/responseBody";
import { useStaggeredRead } from "@/lib/useStaggeredRead";

type Props = { venueId: string; venueName: string };

async function fetchListed(venueId: string, venueName: string, signal: AbortSignal): Promise<HeritageFact | null> {
  const params = new URLSearchParams({ venueId, venueName });
  const res = await fetch(`/api/heritage?${params.toString()}`, { signal, headers: { accept: "application/json" } });
  if (!res.ok) {
    discardBody(res);
    return null;
  }
  const body = (await res.json()) as { facts?: unknown };
  return sanitizeHeritageFacts(body.facts).find((fact) => fact.source === "nhle") ?? null;
}

export default function VenueListedBuilding({ venueId, venueName }: Props) {
  const [listed, setListed] = useState<HeritageFact | null>(null);
  const [listedFor, setListedFor] = useState(venueId);
  if (listedFor !== venueId) {
    setListedFor(venueId);
    setListed(null);
  }
  const generationRef = useRef(0);
  const ready = useStaggeredRead(2, venueId);

  useEffect(() => {
    if (!ready || !venueId || !venueName) return;
    const generation = ++generationRef.current;
    const controller = new AbortController();
    (async () => {
      try {
        const next = await fetchListed(venueId, venueName, controller.signal);
        if (controller.signal.aborted || !next) return;
        void Promise.resolve().then(() => {
          if (generationRef.current === generation) setListed(next);
        });
      } catch {
        // Fail-soft: no line is fine.
      }
    })();
    return () => {
      generationRef.current += 1;
      controller.abort();
    };
  }, [ready, venueId, venueName]);

  if (!listed) return null;
  const read = heritageReadLabel(listed.observedAt);
  return (
    <p className="unverifiedPubListed">
      <Landmark size={14} aria-hidden="true" />
      <span className="unverifiedPubListedFact">{listed.fact}</span>
      <small className="unverifiedPubListedSource">
        Historic England NHLE (Open Government Licence v3.0){read ? `, ${read}` : ""}
        {listed.sourceRef ? (
          <>
            {" · "}
            <a href={listed.sourceRef} target="_blank" rel="noopener noreferrer">
              List entry
              <ExternalLink size={14} aria-hidden="true" />
            </a>
          </>
        ) : null}
      </small>
    </p>
  );
}
