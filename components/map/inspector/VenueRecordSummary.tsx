import type { VenueRecordCopy } from "@/lib/venueRecordCopy";

export default function VenueRecordSummary({ copy }: { copy?: VenueRecordCopy }) {
  if (!copy) return null;
  return (
    <div aria-label="About this pub">
      <p>{copy.description}</p>
      <div className="amenityRow" aria-label="Pub vibe">
        {copy.vibeTags.map((tag) => <span className="amenity" key={tag}>{tag}</span>)}
      </div>
    </div>
  );
}
