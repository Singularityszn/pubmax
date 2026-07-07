import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import EmptyState from "@/components/EmptyState";
import SiteNav from "@/components/nav/SiteNav";
import VenueRatingPanel from "@/components/ratings/VenueRatingPanel";
import ShareBar from "@/components/share/ShareBar";
import { buildBarTab, normalizePintDrop, type BarTabTile, type PintDropDTO } from "@/lib/feed";
import { isSupabaseConfigured } from "@/lib/supabase";
import { memoryPintDropStore, supabasePintDropStore } from "@/lib/pintDropsStore";
import { getVenueIndex, venueMapUrl } from "@/lib/venueIndex";
import { groupVenuePrices, type Venue, type VenuePrice } from "@/lib/venues";

import "./barTab.css";

// The Bar Tab (issue #36): a venue's recent Spills as an Instagram-style profile
// grid — the "screenshot-worthy" venue surface, distinct from the Ledger (the
// Boomer/heritage reading surface). Same seams as the Ledger page: the memoized
// dataset read for the venue header, and the SAME pint-drop store's
// listVisible(venueId) — so the #29 visibility guarantees (no friends/legacy
// leak; anonymous drops show the safe "a PUBMAXXER" label) hold by construction.
//
// A server component: the first paint already carries the grid. The only client
// slivers are the ShareBar strips (native-share + copy-link fallback).

type PageProps = { params: Promise<{ id: string }> };

// Mirrors app/ledger/[id]'s memoized venue read: group the bundled dataset once
// per process, look up by id. Never throws — a read failure yields an empty map
// so an unknown id 404s (friendly) rather than 500-ing.
let cachedVenues: Map<string, Venue> | null = null;

async function getVenue(id: string): Promise<Venue | null> {
  if (!cachedVenues) {
    const index = new Map<string, Venue>();
    try {
      await getVenueIndex(); // keeps the shared dataset read warm/memoized
      const { promises: fs } = await import("fs");
      const path = await import("path");
      const file = path.join(process.cwd(), "public", "data", "pint_prices_app_dataset.json");
      const rows = JSON.parse(await fs.readFile(file, "utf8")) as VenuePrice[];
      for (const venue of groupVenuePrices(Array.isArray(rows) ? rows : [])) {
        index.set(venue.id, venue);
      }
    } catch {
      // leave `index` empty — degrade to notFound(), never a 500
    }
    cachedVenues = index;
  }
  return cachedVenues.get(id) ?? null;
}

function pintDropStoreFor() {
  return isSupabaseConfigured() ? supabasePintDropStore : memoryPintDropStore;
}

function formatGbp(price: number): string {
  return `£${price.toFixed(2)}`;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const venue = await getVenue(id);
  if (!venue) {
    return { title: "Bar Tab — PUBMAXXING", robots: { index: false, follow: false } };
  }
  const title = `The Bar Tab: ${venue.name} — PUBMAXXING`;
  const description = `Recent pints dropped at ${venue.name} in ${
    venue.primaryBorough || "London"
  } — photos, prices, and the stories behind them.`;
  return {
    title,
    description,
    openGraph: { title, description, type: "website" },
    twitter: { card: "summary", title, description },
  };
}

function NotInTheTab() {
  return (
    <main className="barTabPage barTabPage--empty">
      <SiteNav active="feed" />
      <div className="barTabEmptyCard">
        <p className="barTabEyebrow">The Bar Tab</p>
        <h1 className="barTabEmptyTitle">This pub isn&rsquo;t on the tab</h1>
        <p className="barTabEmptyBody">
          It may have moved, or the link is wrong. Every mapped pub still has a home.
        </p>
        <Link className="barTabPrimaryLink" href="/map">
          Back to the map
        </Link>
      </div>
    </main>
  );
}

export default async function BarTabPage({ params }: PageProps) {
  const { id } = await params;
  const venue = await getVenue(id);
  if (!venue) return <NotInTheTab />;

  // The SAME public read the feed uses — visibility already applied server-side
  // (issue #29). No viewer is passed, so this is the anonymous public surface:
  // friends/legacy drops are excluded, anonymous drops carry the safe label.
  const drops = await pintDropStoreFor().listVisible(id);
  // Normalise through the feed's normaliser so tiles carry resolved photo URLs,
  // captions, and the safe (possibly-anonymised) handle straight from the DTO.
  const barTab = buildBarTab((drops as PintDropDTO[]).map(normalizePintDrop));

  const shareUrl = `/bar-tab/${encodeURIComponent(id)}`;

  return (
    <main className="barTabPage">
      <SiteNav active="feed" />

      <header className="barTabHead">
        <p className="barTabEyebrow">The Bar Tab</p>
        <h1 className="barTabTitle">{venue.name}</h1>
        <p className="barTabAddress">
          {venue.address ? `${venue.address} · ` : ""}
          {venue.primaryBorough || "London"}
        </p>

        <div className="barTabHeadRow">
          {barTab.cheapestGbp !== null ? (
            <span className="barTabCheapest" title="Cheapest pint on the tab">
              <span className="barTabCheapestLabel">From</span>
              <span className="barTabCheapestValue">{formatGbp(barTab.cheapestGbp)}</span>
            </span>
          ) : null}
          <span className="barTabCount">
            {barTab.tileCount} {barTab.tileCount === 1 ? "pint" : "pints"} on the tab
          </span>
        </div>

        <div className="barTabHeadActions">
          <Link className="barTabMapLink" href={venueMapUrl(id)}>
            Open on the map
          </Link>
          <Link className="barTabLedgerLink" href={`/ledger/${encodeURIComponent(id)}`}>
            Read the ledger
          </Link>
          <ShareBar
            url={shareUrl}
            title={`The Bar Tab at ${venue.name}`}
            text={`Recent pints at ${venue.name}. Every pint has a story.`}
          />
        </div>

        {/* Pub rating (E3): community stars (shown past the 10-vote floor) +
            the viewer's own half-star vote. A client sliver; the rest of the
            page stays a server render. */}
        <VenueRatingPanel venueId={id} venueName={venue.name} />
      </header>

      {barTab.tileCount === 0 ? (
        <EmptyState
          className="barTabEmpty"
          eyebrow="Quiet at the bar"
          title="No pints on the tab yet."
          body="Be the first to drop one here — snap your pint, log the price, pass down a story."
          action={<Link href={venueMapUrl(id)}>Drop a pint here</Link>}
        />
      ) : (
        <ul className="barTabGrid" aria-label={`Recent pints at ${venue.name}`}>
          {barTab.tiles.map((tile) => (
            <li key={tile.id} className="barTabCell">
              <Tile tile={tile} venueName={venue.name} />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

function Tile({ tile, venueName }: { tile: BarTabTile; venueName: string }) {
  const price = typeof tile.priceGbp === "number" ? formatGbp(tile.priceGbp) : null;

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
        {price ? <span className="barTabTilePrice">{price}</span> : null}
      </Link>
    );
  }

  // Text-only drop → a mini typographic receipt tile, so the grid is never a gap.
  return (
    <Link className="barTabTile barTabTile--receipt" href={`/p/${tile.id}`}>
      <span className="barTabTileEyebrow">Pint Drop</span>
      <span className="barTabTileReceiptPrice">{price ?? "A memory"}</span>
      {tile.drink ? <span className="barTabTileDrink">{tile.drink}</span> : null}
      {tile.note ? <span className="barTabTileNote">{tile.note}</span> : null}
    </Link>
  );
}
