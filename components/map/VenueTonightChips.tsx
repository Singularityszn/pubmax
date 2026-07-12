"use client";

// Venue-sheet "on tonight" chips (Wave A · A1). Under the venue title we surface
// what's on at THIS venue tonight — one glyph-led chip per event kind — so a
// viewer sees "there's a gig and a comedy night here" the instant they tap a
// pin, without leaving the sheet.
//
// Data: the same grounded CityMCP `things_to_do` tonight window the /tonight
// screen and the Discover lane use. Upstream place ids don't align with our
// venue ids, so opportunities are joined to the venue by tolerant name match OR
// coordinate proximity (see lib/tonight.matchOpportunitiesToVenue).
//
// Pure sheet DOM — no map-canvas involvement (respects the F1 freeze). Fail-
// soft: any fetch failure or no-match renders nothing; provenance ("checked
// <date>") rides the row so freshness is never implied beyond the upstream.
//
// React 19 safe: state writes are deferred out of the effect body and an
// AbortController cancels the in-flight fetch on unmount / venue change.

import { useEffect, useState } from "react";
import {
  Drama,
  Mic,
  Music,
  PartyPopper,
  Palette,
  ShoppingBag,
  Sparkles,
  Store,
  Ticket,
  Users,
  Utensils,
  type LucideIcon,
} from "lucide-react";

import {
  eventChipsForVenue,
  matchOpportunitiesToVenue,
  provenanceLabel,
  type EventChip,
  type TonightOpportunity,
  type VenueRef,
} from "@/lib/tonight";

type ApiResponse = {
  asOf?: string | null;
  opportunities?: TonightOpportunity[];
};

const KIND_ICON: Record<string, LucideIcon> = {
  gig: Music,
  comedy: Mic,
  theatre: Drama,
  exhibition: Palette,
  popup: Store,
  food_drink: Utensils,
  market: ShoppingBag,
  family: Users,
  talk: Mic,
  nightlife: PartyPopper,
  free_event: Ticket,
  other: Sparkles,
};

export default function VenueTonightChips(props: VenueRef): React.JSX.Element | null {
  const { id, name, latitude, longitude } = props;
  const [chips, setChips] = useState<EventChip[]>([]);
  const [asOf, setAsOf] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    // Reset when the inspected venue changes so a stale match never lingers.
    void Promise.resolve().then(() => {
      if (!controller.signal.aborted) {
        setChips([]);
        setAsOf(null);
      }
    });
    (async () => {
      try {
        const res = await fetch(
          "/api/citymcp/things-to-do?window=tonight&limit=20",
          { signal: controller.signal, headers: { accept: "application/json" } },
        );
        if (!res.ok) return;
        const body = (await res.json()) as ApiResponse;
        const ops = Array.isArray(body.opportunities) ? body.opportunities : [];
        const matched = matchOpportunitiesToVenue(ops, {
          id,
          name,
          latitude,
          longitude,
        });
        const derived = eventChipsForVenue(matched);
        if (derived.length === 0) return;
        void Promise.resolve().then(() => {
          if (controller.signal.aborted) return;
          setChips(derived);
          setAsOf(body.asOf ?? null);
        });
      } catch {
        /* fail-soft: no chips */
      }
    })();
    return () => controller.abort();
  }, [id, name, latitude, longitude]);

  if (chips.length === 0) return null;

  return (
    <div className="venueTonightChips" aria-label="On tonight at this venue">
      {chips.map((chip) => {
        const Icon = KIND_ICON[chip.kind] ?? Sparkles;
        return (
          <span
            key={chip.kind}
            className="venueTonightChip"
            data-kind={chip.kind}
          >
            <Icon size={12} aria-hidden="true" />
            {chip.label}
          </span>
        );
      })}
      <span className="venueTonightChecked">
        {provenanceLabel(asOf).toLowerCase()}
      </span>
    </div>
  );
}
