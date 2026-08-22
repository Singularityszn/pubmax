"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ExternalLink, MapPinned } from "lucide-react";

import { DrinkGlyph } from "@/components/drinks/DrinkGlyph";
import VenueImage from "@/components/media/VenueImage";
import { trackEvent } from "@/lib/analytics";
import { categoryLabel, type DrinkCategory } from "@/lib/drinks";
import {
  SCRAPED_SOURCE_LABELS,
  type ScrapedPub,
  type ScrapedPubSourceId,
} from "@/lib/scrapedPubs";
import { formatPrice } from "@/lib/venues";
import { venueMapUrl } from "@/lib/venueMapUrl";
import { resolveBookingAction } from "@/lib/venueExternalActions";
import { ZONE_IDS, venueMatchesZone, type ZoneSelection } from "@/lib/zones";

import "./pubsGallery.css";
import "@/components/map/zonePicker.css";

type FilterKey = "all" | ScrapedPubSourceId;

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "nicholsonspubs.co.uk", label: SCRAPED_SOURCE_LABELS["nicholsonspubs.co.uk"] },
  { key: "youngs.co.uk", label: SCRAPED_SOURCE_LABELS["youngs.co.uk"] },
  { key: "greene-king.co.uk", label: SCRAPED_SOURCE_LABELS["greene-king.co.uk"] },
];

function DrinkArt({
  accent,
  shelf,
  photoUrl,
  name,
}: {
  accent: DrinkCategory;
  shelf: DrinkCategory[];
  photoUrl?: string;
  name: string;
}) {
  return (
    <div
      className="pubsCardArt"
      data-drink={accent}
      style={{ ["--drink" as string]: `var(--cat-${accent})` }}
    >
      {photoUrl ? (
        <VenueImage
          className="pubsCardPhoto"
          sources={[{ url: photoUrl, provenance: "chain" }]}
          alt=""
          fill
        />
      ) : null}
      <div className="pubsCardArtWash" aria-hidden="true" />
      <div className="pubsCardGlyphHero" aria-hidden="true">
        <DrinkGlyph category={accent} size={72} inheritColor />
      </div>
      <ul className="pubsCardShelf" aria-label={`${categoryLabel(accent)} and more`}>
        <li>
          <DrinkGlyph category={accent} size={22} inheritColor />
          <span>{categoryLabel(accent)}</span>
        </li>
        {shelf.map((category) => (
          <li key={category}>
            <DrinkGlyph category={category} size={18} inheritColor />
            <span>{categoryLabel(category)}</span>
          </li>
        ))}
      </ul>
      <span className="pubsCardArtLabel">{name}</span>
    </div>
  );
}

// Progressive disclosure over the already-loaded, server-rendered pub index
// (E: mobile audit — 119 cards in one unbounded list, ~46,000px tall). The
// full <ul> below still maps EVERY pub — the SEO text for every card ships in
// the server-rendered HTML regardless of JS/hydration state — only cards
// beyond `revealedCount` get a `pubsCardFold` class that CSS-collapses them
// (display: none) until "Show more" is clicked. That keeps full-list SEO
// while killing the scroll wall for a real visitor. Chunked client-side
// slicing (never rendering the tail at all) was ruled out: it would drop
// those pubs from the HTML a crawler sees on first load.
const INITIAL_VISIBLE_PUBS = 30;
const REVEAL_CHUNK = 30;

export default function PubsGallery({ pubs }: { pubs: ScrapedPub[] }) {
  const [filter, setFilter] = useState<FilterKey>("all");
  const [zone, setZone] = useState<ZoneSelection>("all");

  const visible = useMemo(
    () =>
      pubs.filter(
        (pub) =>
          (filter === "all" || pub.source === filter) &&
          venueMatchesZone(pub.zone, zone),
      ),
    [filter, zone, pubs],
  );

  // Only offer zone chips for zones that actually have scraped pubs — no dead
  // buttons, and honest about where our scrapes land.
  const zonesPresent = useMemo(() => {
    const set = new Set<number>();
    for (const pub of pubs) if (pub.zone !== null) set.add(pub.zone);
    return ZONE_IDS.filter((id) => set.has(id));
  }, [pubs]);

  const counts = useMemo(() => {
    const next: Record<FilterKey, number> = {
      all: pubs.length,
      "greene-king.co.uk": 0,
      "nicholsonspubs.co.uk": 0,
      "youngs.co.uk": 0,
      other: 0,
    };
    for (const pub of pubs) next[pub.source] += 1;
    return next;
  }, [pubs]);

  // `count` is how many cards are shown; `from` is where the previous reveal
  // batch ended, so the just-revealed slice gets a one-shot fade-in. Kept as
  // one state value (not a ref) — both are read during render for the
  // per-card fold/enter class, and refs can't be read during render.
  const [revealed, setRevealed] = useState({ count: INITIAL_VISIBLE_PUBS, from: INITIAL_VISIBLE_PUBS });
  const pendingScrollIdRef = useRef<string | null>(null);

  // A filter change re-slices `visible` — reset the fold back to the first
  // page rather than carrying over an unrelated reveal count. Adjusted during
  // render (React's documented pattern for resetting state on a prop/derived
  // change) instead of an effect, so there's no extra render pass.
  const [prevFilter, setPrevFilter] = useState(filter);
  if (filter !== prevFilter) {
    setPrevFilter(filter);
    setRevealed({ count: INITIAL_VISIBLE_PUBS, from: INITIAL_VISIBLE_PUBS });
  }

  useEffect(() => {
    const id = pendingScrollIdRef.current;
    if (!id) return;
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ block: "start", behavior: "smooth" });
      pendingScrollIdRef.current = null;
    }
  }, [revealed.count]);

  function showMore() {
    setRevealed((prev) => ({
      from: prev.count,
      count: Math.min(prev.count + REVEAL_CHUNK, visible.length),
    }));
  }

  // Sticky lightweight area jump — boroughs in the order they first appear in
  // the current (filtered) list. Jumping past the fold reveals up to that
  // pub, then scrolls it into view.
  const boroughJumpTargets = useMemo(() => {
    const seen = new Set<string>();
    const targets: { borough: string; index: number }[] = [];
    visible.forEach((pub, index) => {
      const borough = pub.borough.trim();
      if (!borough || seen.has(borough)) return;
      seen.add(borough);
      targets.push({ borough, index });
    });
    return targets;
  }, [visible]);

  function jumpToBorough(index: number) {
    const target = visible[index];
    if (!target) return;
    const anchorId = `pubsCard-${target.id}`;
    if (index >= revealed.count) {
      pendingScrollIdRef.current = anchorId;
      setRevealed((prev) => ({ from: prev.count, count: index + 1 }));
      return;
    }
    document.getElementById(anchorId)?.scrollIntoView({ block: "start", behavior: "smooth" });
  }

  const remaining = visible.length - revealed.count;

  return (
    <div className="pubsGallery">
      <div className="pubsFilters" role="tablist" aria-label="Filter by scrape source">
        {FILTERS.map((item) => {
          const count = counts[item.key];
          if (item.key !== "all" && count === 0) return null;
          const selected = filter === item.key;
          return (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={selected}
              className={selected ? "pubsFilter isActive" : "pubsFilter"}
              onClick={() => setFilter(item.key)}
            >
              <span>{item.label}</span>
              <span className="pubsFilterCount">{count}</span>
            </button>
          );
        })}
      </div>

      {zonesPresent.length > 0 ? (
        <div className="zoneChips pubsZoneChips" role="group" aria-label="Filter by fare zone">
          <button
            type="button"
            className={zone === "all" ? "zoneChip isOn" : "zoneChip"}
            aria-pressed={zone === "all"}
            onClick={() => setZone("all")}
          >
            All zones
          </button>
          {zonesPresent.map((id) => (
            <button
              key={id}
              type="button"
              className={zone === id ? "zoneChip isOn" : "zoneChip"}
              aria-pressed={zone === id}
              aria-label={`Zone ${id}${zone === id ? " (selected)" : ""}`}
              onClick={() => setZone(id)}
            >
              {id}
            </button>
          ))}
        </div>
      ) : null}

      <p className="pubsCount" aria-live="polite">
        {visible.length} pub{visible.length === 1 ? "" : "s"}
        {filter === "all" ? " we've checked" : ` · ${SCRAPED_SOURCE_LABELS[filter]}`}
        {zone !== "all" ? ` · Zone ${zone}` : ""}
      </p>

      {boroughJumpTargets.length > 1 ? (
        <nav className="pubsJumpNav" aria-label="Jump to area">
          {boroughJumpTargets.map(({ borough, index }) => (
            <button
              key={borough}
              type="button"
              className="pubsJumpChip"
              onClick={() => jumpToBorough(index)}
            >
              {borough}
            </button>
          ))}
        </nav>
      ) : null}

      <ul className="pubsGrid">
        {visible.map((pub, index) => {
          const booking = resolveBookingAction({
            name: pub.name,
            bookingUrl: pub.bookingUrl,
            menuUrl: pub.menuUrl,
            areaHint: pub.borough,
          });
          const isFolded = index >= revealed.count;
          const isEntering = !isFolded && index >= revealed.from;
          const cardClassName = isFolded
            ? "pubsCard pubsCardFold"
            : isEntering
              ? "pubsCard isEntering"
              : "pubsCard";
          const hasPhoto = Boolean(pub.photoUrl);
          const resolvedCardClassName = hasPhoto
            ? cardClassName
            : `${cardClassName} pubsCard--no-art`;
          const enterDelayMs = isEntering
            ? Math.min((index - revealed.from) * 30, 240)
            : undefined;
          return (
          <li
            key={pub.id}
            id={`pubsCard-${pub.id}`}
            className={resolvedCardClassName}
            style={enterDelayMs !== undefined ? { animationDelay: `${enterDelayMs}ms` } : undefined}
          >
            {hasPhoto ? (
              <DrinkArt
                accent={pub.drinkAccent}
                shelf={pub.drinkShelf}
                photoUrl={pub.photoUrl}
                name={categoryLabel(pub.drinkAccent)}
              />
            ) : null}
            <div className="pubsCardBody">
              {!hasPhoto ? (
                <p className="pubsCardDrink">
                  <DrinkGlyph category={pub.drinkAccent} size={18} inheritColor />
                  <span>{categoryLabel(pub.drinkAccent)}</span>
                </p>
              ) : null}
              <div className="pubsCardMeta">
                <span className="pubsSource" data-source={pub.source}>
                  {pub.sourceLabel}
                </span>
                {pub.borough ? <span className="pubsBorough">{pub.borough}</span> : null}
                {pub.zone !== null ? (
                  <span className="pubsZone" title="Nearest station's fare zone">
                    Zone {pub.zone}
                  </span>
                ) : null}
              </div>
              <h2 className="pubsCardName">
                <Link href={venueMapUrl(pub.id)}>{pub.name}</Link>
              </h2>
              <p className="pubsCardPrice">
                {pub.cheapestPrice != null
                  ? `From ${formatPrice(pub.cheapestPrice)}`
                  : "No price logged yet"}
              </p>
              <div className="pubsCardActions">
                <Link className="pubsMapLink" href={venueMapUrl(pub.id)}>
                  <MapPinned size={14} aria-hidden="true" />
                  See on map
                </Link>
                {pub.menuUrl ? (
                  <a
                    className="pubsMenuLink"
                    href={pub.menuUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Menu
                    <ExternalLink size={13} aria-hidden="true" />
                  </a>
                ) : null}
                <a
                  className="pubsBookLink"
                  href={booking.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-tier={booking.tier}
                  onClick={() =>
                    trackEvent("booking_click", { venueId: pub.id, tier: booking.tier })
                  }
                >
                  {booking.label}
                  <ExternalLink size={13} aria-hidden="true" />
                </a>
              </div>
            </div>
          </li>
          );
        })}
      </ul>

      {remaining > 0 ? (
        <div className="pubsShowMoreWrap">
          <button type="button" className="pubsShowMoreBtn" onClick={showMore}>
            Show {Math.min(remaining, REVEAL_CHUNK)} more
            <ChevronDown size={15} aria-hidden="true" />
          </button>
        </div>
      ) : null}

      {visible.length === 0 ? (
        <p className="pubsEmpty">No pubs under that filter yet. Loosen it, or take it to the map.</p>
      ) : null}
    </div>
  );
}
