import MapLoadingSkeleton from "@/components/map/MapLoadingSkeleton";

// This boundary is the shell for EVERY /map route: /map, each /map/[city] and
// /map/arrival, which can open the UK-wide map or a place outside London. A
// loading segment is not told which of them it stands in for, so it carries no
// London snapshot date: an undated shell is true for every city, and a dated one
// would be false for all but one. The pages hand the date to their own loading
// screens (`mapPricesReadLineFor`).
export default function MapLoading() {
  return <MapLoadingSkeleton routeLevel />;
}
