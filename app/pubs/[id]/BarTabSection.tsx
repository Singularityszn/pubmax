"use client";

import type { Route } from "next";
import Image from "next/image";
import Link from "next/link";
import PriceBadge, { PintPriceBadge } from "@/components/PriceBadge";
import EmptyState from "@/components/ui/empty-state";
import ShareBar from "@/components/share/ShareBar";
import type { BarTabTile } from "@/lib/feed";
import { useLedgerLive } from "@/components/ledger/LedgerLive";
import { buildBarTabShareText } from "@/lib/shareArtifacts";
import { venueMapUrl } from "@/lib/venueMapUrl";
import { drinkMeasureName } from "@/lib/drinkMeasure";
import { formatGbp } from "@/lib/formatGbp";
import "@/app/bar-tab/[id]/barTab.css";

export default function BarTabSection({ venueId, venueName }: { venueId: string; venueName: string }) {
  const { state, reload } = useLedgerLive();
  const tab = state.status === "ready" ? state.log.barTab : null;
  const shareUrl = `/pubs/${encodeURIComponent(venueId)}#tab`;
  return (
    <section id="tab" className="pubPage__section" aria-labelledby="pub-tab-title">
      <h2 id="pub-tab-title">The Bar Tab</h2>
      <ShareBar url={shareUrl} title={`The Bar Tab at ${venueName}`} text={buildBarTabShareText({ venueName })} />
      {state.status === "loading" ? <p role="status">Reading the Bar Tab…</p> : !tab ? <p role="status">The Bar Tab did not answer just now. <button type="button" className="ledgerMapLink" onClick={reload}>Try again</button></p> : tab.tileCount === 0 ? (
        <EmptyState className="barTabEmpty" title="No pints on the tab yet."
          action={<Link prefetch={false} href={`${venueMapUrl(venueId)}&log=1` as Route}>Drop a pint here</Link>}>
          Be the first to drop one here. Snap your pint, log the price, pass down a story.
        </EmptyState>
      ) : (
        <ul className="barTabGrid" aria-label={`Recent pints at ${venueName}`}>
          {tab.tiles.map((tile) => <li key={tile.id} className="barTabCell"><Tile tile={tile} venueName={venueName} venueId={venueId} /></li>)}
        </ul>
      )}
    </section>
  );
}

function Tile({ tile, venueName, venueId }: { tile: BarTabTile; venueName: string; venueId: string }) {
  // A pint price wears its band through the one price look (components/PriceBadge.tsx).
  const price =
    typeof tile.priceGbp === "number" && tile.measure === "pint" ? (
      <PintPriceBadge priceGbp={tile.priceGbp} venueId={venueId} className="barTabTilePrice" />
    ) : typeof tile.priceGbp === "number" ? (
      <PriceBadge className="barTabTilePrice">{formatGbp(tile.priceGbp)} · {tile.measure ? drinkMeasureName(tile.measure, tile.measureLabel) : "Measure unknown"}</PriceBadge>
    ) : null;
  const date = new Date(tile.createdAt);
  const dateLabel = Number.isNaN(date.getTime()) ? "Date unknown" : new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(date);
  const source = <span className="barTabTileSource">{tile.handle} · <time dateTime={tile.createdAt}>{dateLabel}</time></span>;

  if (tile.kind === "photo" && tile.photoUrl) {
    return (
      <Link className="barTabTile barTabTile--photo" href={`/p/${tile.id}`}>
        <Image
          className="barTabTilePhoto"
          src={tile.photoUrl}
          alt={`Pint at ${venueName}, shared by ${tile.handle}`}
          width={480}
          height={480}
          loading="lazy"
          unoptimized
        />
        {price}
        {source}
      </Link>
    );
  }

  // Text-only drop → a mini typographic receipt tile, so the grid is never a gap.
  return (
    <Link className="barTabTile barTabTile--receipt" href={`/p/${tile.id}`}>
      <span className="barTabTileEyebrow">Pint Drop</span>
      {price ?? <span className="barTabTileMemory">A memory</span>}
      {tile.drink ? <span className="barTabTileDrink">{tile.drink}</span> : null}
      {tile.note ? <span className="barTabTileNote">{tile.note}</span> : null}
      {source}
    </Link>
  );
}
