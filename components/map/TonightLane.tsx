"use client";

// W1/W2 Tonight lane — the map-home surface for the PRIMARY What's-On spine
// (/api/whats-on, venueId-joined quiz/sport/deal/music on tonight). A
// compact top chip keeps the map clear by default; on demand it opens a
// horizontally scrollable row of 3–5 nearby cards with kind filter chips.
// Cards deep-link into the venue sheet (onSelectVenue) and carry a plan
// affordance (/plan?src=tonight-lane) so lane→plan conversions are attributable.
// Provenance ("Screens live sport" / a start time + "Checked <date>" + source
// label) rides every card — no invented times.
//
// Prop-driven: PubMap owns the fetch (useWhatsOnTonight) and the map wiring;
// this component is pure presentation over rows it is handed. Renders nothing
// when there are no tonight rows (honest empty), so the map is never cluttered
// on a quiet night.

import Link from "next/link";
import { useMemo, useState } from "react";
import { CalendarClock, MapPin, MoonStar, Tv, X } from "lucide-react";

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
  /** Spine load status — "error" renders an honest "unavailable" pill. */
  status?: "idle" | "ready" | "empty" | "error";
  onSelectVenue: (venueId: string) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Secondary CityMCP opportunity-pin overlay, folded into this top chrome. */
  overlayCount?: number;
  overlayActive?: boolean;
  onToggleOverlay?: () => void;
  onDismissOverlay?: () => void;
};

export default function TonightLane({
  rows,
  asOf,
  status = "idle",
  onSelectVenue,
  open,
  onOpenChange,
  overlayCount = 0,
  overlayActive = false,
  onToggleOverlay,
  onDismissOverlay,
}: TonightLaneProps) {
  const [activeKind, setActiveKind] = useState<WhatsOnKind | null>(null);
  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = open ?? internalOpen;
  const toggleOverlay = overlayCount > 0 ? onToggleOverlay : undefined;

  const changeOpen = (nextOpen: boolean) => {
    if (open === undefined) setInternalOpen(nextOpen);
    onOpenChange?.(nextOpen);
  };

  const facets = useMemo(() => laneKindFacets(rows), [rows]);
  const cards = useMemo(
    () => laneCardsFromRows(filterLaneRows(rows, activeKind), { limit: 5 }),
    [rows, activeKind],
  );

  // Honest outage state: the PRIMARY spine failed — say so quietly instead of
  // pretending it's a quiet night. Badges are simply absent in this state.
  if (status === "error" && !toggleOverlay) {
    return (
      <section
        className="tonightLane tonightLane--error"
        aria-label="On tonight near you"
      >
        <div className="tonightLaneTitleRow" role="status">
          <div className="tonightLaneTitleMeta">
            <h2 className="tonightLaneTitle">On tonight</h2>
            <span className="tonightLaneChecked">
              Tonight&rsquo;s listings unavailable right now
            </span>
          </div>
        </div>
      </section>
    );
  }

  if (rows.length === 0 && !toggleOverlay) return null;

  if (!isOpen) {
    return (
      <section
        className="tonightLane tonightLane--collapsed"
        aria-label="On tonight near you"
      >
        <div className="tonightLaneCollapsed">
          {rows.length > 0 ? (
            <button
              type="button"
              className="tonightLaneCollapsedMain pressable"
              data-testid="tonight-lane-chip"
              aria-expanded={false}
              onClick={() => changeOpen(true)}
            >
              <span className="tonightLaneCollapsedTitle">
                On tonight <span aria-hidden="true">·</span> {rows.length}
              </span>
              <span className="tonightLaneCollapsedChecked">{checkedLabel(asOf)}</span>
            </button>
          ) : (
            <span className="tonightLaneCollapsedMain" role="status">
              <span className="tonightLaneCollapsedTitle">Tonight nearby</span>
              {status === "error" ? (
                <span className="tonightLaneCollapsedChecked">Listings unavailable</span>
              ) : null}
            </span>
          )}
          {toggleOverlay ? (
            <TonightOverlayToggle
              count={overlayCount}
              active={overlayActive}
              onToggle={toggleOverlay}
            />
          ) : null}
          {toggleOverlay && overlayActive && onDismissOverlay ? (
            <TonightOverlayDismiss onDismiss={onDismissOverlay} />
          ) : null}
        </div>
      </section>
    );
  }

  return (
    <section
      className="tonightLane tonightLane--open"
      aria-label="On tonight near you"
    >
      <div className="tonightLaneHead">
        <div className="tonightLaneTitleRow">
          <div className="tonightLaneTitleMeta">
            <h2 className="tonightLaneTitle">On tonight</h2>
            <span className="tonightLaneChecked">{checkedLabel(asOf)}</span>
          </div>
          <div className="tonightLaneTitleActions">
            {toggleOverlay ? (
              <>
                <TonightOverlayToggle
                  count={overlayCount}
                  active={overlayActive}
                  onToggle={toggleOverlay}
                />
                {overlayActive && onDismissOverlay ? (
                  <TonightOverlayDismiss onDismiss={onDismissOverlay} />
                ) : null}
              </>
            ) : null}
            <button
              type="button"
              className="tonightLaneClose pressable"
              aria-label="Collapse on tonight"
              onClick={() => changeOpen(false)}
            >
              <X size={17} aria-hidden="true" />
            </button>
          </div>
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
              onClick={() => {
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
                onClick={() => {
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

function TonightOverlayDismiss({ onDismiss }: { onDismiss: () => void }) {
  return (
    <button
      type="button"
      className="tonightLaneOverlayDismiss pressable"
      aria-label="Dismiss tonight map pins"
      onClick={onDismiss}
    >
      <X size={15} aria-hidden="true" />
    </button>
  );
}

function TonightOverlayToggle({
  count,
  active,
  onToggle,
}: {
  count: number;
  active: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className="tonightLaneOverlayToggle pressable"
      data-testid="tonight-overlay-toggle"
      data-active={active}
      aria-label={active ? "Hide tonight on map" : "Show tonight on map"}
      aria-pressed={active}
      onClick={onToggle}
    >
      <MoonStar size={15} aria-hidden="true" />
      <span>Pins</span>
      <span className="tonightLaneOverlayCount" aria-hidden="true">
        {count}
      </span>
    </button>
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
