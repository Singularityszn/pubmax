"use client";

import dynamic from "next/dynamic";

import VenueSheetSkeleton from "@/components/map/VenueSheetSkeleton";

// The panel is its own chunk, and on a throttled phone that chunk lands seconds
// after the sheet opens. Without a fallback the sheet held the peek summary
// alone and then grew when the chunk arrived, which is a layout shift the
// reader pays for: measured 0.24 of a 0.31 CLS on a `/map?sel=` arrival. The
// skeleton is what this sheet already shows while `/api/venue/[id]` hydrates,
// so the wait for the chunk now looks like the wait for the data.
const VenueInspector = dynamic(
  () => import("@/components/map/VenueInspector"),
  { ssr: false, loading: () => <VenueSheetSkeleton /> },
);

export default VenueInspector;
