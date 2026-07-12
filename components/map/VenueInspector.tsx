"use client";

import { useMemo, useState } from "react";

import { type Venue } from "@/lib/venues";
import type { PintDropsState } from "@/components/map/usePintDrops";
import type { CrawlMode } from "@/components/map/ControlRail";
import type { LastPintDecision } from "@/lib/tfl";
import { landmarks as londonLandmarks, type Landmark } from "@/lib/landmarks";
import { STORY_BANDS, type StoryBand } from "@/lib/storyBands";
import { type CuratedCrawl } from "@/lib/curatedCrawls";
import { type CityId, DEFAULT_CITY_ID } from "@/lib/cities";
import { DEFAULT_TAB, tabsForCity, type TabKey } from "@/lib/venueInspectorTabs";

import { useInspectorTabs } from "./inspector/useInspectorTabs";
import { usePresence } from "./inspector/usePresence";
import { useVenueShare } from "./inspector/useVenueShare";
import VenueInspectorHeader from "./inspector/VenueInspectorHeader";
import VenueOverviewTab from "./inspector/VenueOverviewTab";
import VenuePintsTab from "./inspector/VenuePintsTab";
import VenueMenuTab from "./inspector/VenueMenuTab";
import VenueStoryTab from "./inspector/VenueStoryTab";
import VenueAskTab from "./inspector/VenueAskTab";
import VenueGettingHomeTab from "./inspector/VenueGettingHomeTab";
import VenueStickyBar from "./inspector/VenueStickyBar";

import "./venueSheet.css";
import "./accessibilityFilters.css";

// TabKey is imported by other modules from this file — keep it re-exported here.
export type { TabKey };

type VenueInspectorProps = {
  venue: Venue;
  mode: CrawlMode;
  inCrawl: boolean;
  latestContributorPrice: number | null | undefined;
  onToggleStop: (id: string) => void;
  onSelectVenue?: (id: string) => void;
  initialTab?: TabKey;
  pintDrops: PintDropsState;
  // The mobile bottom-sheet drag gesture (GH #17) lives in PubMap.tsx (the
  // owner of the .mapDrawer seam); this component only exposes the grab
  // handle as a pointer-event surface so the drag can start from the visible
  // grabber, not just the header bar above it. All three are no-ops on
  // desktop (PubMap gates the gesture to ≤640px before anything fires).
  onGrabDragStart?: (event: React.PointerEvent<HTMLElement>) => void;
  onGrabDragMove?: (event: React.PointerEvent<HTMLElement>) => void;
  onGrabDragEnd?: (event: React.PointerEvent<HTMLElement>) => void;
  onTabSelect?: (key: TabKey) => void;
  /** City landmark catalog for Lore "Around here". Defaults to London. */
  cityLandmarks?: Landmark[];
  /** City Place-story corridors. Defaults to London. */
  cityStoryBands?: StoryBand[];
  /** City curated crawls for Place-story deep links. Defaults to London. */
  cityCuratedCrawls?: CuratedCrawl[];
  /** Active map city — drives Last Pint / Last Tram provider. Defaults to London. */
  cityId?: CityId;
};

export default function VenueInspector({
  venue,
  mode,
  inCrawl,
  latestContributorPrice,
  onToggleStop,
  onSelectVenue,
  initialTab = DEFAULT_TAB,
  pintDrops,
  onGrabDragStart,
  onGrabDragMove,
  onGrabDragEnd,
  onTabSelect,
  cityLandmarks = londonLandmarks,
  cityStoryBands = STORY_BANDS,
  cityCuratedCrawls,
  cityId = DEFAULT_CITY_ID,
}: VenueInspectorProps) {
  const { dropsByVenueId, setComposerOpen } = pintDrops;
  const drops = useMemo(() => dropsByVenueId.get(venue.id) ?? [], [dropsByVenueId, venue.id]);
  const TABS = useMemo(() => tabsForCity(cityId), [cityId]);

  const { presenceState, markPresenceHere } = usePresence(venue);
  const { tab, selectTab, onTabKeyDown, tabRefs } = useInspectorTabs(
    initialTab,
    venue.id,
    TABS,
    onTabSelect,
  );
  const { currentShareFeedback, shareVenue } = useVenueShare(venue);

  // The venue's live Last Pint decision, lifted up from LastTrainCard so the
  // Pints tab can stamp each drop with an honest transport-context badge (IDEAS
  // A5). HONESTY CONSTRAINT: this stays null until the user opens the
  // Getting-home tab and LastTrainCard's fetch resolves — the decision simply
  // doesn't exist before then. So if they never open that tab, no badges render.
  // That's correct: a badge without a live decision behind it would be a guess.
  // LastTrainCard still owns the fetch; it only publishes the result via the
  // onDecision callback below. Reset on venue change (same adjust-state-during-
  // render pattern as tab/presence — never an effect) so a stale decision from
  // the previous pub can't leak onto this one's drops.
  const [lastTrainDecision, setLastTrainDecision] = useState<LastPintDecision | null>(null);
  const [decisionVenueId, setDecisionVenueId] = useState(venue.id);
  if (decisionVenueId !== venue.id) {
    setDecisionVenueId(venue.id);
    setLastTrainDecision(null);
  }

  return (
    <section className="venueInspector">
      <VenueInspectorHeader
        venue={venue}
        TABS={TABS}
        tab={tab}
        selectTab={selectTab}
        onTabKeyDown={onTabKeyDown}
        tabRefs={tabRefs}
        onGrabDragStart={onGrabDragStart}
        onGrabDragMove={onGrabDragMove}
        onGrabDragEnd={onGrabDragEnd}
      />

      {/* Overview — identity, latest price, add-to-crawl, "I'm here tonight". */}
      <VenueOverviewTab
        venue={venue}
        tab={tab}
        cityId={cityId}
        mode={mode}
        inCrawl={inCrawl}
        latestContributorPrice={latestContributorPrice}
        onToggleStop={onToggleStop}
        presenceState={presenceState}
        markPresenceHere={markPresenceHere}
      />

      {/* Pints — the primary tab: demo note, drops list, composer / log bar. */}
      <VenuePintsTab
        venue={venue}
        tab={tab}
        pintDrops={pintDrops}
        drops={drops}
        lastTrainDecision={lastTrainDecision}
        onTabSelect={onTabSelect}
      />

      {/* Menu — visual hub (Drinks first) → drink list deep-dive. Food is
          link-out only when we have a pub website / menu URL. */}
      <VenueMenuTab venue={venue} tab={tab} />

      {/* Story — description / heritage note + provenance-stamped claims. */}
      <VenueStoryTab
        venue={venue}
        tab={tab}
        drops={drops}
        cityId={cityId}
        cityLandmarks={cityLandmarks}
        cityStoryBands={cityStoryBands}
        cityCuratedCrawls={cityCuratedCrawls}
      />

      {/* Ask — the grounded "Ask the PUBMAXXER" landlord guide. */}
      <VenueAskTab venue={venue} tab={tab} />

      {/* Getting home — the nearest station + last trains tonight (TfL), so you
          know when to head off for the last drink. */}
      <VenueGettingHomeTab
        venue={venue}
        tab={tab}
        cityId={cityId}
        onSelectVenue={onSelectVenue}
        onDecision={setLastTrainDecision}
      />

      {/* Wave K1 — mobile sticky command bar (Drop / crawl / share / train).
          Desktop keeps actions in-tab; this bar is CSS-hidden above 640px. */}
      <VenueStickyBar
        venue={venue}
        mode={mode}
        inCrawl={inCrawl}
        onToggleStop={onToggleStop}
        selectTab={selectTab}
        setComposerOpen={setComposerOpen}
        shareVenue={shareVenue}
        currentShareFeedback={currentShareFeedback}
      />
    </section>
  );
}
