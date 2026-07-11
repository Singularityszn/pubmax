"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo, useState } from "react";
import { ExternalLink, MapPinned } from "lucide-react";

import { DrinkGlyph } from "@/components/drinks/DrinkGlyph";
import { categoryLabel, type DrinkCategory } from "@/lib/drinks";
import {
  SCRAPED_SOURCE_LABELS,
  type ScrapedPub,
  type ScrapedPubSourceId,
} from "@/lib/scrapedPubs";
import { formatPrice } from "@/lib/venues";
import { venueMapUrl } from "@/lib/venueMapUrl";

import "./pubsGallery.css";

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
        <Image
          src={photoUrl}
          alt=""
          fill
          sizes="(max-width: 640px) 90vw, 280px"
          className="pubsCardPhoto"
          unoptimized
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

export default function PubsGallery({ pubs }: { pubs: ScrapedPub[] }) {
  const [filter, setFilter] = useState<FilterKey>("all");

  const visible = useMemo(
    () => (filter === "all" ? pubs : pubs.filter((pub) => pub.source === filter)),
    [filter, pubs],
  );

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

      <p className="pubsCount" aria-live="polite">
        {visible.length} pub{visible.length === 1 ? "" : "s"}
        {filter === "all" ? " from our scrapes" : ` · ${SCRAPED_SOURCE_LABELS[filter]}`}
      </p>

      <ul className="pubsGrid">
        {visible.map((pub) => (
          <li key={pub.id} className="pubsCard">
            <DrinkArt
              accent={pub.drinkAccent}
              shelf={pub.drinkShelf}
              photoUrl={pub.photoUrl}
              name={categoryLabel(pub.drinkAccent)}
            />
            <div className="pubsCardBody">
              <div className="pubsCardMeta">
                <span className="pubsSource" data-source={pub.source}>
                  {pub.sourceLabel}
                </span>
                {pub.borough ? <span className="pubsBorough">{pub.borough}</span> : null}
              </div>
              <h2 className="pubsCardName">
                <Link href={venueMapUrl(pub.id)}>{pub.name}</Link>
              </h2>
              <p className="pubsCardPrice">
                {pub.cheapestPrice != null
                  ? `From ${formatPrice(pub.cheapestPrice)}`
                  : "Price coming soon"}
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
                {pub.bookingUrl ? (
                  <a
                    className="pubsBookLink"
                    href={pub.bookingUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Book
                    <ExternalLink size={13} aria-hidden="true" />
                  </a>
                ) : null}
              </div>
            </div>
          </li>
        ))}
      </ul>

      {visible.length === 0 ? (
        <p className="pubsEmpty">No scraped pubs in this filter yet.</p>
      ) : null}
    </div>
  );
}
