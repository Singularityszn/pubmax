// Issue #35 — shared map skeleton. This paints both the route-level /map
// loading state and the client-side dynamic PubMap fallback, so both transitions
// use the same pitched-London held frame.
//
// Only the in-page fallback is a <main>: it holds PubMap's own place, and PubMap
// paints the <main> that replaces it. The route-level frame is a named region.
// On a document load React streams the page, in-page fallback and all, into a
// hidden segment beside that frame and swaps it in later, so a <main> there
// made two <main> elements in one document for that window.
//
// It is a plain field (--paper by day, --ink-deep by night) with the pint
// loader and one line, continued seamlessly by PubMap's own .mapLoading while
// the WebGL canvas style loads. No drawn map: a fake map before the real one
// was a template tell (taste plan, 18 Oct 2026).

import PintLoader from "@/components/ui/pint-loader";
import { mapLoadingPrimaryLine } from "@/lib/mapLoadingCopy";

type MapLoadingSkeletonProps = {
  /**
   * What this map is about to show. The route-level boundary cannot know it
   * (a Next loading segment takes no params), so it stays empty there and the
   * line falls back to the cityless one rather than naming the wrong city.
   */
  cityDisplayName?: string;
  /** The route-level frame, which stands in for a page that owns its <main>. */
  routeLevel?: boolean;
  /** When the newest London price was read, or null off London's bundled prices. */
  pricesReadLine?: string | null;
};

export default function MapLoadingSkeleton({
  cityDisplayName = "",
  routeLevel = false,
  pricesReadLine = null,
}: MapLoadingSkeletonProps) {
  const Frame = routeLevel ? "section" : "main";
  return (
    <Frame id="main"
      className="mapSkeleton"
      aria-busy="true"
      aria-describedby="mapSkeletonStatus"
      aria-label={routeLevel ? "Loading map" : undefined}
      aria-live="polite"
    >
      <div className="mapSkeletonInner">
        <div className="mapSkeletonCopy" id="mapSkeletonStatus" role="status">
          <PintLoader size="sm" />
          <div>
            <h1>UK venue map</h1>
            <p>{mapLoadingPrimaryLine(cityDisplayName)}</p>
            {pricesReadLine ? <p className="mapSkeletonReads">{pricesReadLine}</p> : null}
          </div>
        </div>
      </div>
    </Frame>
  );
}
