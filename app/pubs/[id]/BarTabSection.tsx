import type { Route } from "next";
import Image from "next/image";
import Link from "next/link";
import { PintPriceBadge } from "@/components/PriceBadge";
import EmptyState from "@/components/ui/empty-state";
import ShareBar from "@/components/share/ShareBar";
import { buildBarTab, normalizePintDrop, type BarTabTile, type PintDropDTO } from "@/lib/feed";
import { buildBarTabShareText } from "@/lib/shareArtifacts";
import { pintDropsStore } from "@/lib/pintDropsStore";
import { venueMapUrl } from "@/lib/venueIndex";
import "@/app/bar-tab/[id]/barTab.css";

export default async function BarTabSection({ venueId, venueName }: { venueId: string; venueName: string }) {
  const drops = await Promise.resolve().then(() => pintDropsStore().listVisible(venueId)).catch(() => null);
  const tab = drops ? buildBarTab((drops as PintDropDTO[]).map(normalizePintDrop)) : null;
  const shareUrl = `/pubs/${encodeURIComponent(venueId)}#tab`;
  return (
    <section id="tab" className="pubPage__section" aria-labelledby="pub-tab-title">
      <h2 id="pub-tab-title">The Bar Tab</h2>
      <ShareBar url={shareUrl} title={`The Bar Tab at ${venueName}`} text={buildBarTabShareText({ venueName })} />
      {!tab ? <p role="status">The Bar Tab did not answer just now.</p> : tab.tileCount === 0 ? (
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
    typeof tile.priceGbp === "number" ? (
      <PintPriceBadge priceGbp={tile.priceGbp} venueId={venueId} className="barTabTilePrice" />
    ) : null;

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
    </Link>
  );
}
