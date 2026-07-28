import LastTrainCard from "../LastTrainCard";
import NearbyBusDepartures from "../NearbyBusDepartures";
import type { Venue } from "@/lib/venues";
import type { LastPintDecision } from "@/lib/tfl";
import type { CityId } from "@/lib/cities";
import type { TabKey } from "@/lib/venueInspectorTabs";

export default function VenueGettingHomeTab({
  venue,
  tab,
  cityId,
  onSelectVenue,
  onDecision,
}: {
  venue: Venue;
  tab: TabKey;
  cityId: CityId;
  onSelectVenue?: (id: string) => void;
  onDecision: (decision: LastPintDecision | null) => void;
}) {
  return (
    <div
      role="tabpanel"
      id="venuePanel-getting-home"
      aria-labelledby="venueTab-getting-home"
      className="venueTabPanel"
      hidden={tab !== "getting-home"}
    >
      {tab === "getting-home" ? (
        <>
          <LastTrainCard
            key={`${cityId}:${venue.id}:${venue.latitude}:${venue.longitude}:${venue.name}`}
            lat={venue.latitude}
            lng={venue.longitude}
            venueName={venue.name}
            cityId={cityId}
            venueKind={venue.kind}
            onSelectVenue={onSelectVenue}
            onDecision={onDecision}
          />
          {cityId === "london" ? (
            <NearbyBusDepartures
              key={venue.id}
              lat={venue.latitude}
              lng={venue.longitude}
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}
