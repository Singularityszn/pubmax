import MapLoadingSkeleton from "@/components/map/MapLoadingSkeleton";

/** Instant loading UI for /map/[city] — city name arrives with the page shell. */
export default function CityMapLoading() {
  return <MapLoadingSkeleton />;
}
