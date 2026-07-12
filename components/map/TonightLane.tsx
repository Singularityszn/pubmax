"use client";

// W1 Tonight lane — the map-home surface for the PRIMARY What's-On spine
// (/api/whats-on, venueId-joined quiz/sport/deal/music on tonight). A
// horizontally scrollable row of 3–5 nearby cards above the tab bar with kind
// filter chips. Cards deep-link into the venue sheet (onSelectVenue) and carry
// a plan affordance (/plan?src=tonight-lane) so lane→plan conversions are
// attributable. Provenance ("Screens live sport" / a start time + "Checked
// <date>" + source label) rides every card — no invented times.
//
// Prop-driven: PubMap owns the fetch (useWhatsOnTonight) and the map wiring;
// this component is pure presentation over rows it is handed. Renders nothing
// when there are no tonight rows (honest empty), so the map is never cluttered
// on a quiet night.

import Link from "next/link";
import { useMemo, useState } from "react";
import { CalendarClock, MapPin, Tv } from "lucide-react";

import { trackEvent } from "@/lib/analytics";
import type { WhatsOnKind, WhatsOnRow } from "@/lib/whatsOn";
import {
  checkedLabel,
  filterLaneRows,
  laneCardsFromRows,
  laneKindFacets,
} from "@/lib/whatsOnBadges";

import "./tonightLane.css";

type TonightLaneProps = {
  rows: WhatsOnRow[];
  asOf: string | null;
  onSelectVenue: (venueId: string) => void;
};

export default function TonightLane({ rows, asOf, onSelectVenue }: TonightLaneProps) {
  const [activeKind, setActiveKind] = useState<WhatsOnKind | null>(null);

  const facets = useMemo(() => laneKindFacets(rows), [rows]);
  const cards = useMemo(
    () => laneCardsFromRows(filterLaneRows(rows, activeKind), { limit: 5 }),
    [rows, activeKind],
  );

  if (rows.length === 0) return null;

  return (
    <section className="tonightLane" aria-label="On tonight near you">
      <div className="tonightLaneHead">
        <div className="tonightLaneTitleRow">
          <h2 className="tonightLaneTitle">On tonight</h2>
          <span className="tonightLaneChecked">{checkedLabel(asOf)}</span>
        </div>
        {facets.length > 1 ? (
          <div
            className="tonightLaneChips"
            role="group"
            aria-label="Filter tonight by kind"
          >
            <button
              type="button"
              className="tonightLaneChip"
              data-active={activeKind === null}
              aria-pressed={activeKind === null}
              onPointerDown={() => {
                setActiveKind(null);
                trackEvent("whats_on_filter");
              }}
            >
              All
            </button>
            {facets.map((facet) => (
              <button
                key={facet.kind}
                type="button"
                className="tonightLaneChip"
                data-active={activeKind === facet.kind}
                data-kind={facet.kind}
                aria-pressed={activeKind === facet.kind}
                onPointerDown={() => {
                  setActiveKind(facet.kind);
                  trackEvent("whats_on_filter");
                }}
              >
                {facet.label}
                <span className="tonightLaneChipCount">{facet.count}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <ul className="tonightLaneScroll" data-testid="tonight-lane">
        {cards.map((card) => {
          const when = card.timeLabel ?? card.badgeLabel;
          const KindIcon = card.kind === "sport" ? Tv : CalendarClock;
          return (
            <li key={card.id} className="tonightLaneCard" data-kind={card.kind}>
              {card.venueId ? (
                <button
                  type="button"
                  className="tonightLaneCardTap pressable"
                  onClick={() => {
                    trackEvent("lane_card_tap");
                    onSelectVenue(card.venueId as string);
                  }}
                >
                  <TonightLaneCardBody card={card} when={when} KindIcon={KindIcon} />
                </button>
              ) : (
                <div className="tonightLaneCardTap">
                  <TonightLaneCardBody card={card} when={when} KindIcon={KindIcon} />
                </div>
              )}
              <Link
                href="/plan?src=tonight-lane"
                className="tonightLanePlan pressable"
                onClick={() => trackEvent("lane_card_tap")}
              >
                Plan a round
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function TonightLaneCardBody({
  card,
  when,
  KindIcon,
}: {
  card: ReturnType<typeof laneCardsFromRows>[number];
  when: string;
  KindIcon: typeof Tv;
}) {
  return (
    <>
      <div className="tonightLaneCardMeta">
        <span className="tonightLaneCardKind">
          <KindIcon size={12} aria-hidden="true" />
          {card.kindLabel}
        </span>
        {typeof card.priceGbp === "number" ? (
          <span className="tonightLaneCardPrice">£{card.priceGbp.toFixed(2)}</span>
        ) : null}
      </div>
      <p className="tonightLaneCardTitle">{card.title}</p>
      <p className="tonightLaneCardPlace">
        <MapPin size={12} aria-hidden="true" />
        <span>{card.placeName}</span>
      </p>
      <p className="tonightLaneCardWhen">{when}</p>
      <p className="tonightLaneCardSource">via {card.sourceLabel}</p>
    </>
  );
}
