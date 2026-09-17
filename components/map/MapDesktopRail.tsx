"use client";

import AreaNewsRail from "@/components/desktop/AreaNewsRail";
import DesktopRail from "@/components/desktop/DesktopRail";

import "./mapDesktopRail.module.css";

// Desktop map right-rail (D3.1). Composes the shared DesktopRail host with the
// map's Area-news slot. Mounted only at >=1024, with the venue drawer closed and
// the first-visit strip gone (PubMap gates all three); the top-right positioning
// lives in mapDesktopRail.module.css. `area` is the Night Area slug under the current
// map view, or null when unknown, and AreaNewsRail then renders nothing, so an
// empty rail is simply an invisible, empty stack.
//
// The conditions verdict is NOT here any more. It had two homes, this rail and
// the toolbar chip, with a CSS rule hiding whichever was the duplicate; it now
// has one, inside the Layers popover, and it is not on the map at arrival at
// all (captain, 7 Sep 2026, walk finding B9).
export default function MapDesktopRail({ area }: { area: string | null }) {
  return (
    <DesktopRail
      className="mapRail"
      ariaLabel="Conditions and area news"
      areaNews={<AreaNewsRail area={area} />}
    />
  );
}
