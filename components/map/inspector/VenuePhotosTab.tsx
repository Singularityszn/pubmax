import VenuePhotoWall from "@/components/venue/VenuePhotoWall";
import type { Venue } from "@/lib/venues";
import type { TabKey } from "@/lib/venueInspectorTabs";

export default function VenuePhotosTab({ venue, tab, empty, onContentChange }: {
  venue: Venue;
  tab: TabKey;
  empty: boolean;
  onContentChange: (hasPhotos: boolean | null) => void;
}) {
  return (
    <div
      role={empty ? undefined : "tabpanel"}
      id={empty ? undefined : "venuePanel-photos"}
      aria-labelledby={empty ? undefined : "venueTab-photos"}
      className="venueTabPanel"
      hidden={tab !== (empty ? "overview" : "photos")}
    >
      <VenuePhotoWall venueId={venue.id} venueName={venue.name} onContentChange={onContentChange} />
    </div>
  );
}
