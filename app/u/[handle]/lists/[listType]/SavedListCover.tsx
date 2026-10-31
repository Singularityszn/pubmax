import VenueImage from "@/components/media/VenueImage";
import type { SavedListCoverRead } from "@/lib/savedListShare.server";

import "./savedListCover.css";

type Props = {
  cover: SavedListCoverRead | null;
  listType: string;
};

/**
 * The picture at the top of a shared list: the first pub's own photo through
 * the existing venue image path (VenueImage proxies a scraped photo and labels
 * where it came from), or, when the pub has none, a plain panel tinted by the
 * pub's kind. Nothing is painted for an empty list.
 */
export default function SavedListCover({ cover, listType }: Props) {
  if (!cover) return null;
  const kind = cover.kind ?? "pub";
  return (
    <figure className="savedListCover" data-kind={kind}>
      {cover.imageUrl ? (
        <VenueImage
          sources={[{ url: cover.imageUrl, provenance: "chain" }]}
          alt={`${cover.venueName}, first on ${listType}`}
          className="savedListCover__image"
          sizes="(max-width: 720px) 100vw, 720px"
          maxWidth={1080}
          priority
        />
      ) : (
        <div className="savedListCover__placeholder" aria-hidden="true" />
      )}
      <figcaption className="savedListCover__caption">First up: {cover.venueName}</figcaption>
    </figure>
  );
}
