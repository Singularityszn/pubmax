import { PlusCircle, Route as RouteIcon, Share2, TrainFront } from "lucide-react";

import type { Venue } from "@/lib/venues";
import type { CrawlMode } from "@/components/map/ControlRail";
import type { ShareFeedback } from "@/lib/venueShare";
import type { TabKey } from "@/lib/venueInspectorTabs";

export default function VenueStickyBar({
  venue,
  mode,
  inCrawl,
  onToggleStop,
  selectTab,
  setComposerOpen,
  shareVenue,
  currentShareFeedback,
}: {
  venue: Venue;
  mode: CrawlMode;
  inCrawl: boolean;
  onToggleStop: (id: string) => void;
  selectTab: (key: TabKey) => void;
  setComposerOpen: (open: boolean) => void;
  shareVenue: () => Promise<void>;
  currentShareFeedback: ShareFeedback | null;
}) {
  return (
    <div className="venueSheetStickyBar" role="toolbar" aria-label="Venue actions">
      <button
        type="button"
        className="venueSheetStickyPrimary"
        onClick={() => {
          selectTab("pints");
          setComposerOpen(true);
        }}
        aria-label={`Log a Pint Drop at ${venue.name}`}
      >
        <PlusCircle size={16} aria-hidden="true" />
        Drop
      </button>
      {mode === "build" ? (
        <button
          type="button"
          className="venueSheetStickyGhost"
          aria-pressed={inCrawl}
          onClick={() => onToggleStop(venue.id)}
        >
          <RouteIcon size={15} aria-hidden="true" />
          {inCrawl ? "Remove" : "Crawl"}
        </button>
      ) : null}
      <button
        type="button"
        className="venueSheetStickyGhost"
        onClick={() => {
          void shareVenue();
        }}
        aria-label={`Share ${venue.name}`}
      >
        <Share2 size={15} aria-hidden="true" />
        Share
      </button>
      <button
        type="button"
        className="venueSheetStickyGhost"
        onClick={() => selectTab("getting-home")}
        aria-label="Check last train"
      >
        <TrainFront size={15} aria-hidden="true" />
        Train
      </button>
      {currentShareFeedback ? (
        <span
          role={currentShareFeedback.tone === "error" ? "alert" : "status"}
          className={`venueSheetShareFeedback ${currentShareFeedback.tone}`}
        >
          {currentShareFeedback.text}
        </span>
      ) : null}
    </div>
  );
}
