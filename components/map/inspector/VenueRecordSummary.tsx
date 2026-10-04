import { Amenity } from "@/components/map/venueInspectorBits";
import type { VenueRecordCopy } from "@/lib/venueRecordCopy";

export default function VenueRecordSummary({ copy }: { copy?: VenueRecordCopy }) {
  if (!copy) return null;
  return (
    <div>
      <p>{copy.description}</p>
      <div className="amenityRow" role="group" aria-label="Pub vibe">
        {copy.vibeTags.map((tag) => <Amenity key={tag} status="known-true" label={tag} />)}
      </div>
    </div>
  );
}
