"use client";

import { useMemo, useState } from "react";

import { type Venue } from "@/lib/venues";
import type { PintDropsState } from "@/components/map/usePintDrops";
import type { CommunityPricesState } from "@/components/map/useCommunityPrices";
import type { CrawlMode } from "@/components/map/ControlRail";
import type { LastPintDecision } from "@/lib/tfl";
import { landmarks as londonLandmarks, type Landmark } from "@/lib/landmarks";
import { STORY_BANDS, type StoryBand } from "@/lib/storyBands";
import { type CuratedCrawl } from "@/lib/curatedCrawls";
import { type CityId, DEFAULT_CITY_ID } from "@/lib/cities";
import { DEFAULT_TAB, tabsForVenue, type TabKey } from "@/lib/venueInspectorTabs";
import { isPubVenue } from "@/lib/venueKindFilters";
import type { JourneyPoint } from "@/lib/venueJourney";
import type { LocationRequestStatus } from "@/components/map/VenueGettingThere";

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
  /** Epoch ms of the latest Pint Drop, from the unmerged drop signal - see
   *  VenueOverviewTab, which hands it to the submit receipt. */
  latestPintDropAt?: number | null;
  onToggleStop: (id: string) => void;
  onSelectVenue?: (id: string) => void;
  /**
   * Trusted-handoff §4.8 "Make it Stop 1": accept this Venue into a Plan. Only
   * provided when the intent-write flag is on; the action is otherwise absent.
   */
  onAcceptStop1?: () => void;
  initialTab?: TabKey;
  pintDrops: PintDropsState;
  /**
   * Community price layer - backs the fast "What's it tonight?" submission on
   * the Overview tab and the restamp every other surface reads.
   */
  communityPrices: CommunityPricesState;
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
  userLocation: JourneyPoint | null;
  locationRequestStatus: LocationRequestStatus;
  onRequestLocation: () => void;
  onClearLocation: () => void;
};

export default function VenueInspector({
  venue,
  mode,
  inCrawl,
  latestContributorPrice,
  latestPintDropAt,
  onToggleStop,
  onSelectVenue,
  onAcceptStop1,
  initialTab = DEFAULT_TAB,
  pintDrops,
  communityPrices,
  onGrabDragStart,
  onGrabDragMove,
  onGrabDragEnd,
  onTabSelect,
  cityLandmarks = londonLandmarks,
  cityStoryBands = STORY_BANDS,
  cityCuratedCrawls,
  cityId = DEFAULT_CITY_ID,
  userLocation,
  locationRequestStatus,
  onRequestLocation,
  onClearLocation,
}: VenueInspectorProps) {
  const { dropsByVenueId, setComposerOpen } = pintDrops;
  const drops = useMemo(() => dropsByVenueId.get(venue.id) ?? [], [dropsByVenueId, venue.id]);
  const pubVenue = isPubVenue(venue);
  const TABS = useMemo(() => tabsForVenue(cityId, venue.kind), [cityId, venue.kind]);
  const safeInitialTab = pubVenue || initialTab !== "pints" ? initialTab : DEFAULT_TAB;

  // E3′ — the header photo prefers a chain (scraped) photo but falls back to
  // the most recent community Pint Drop photo for this venue so a pub with no
  // scraped image still gets an honestly-labelled community shot instead of
  // the empty gradient.
  const communityPhotoUrl = useMemo(
    () =>
      drops.find((drop) => drop.venuePhotoUrl)?.venuePhotoUrl ??
      drops.find((drop) => drop.pintPhotoUrl)?.pintPhotoUrl ??
      null,
    [drops],
  );

  const { presenceState, markPresenceHere } = usePresence(venue);
  const { tab, selectTab, onTabKeyDown, tabRefs } = useInspectorTabs(
    safeInitialTab,
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
        communityPhotoUrl={communityPhotoUrl}
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
        latestPintDropAt={latestPintDropAt}
        communityPrices={communityPrices}
        onToggleStop={onToggleStop}
        presenceState={presenceState}
        markPresenceHere={markPresenceHere}
        userLocation={userLocation}
        locationRequestStatus={locationRequestStatus}
        onRequestLocation={onRequestLocation}
        onClearLocation={onClearLocation}
        onStartFirstDrop={() => {
          if (!pubVenue) return;
          // First-drop nudge (Cycle-8 item 3): open the existing composer,
          // prefilled-for-this-venue by rendering the Pints tab with this
          // venue's id. Mirrors firstDropComposerIntent(venue.id).
          selectTab("pints");
          setComposerOpen(true);
        }}
      />

      {/* Pints — the primary tab: demo note, drops list, composer / log bar. */}
      {pubVenue ? (
        <VenuePintsTab
          venue={venue}
          tab={tab}
          pintDrops={pintDrops}
          drops={drops}
          lastTrainDecision={lastTrainDecision}
          onTabSelect={onTabSelect}
        />
      ) : null}

      {/* Menu — visual hub (Drinks first) → drink list deep-dive. Food is
          link-out only when we have a venue website / menu URL. */}
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
        onAcceptStop1={onAcceptStop1}
        selectTab={selectTab}
        setComposerOpen={setComposerOpen}
        shareVenue={shareVenue}
        currentShareFeedback={currentShareFeedback}
      />
    </section>
  );
}
