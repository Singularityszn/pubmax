// @vitest-environment jsdom
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import TonightAnswerCards from "@/components/tonight/TonightAnswerCards";
import { useTonightAnswers } from "@/components/tonight/useTonightAnswers";
import { clearSurfaceCache } from "@/lib/surfaceDataCache";

/**
 * Direct client fetches that are not reusable painted reads.
 *
 * This is a shrinking declaration. A component read belongs in
 * surfaceDataCache.ts whenever it paints a reloadable surface. Entries here
 * cover mutations, auth and identity, Social no-store lanes, map interaction
 * reads, and other flows with their own lifecycle or privacy contract.
 */
type SurfaceReadExemption = {
  path: string;
  fetchCount: number;
  reason: string;
};

const SURFACE_READ_EXEMPTIONS = [
  { path: "app/admin/AdminClient.tsx", fetchCount: 30, reason: "admin moderation reads and writes use the admin lane" },
  { path: "app/admin/SocialSafetyModeration.tsx", fetchCount: 2, reason: "admin safety queue reads and moderation or evidence requests use the private no-store admin session lane" },
  { path: "app/discover/DiscoverPageClient.tsx", fetchCount: 2, reason: "Social discover access and feed reads are explicit no-store" },
  { path: "app/feed/FeedPageClient.tsx", fetchCount: 4, reason: "Social feed and optimistic post actions keep their no-store and retry semantics" },
  { path: "app/rounds/[code]/RoundPageClient.tsx", fetchCount: 1, reason: "shared round view and report actions use their own lifecycle" },
  { path: "app/social/SocialComposer.tsx", fetchCount: 2, reason: "Social composer venue search is no-store, and a video PUT goes straight to its signed Storage URL with no bearer; other mutations use the shared auth transport" },
  { path: "app/admin/SocialVideoModeration.tsx", fetchCount: 2, reason: "admin held-video queue reads and decisions use the admin lane" },
  { path: "app/social/crews/[crewId]/CrewDetailClient.tsx", fetchCount: 2, reason: "Social crew access and actions are no-store by policy" },
  { path: "app/social/SocialLondonLane.tsx", fetchCount: 1, reason: "the signed-out London lane is a Social no-store read with its own signed paging cursor, paused by the launch rollback flag and the freeze" },
  { path: "app/u/[handle]/ProfilePageClient.tsx", fetchCount: 2, reason: "handle alias resolution is never cached. Authenticated Passport geography has an account-scoped lifecycle and bypasses the shared public cache" },
  { path: "components/ClientErrorReporter.tsx", fetchCount: 1, reason: "the client error report is fire-and-forget telemetry behind sendBeacon, never painted data" },
  { path: "components/LandlordPanel.tsx", fetchCount: 1, reason: "heritage question is a user-submitted request, not a painted reload surface" },
  { path: "components/PubMap.tsx", fetchCount: 3, reason: "map data packs and viewport streams have map-owned cache policy" },
  { path: "components/PubMapCanvas.tsx", fetchCount: 2, reason: "venue selection and route interaction are map-owned reads" },
  { path: "components/areanews/AreaNewsBlock.tsx", fetchCount: 1, reason: "venue news is an additive detail read with its own freshness lane" },
  { path: "components/areanews/VenueAwardBadge.tsx", fetchCount: 1, reason: "venue award detail is an additive map read" },
  { path: "components/auth/HandlePasswordSignIn.tsx", fetchCount: 1, reason: "password sign-in is auth and explicitly denied" },
  { path: "components/coverage/UnsupportedAreaPreview.tsx", fetchCount: 1, reason: "coverage preview is an optional area-demand probe" },
  { path: "components/desktop/AreaNewsRail.tsx", fetchCount: 1, reason: "area news rail has a separate additive freshness contract" },
  { path: "components/landing/LandingSavings.tsx", fetchCount: 1, reason: "the reader's own saved total reads their logged prices once, only when a handle is known; a stranger's landing makes no request at all" },
  { path: "components/landing/PintDropStrip.tsx", fetchCount: 1, reason: "landing contribution strip has anonymous demo fallback semantics" },
  { path: "components/ledger/LedgerLive.tsx", fetchCount: 1, reason: "the Ledger's live half carries the reader's own bearer token and their unredacted Family Table rows, so it is account-scoped and never held; a moderated, withdrawn or erased drop must leave the page on the next read" },
  { path: "components/map/ActiveRoundChip.tsx", fetchCount: 1, reason: "active round is a live plan interaction" },
  { path: "components/map/CityPlaceStrip.tsx", fetchCount: 1, reason: "place enrichment is an interactive map read; the place SEARCH beside it moved to lib/cityPlaceSearch.ts, which VenueBuzz shares so one sheet asks once" },
  { path: "components/map/CitySuggestBanner.tsx", fetchCount: 1, reason: "map search suggestion is an interactive pack read" },
  { path: "components/map/NearbyBusDepartures.tsx", fetchCount: 1, reason: "nearby transport is live and location-scoped" },
  { path: "components/map/canvas/iconSprite.ts", fetchCount: 1, reason: "the map icon atlas is a static image the canvas decodes into map images, never painted data; its URL carries its own hash" },
  { path: "components/map/UnverifiedPubSheet.tsx", fetchCount: 1, reason: "harvest overlay is an additive lazy read for one unverified pub sheet and never paints a reload surface" },
  { path: "components/map/inspector/VenueSpoonsValueRow.tsx", fetchCount: 1, reason: "the Spoons value row is an additive lazy read for one pub, edge-cacheable because an imported menu reading is the same for every reader, and it renders nothing rather than wording an absence" },
  { path: "components/map/VenueBuzz.tsx", fetchCount: 1, reason: "buzz is an interactive detail read; the place search beside it moved to the shared lib/cityPlaceSearch.ts" },
  { path: "components/map/VenueHygiene.tsx", fetchCount: 1, reason: "venue hygiene lookup is an additive detail read" },
  { path: "components/map/VenueListedBuilding.tsx", fetchCount: 1, reason: "the listed-building line is an additive lazy read for one base pub sheet, and it renders nothing rather than wording an absence" },
  { path: "components/map/VenueWikidataHistory.tsx", fetchCount: 1, reason: "Wikidata history is an additive lazy read for one base pub sheet, and it renders nothing rather than wording an absence" },
  { path: "components/map/VenueWeatherRecommendations.tsx", fetchCount: 1, reason: "venue weather recommendations are location and venue interaction reads" },
  { path: "components/map/pubmap/useActivePlanRoute.ts", fetchCount: 1, reason: "active plan state is no-store and mutation-sensitive" },
  { path: "components/map/pubmap/useCrewPals.ts", fetchCount: 1, reason: "crew Pals are a plan member's no-store read, answered only to the plan's own member session and dropped when the plan ends" },
  { path: "components/map/pubmap/useUkBaseStreaming.ts", fetchCount: 1, reason: "UK base shard streaming is viewport-owned data loading" },
  { path: "components/map/useCommunityPrices.ts", fetchCount: 5, reason: "community price reads and writes have distinct authority and provisional-mark policy" },
  { path: "components/map/useCrawlJourneys.ts", fetchCount: 1, reason: "crawl journey reads are live route interaction" },
  { path: "components/map/usePintDrops.ts", fetchCount: 3, reason: "map Pint Drop reads and writes use the map feed lane" },
  { path: "components/tools/PubComparisonForm.tsx", fetchCount: 3, reason: "pub search has its own debounce lifecycle. Catalogue and comparison requests are private no-store reads. pubComparisonForm.test.tsx executes cancellation and replacement of obsolete responses" },
  { path: "components/tonight/AddRegularNight.tsx", fetchCount: 1, reason: "the regular-night form's pub search is a debounced typeahead read per keystroke, never a painted reload surface" },
  { path: "components/tonight/useTonightAnswerReads.ts", fetchCount: 1, reason: "one selected venue detail validates its venue ID and priceDatasetDigest before publishing. Its AbortSignal retires the read on winner or snapshot changes. The shared cache alone cannot establish that selected published snapshot. Other hook reads retain their existing transports. Executed by this file and tonightAnswerEvidence.test.tsx" },
  { path: "components/map/inspector/VenueKitchenReport.tsx", fetchCount: 1, reason: "a kitchen report is a drinker's word that goes quiet after 90 minutes and is confirmed or replaced by the next tap, so a held snapshot could print a word after it has gone quiet; the drinker regular-night read beside Tonight now rides authedFetch so the reader's own rows are marked" },
  { path: "components/map/useVenueJourney.ts", fetchCount: 1, reason: "venue journey is location and route interaction" },
  { path: "components/map/useVenueOccupancy.ts", fetchCount: 2, reason: "occupancy now-read is fail-soft and must never cache as an empty pub; flag fallback uses bare fetch when auth is absent, and the report beside it is a write" },
  { path: "components/out/useOutListings.ts", fetchCount: 1, reason: "an answer is held with the day it is about, so a pressed day chip repaints pending rather than another day's cached answer" },
  { path: "components/messages/MessageVenuePicker.tsx", fetchCount: 1, reason: "message composer typeahead must not cache partial queries" },
  { path: "components/messages/useMessageRecipientSearch.ts", fetchCount: 1, reason: "public profile typeahead is no-store, aborts on query or account changes, and never reuses recipients as a cached reload surface" },
  { path: "components/night/NightCalmLine.tsx", fetchCount: 1, reason: "night calm is an optional live signal" },
  { path: "components/night/NightModeCard.tsx", fetchCount: 6, reason: "night venue data and actions are no-store interactive flows; the plan state itself is the shared read in components/plan/usePlanMemberRead.ts" },
  { path: "components/operators/VenueFromThePub.tsx", fetchCount: 1, reason: "a pub's published word comes down the moment a moderator declines it, so a held snapshot could keep printing it after it was withdrawn; the read waits for the sheet's last phase and never paints an empty block" },
  { path: "components/night/NightWaysThere.tsx", fetchCount: 1, reason: "ways to get there asks TfL for one leg only when the reader opens it, for times and fares that change by the minute, so it is no-store and never a painted reload surface" },
  { path: "components/pal/PalYear.tsx", fetchCount: 2, reason: "the year card reads the signed-in person's own mapped-price count once and at most two pub names for its lines; a name or count that does not arrive is left out, never painted as a cached zero" },
  { path: "components/pal/originalPalMeshRenderer.mjs", fetchCount: 1, reason: "the renderer reads a static GLB asset without credentials and aborts it when its canvas retires, rather than caching reloadable surface data" },
  { path: "components/pintdrop/CommentThread.tsx", fetchCount: 1, reason: "comments are Social interaction reads and mutations" },
  { path: "components/plan/FairMeetingOrigins.tsx", fetchCount: 1, reason: "the fair meeting comparison reads each candidate pub's public venue record only after an explicit opt-in, no-store, aborted on opt-out, a changed stop list, a new plan or member and unmount, and never sends the private starting areas. __tests__/fairMeetingCoarseOrigins.test.tsx renders that lifecycle at the fetch boundary" },
  { path: "components/plan/MatchGroupPrefs.tsx", fetchCount: 3, reason: "shared plan collaboration state is no-store" },
  { path: "components/plan/MobilePlanActivation.tsx", fetchCount: 2, reason: "plan activation is a user action and generation request" },
  { path: "components/plan/NightCrawlMode.tsx", fetchCount: 1, reason: "plan mode state is no-store and mutation-sensitive" },
  { path: "components/plan/PlanNightPresentation.tsx", fetchCount: 1, reason: "member-capability settings and host mutations use no-store, an eight-second body deadline and scope/version guards; shared snapshots could restore revoked host controls. Executed by planNightPresentation.test.tsx" },
  { path: "components/plan/PlanTableBeacon.tsx", fetchCount: 2, reason: "private expiring table notes must leave on membership, route or arrival changes; reads and mutations retain no-store, body deadlines, abort and generation guards. Executed by planTableBeacon.test.tsx" },
  { path: "components/plan/PlanCollaborationPanel.tsx", fetchCount: 7, reason: "plan collaboration reads and actions are no-store" },
  { path: "components/plan/PlanComposer.tsx", fetchCount: 4, reason: "plan creation and metadata are interactive mutations" },
  { path: "components/plan/PlanCrew.tsx", fetchCount: 3, reason: "plan crew reads and actions are no-store; the member projection is the shared read in components/plan/usePlanMemberRead.ts" },
  { path: "components/plan/usePlanMemberRead.ts", fetchCount: 1, reason: "the capability-gated plan projection is ONE no-store read per Plan, shared by the route, the crew and the Night Mode card" },
  { path: "components/plan/PlanHostInviteLink.tsx", fetchCount: 1, reason: "the invite-link rotation is a mutation; the token itself is read by lib/planInviteTokenClient.ts" },
  { path: "components/plan/PlanInviteRsvp.tsx", fetchCount: 3, reason: "invite RSVP reads and actions are mutation-sensitive" },
  { path: "components/plan/PlanRoundForecast.tsx", fetchCount: 1, reason: "saving a member's usual drink is a mutation; the stop venue details it paints are read through surfaceDataCache" },
  { path: "components/plan/PlanRoute.tsx", fetchCount: 2, reason: "plan route and Tonight listings have no-store route semantics" },
  { path: "components/plan/PlanRouteMiniMap.tsx", fetchCount: 2, reason: "plan map detail is interactive venue data" },
  { path: "components/plan/PlanSummary.tsx", fetchCount: 3, reason: "plan summary actions are no-store and the third re-reads the stored route after a stale save; the member projection is the shared read in components/plan/usePlanMemberRead.ts" },
  { path: "components/plan/PlanVibe.tsx", fetchCount: 3, reason: "plan votes are live and mutation-sensitive" },
  { path: "components/plan/RecapDetail.tsx", fetchCount: 1, reason: "recap detail is a private mutable surface" },
  { path: "components/profile/OutTonightBoard.tsx", fetchCount: 1, reason: "presence is live and account-scoped" },
  { path: "components/pubpal/usePalVoiceAvailability.ts", fetchCount: 1, reason: "voice availability is a per-deployment configuration probe, not a painted surface read" },
  { path: "components/profile/OutTonightCrewLine.tsx", fetchCount: 1, reason: "presence is live and account-scoped" },
  { path: "components/profile/OutTonightToggle.tsx", fetchCount: 1, reason: "presence read and toggle are live account actions" },
  { path: "components/ratings/ratingsClient.ts", fetchCount: 1, reason: "rating client is an additive detail read" },
  { path: "components/social/CreatorListsLane.tsx", fetchCount: 1, reason: "Social creator-list discovery is no-store" },
  { path: "components/social/CrewsPanel.tsx", fetchCount: 1, reason: "retiring the unused plan after a refused crew is a no-store PATCH that must carry no account Authorization header" },
  { path: "components/social/FindYourLot.tsx", fetchCount: 1, reason: "Social discovery is no-store" },
  { path: "components/social/PublicCrewRouteClient.tsx", fetchCount: 1, reason: "public Open Crew preview is a no-store route with identity-scoped lifecycle guards" },
  { path: "components/social/useAddRelation.ts", fetchCount: 1, reason: "which side of a follow the viewer stands on is viewer-scoped and decides what the add control says, so it is read fresh and never held" },
  { path: "components/visits/visitReportsClient.ts", fetchCount: 2, reason: "Visit Report reader and flag action have their own freshness and moderation lane" },
  { path: "components/map/inspector/VenueStoryTab.tsx", fetchCount: 1, reason: "venue story is an additive map detail read" },
  { path: "components/webmcp/WebMcpNightBoard.tsx", fetchCount: 4, reason: "Agent Night Board reads answer a person or agent action, not a mount: each carries the caller's AbortSignal, and the evidence read is tied to one route revision and cleared on a swap, so a cached answer would outlive the route it describes" },
  { path: "lib/analytics.ts", fetchCount: 2, reason: "analytics transport is fire-and-forget telemetry, never painted data" },
  { path: "lib/adminSessionClient.ts", fetchCount: 1, reason: "admin session transport must confirm the browser kept the secure session cookie" },
  { path: "lib/authedFetch.ts", fetchCount: 5, reason: "shared graceful and strict bearer transports serve auth-gated actions and public reads" },
  { path: "lib/venueAliasMap.ts", fetchCount: 1, reason: "the static venue-id alias artifacts are read once per page to resolve ids the browser stored itself, never a painted reload read" },
  { path: "lib/landingEvidenceRead.ts", fetchCount: 1, reason: "the landing's near-you answer reads one venue detail per printed price (the answer and the saving line's doorstep pub) after a location grant or tap, each with its own deadline; a per-tap evidence read, never a painted reload surface" },
  { path: "lib/mapEngineWarm.ts", fetchCount: 2, reason: "the map engine warm fills the HTTP cache with the MapLibre worker, basemap style and TileJSON the engine asks for itself, never painted data" },
  { path: "lib/pois.ts", fetchCount: 1, reason: "map POI pack is static viewport data with map-owned lifecycle" },
  { path: "lib/spoonsValueLane.ts", fetchCount: 1, reason: "the Spoons value map lane is fetched only when the lens is switched on, holds its own per-session cache, and never caches a read that failed so switching the lens off and on asks again" },
  { path: "lib/tflDisruption.ts", fetchCount: 1, reason: "transport provider client has its own live disruption contract" },
  { path: "lib/slimShards.ts", fetchCount: 3, reason: "static map shard loading is owned by the map data lifecycle" },
  { path: "lib/venuesSlim.ts", fetchCount: 2, reason: "static venue pack loading is owned by the map data lifecycle" },
  { path: "lib/reactionClient.ts", fetchCount: 1, reason: "Social reaction reads and writes are no-store interaction state" },
  { path: "lib/prefetchVenue.ts", fetchCount: 1, reason: "hover prefetch warms an interaction detail, not a painted reload read" },
  { path: "lib/ukBasePubs.ts", fetchCount: 2, reason: "UK base shard loading is viewport-owned static map data" },
  { path: "lib/useUkPlaceIndex.ts", fetchCount: 1, reason: "the ONE read the Places tab makes of the UK place index, the map's own base layer, asked for only once a surface's own answer ran out and never on a first paint; the map's own search and suggestion banner keep their separate lanes" },
  { path: "lib/webPush.ts", fetchCount: 1, reason: "push subscription transport is an account action" },
  { path: "lib/planInviteTokenClient.ts", fetchCount: 1, reason: "the live invite token is a capability-gated no-store read every share href follows, and a rotate must replace it in place" },
  { path: "lib/slidingDoorsClient.ts", fetchCount: 1, reason: "explicit route comparisons and proposal mutations retain per-payload idempotency and bounded body cancellation; they are not reload snapshots. Executed by slidingDoorsUI.test.tsx" },
  { path: "lib/planSessionCapability.ts", fetchCount: 1, reason: "plan capability exchange is an auth-gated session read" },
  { path: "lib/planMutationOutbox.ts", fetchCount: 1, reason: "offline plan outbox replays mutations" },
  { path: "lib/mapWarmup.ts", fetchCount: 1, reason: "map warmup prefetch is owned by map startup and never paints directly" },
  { path: "lib/planRouteTotalsClient.ts", fetchCount: 1, reason: "plan route totals are interactive route state" },
  { path: "lib/nativePush.ts", fetchCount: 1, reason: "native push subscription transport is an account action" },
  { path: "lib/nativeCamera.ts", fetchCount: 1, reason: "native camera bridge reads a local photo blob, not app data" },
  { path: "lib/lastRideClient.ts", fetchCount: 1, reason: "last-ride lookup is an optional transport interaction" },
  { path: "lib/publicJsonLoader.ts", fetchCount: 1, reason: "shared fetch behind the price history, price update and Pint Index league loaders, each an additive map detail/static lane, never a painted reload read" },
  { path: "lib/wetherspoonsDirectory.ts", fetchCount: 1, reason: "directory data is static optional map content" },
  { path: "lib/nearDeskVenues.ts", fetchCount: 1, reason: "desk pack loading is owned by the Desk mode data lifecycle" },
  { path: "lib/deviceAccountSwitch.ts", fetchCount: 1, reason: "account switching is auth transport and identity must never be cached" },
  { path: "lib/warmVenueDetail.ts", fetchCount: 1, reason: "venue detail prefetch warms interaction state" },
] as const satisfies readonly SurfaceReadExemption[];

const ROOT = join(__dirname, "..");

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

function resolveImport(fromFile: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(ROOT, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(fromFile), spec);
  else return null;
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

const IMPORT_SPEC =
  /(?:^|\n)\s*(?:import|export)[\s\S]{0,400}?from\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;

function browserReachableModules(): string[] {
  const all = [
    ...walk(join(ROOT, "components")),
    ...walk(join(ROOT, "app")),
    ...walk(join(ROOT, "lib")),
  ];
  const reachable = new Set(
    all.filter((file) => /^\s*["']use client["']/m.test(readFileSync(file, "utf8"))),
  );
  const queue = [...reachable];
  while (queue.length) {
    const file = queue.pop() as string;
    for (const match of readFileSync(file, "utf8").matchAll(IMPORT_SPEC)) {
      const spec = match[1] ?? match[2];
      if (!spec) continue;
      const target = resolveImport(file, spec);
      if (!target || reachable.has(target) || /\.server\.tsx?$/.test(target)) continue;
      reachable.add(target);
      queue.push(target);
    }
  }
  return [...reachable];
}

const PAINTED_READ_FILES = [
  "components/profile/YourContributionsCard.tsx",
  "components/profile/ContributionLanesCard.tsx",
  "components/profile/NextBadgeChips.tsx",
  "components/profile/ProfileCoverPhotosEditor.tsx",
  "components/borough/BoroughPintPriceCard.tsx",
  "components/borough/BoroughPassportSlice.tsx",
  "components/map/useWhatsOnTonight.ts",
  "components/map/useTonightOpportunities.ts",
  "components/map/usePersonaTonight.ts",
  "components/discovery/MusicTonightLane.tsx",
  "components/discovery/DealsTonightLane.tsx",
  "components/discovery/GardenTonightCard.tsx",
  "components/desktop/ConditionsChip.tsx",
  "components/map/VenueTonightChips.tsx",
  "app/tonight/TonightConditionsStrip.tsx",
  "app/tonight/useTonightGetHome.ts",
  "app/today/TodayTubeCard.tsx",
  "app/today/TodayGetThereStrip.tsx",
  "components/transport/DisruptionLine.tsx",
] as const;

describe("painted reads", () => {
  it("routes each core reload read through surfaceDataCache", () => {
    const offenders = PAINTED_READ_FILES.filter((relativePath) => {
      const source = readFileSync(join(ROOT, relativePath), "utf8");
      const withoutComments = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
      if (relativePath === "components/profile/ProfileCoverPhotosEditor.tsx") {
        return (
          !source.includes('from "@/lib/surfaceDataCache"') ||
          /\bfetch\s*\(\s*base\b/.test(withoutComments)
        );
      }
      return !source.includes('from "@/lib/surfaceDataCache"') ||
        /\bfetch\s*\(/.test(withoutComments);
    });

    expect(offenders).toEqual([]);
  });

  it("accounts for every remaining direct fetch in a browser module", () => {
    const declared = new Map<string, (typeof SURFACE_READ_EXEMPTIONS)[number]>(
      SURFACE_READ_EXEMPTIONS.map((entry) => [entry.path, entry]),
    );
    const reachable = browserReachableModules();
    const clientFiles = [
      ...walk(join(ROOT, "app")),
      ...walk(join(ROOT, "components")),
    ].filter((file) => /^\s*["']use client["']/m.test(readFileSync(file, "utf8")));
    const files = [...new Set([...reachable, ...clientFiles])];

    const direct: Array<{ path: string; count: number }> = [];
    for (const file of files) {
      if (file === join(ROOT, "components/plan/usePlanPriceAbsence.ts")) continue;
      if (file.includes("/api/") || /\.server\.tsx?$/.test(file)) continue;
      const source = readFileSync(file, "utf8");
      const withoutComments = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
      const count = withoutComments.match(/\bfetch\s*\(/g)?.length ?? 0;
      if (count > 0) direct.push({ path: file.slice(ROOT.length + 1), count });
    }

    const missing = direct.filter(({ path }) => !declared.has(path));
    const changed = direct.filter(({ path, count }) => declared.get(path)?.fetchCount !== count);
    const directPaths = new Set(direct.map(({ path }) => path));
    const orphaned = SURFACE_READ_EXEMPTIONS.filter((entry) => !directPaths.has(entry.path));
    const invalid = SURFACE_READ_EXEMPTIONS.filter(
      (entry) => !entry.reason.trim() || declared.get(entry.path) !== entry,
    );

    expect({ missing, changed, orphaned, invalid }).toEqual({
      missing: [],
      changed: [],
      orphaned: [],
      invalid: [],
    });
  });
});


describe("Tonight selected-detail exemption behaviour", () => {
  const digest = "abcdefghijklmnopqrstuv";
  const origin = { lat: 51.51, lng: -0.13 };
  let root: ReturnType<typeof createRoot>;
  let container: HTMLDivElement;
  let reply: (response: Response) => void;
  let reject: (error: Error) => void;
  let signal: AbortSignal | undefined;
  let detailRequests: string[];
  const cityRows = [{ venueId: "city", name: "City Arms", borough: "Soho", priceGbp: 5, chain: null,
    drinkLabel: "City lager", servingSize: "Pint", publisher: { label: "City menu", url: "https://city.example/menu" }, observedAt: "2026-07-04" }];

  function Probe({ area = false, located = true }: { area?: boolean; located?: boolean }) {
    const answers = useTonightAnswers({
      origin: located && !area ? origin : null,
      tonightNear: located && area ? { patchLabel: "Soho", near: origin } : null,
      listingRows: [], listingsStateKind: "refreshing", selectableVenueIds: new Set<string>(),
      cheapPints: cityRows, renderedAt: 1793707200000,
    });
    return createElement(TonightAnswerCards, { ...answers, onShareLocation: () => undefined });
  }

  async function render(props: Parameters<typeof Probe>[0] = {}) {
    await act(async () => root.render(createElement(Probe, props)));
    await vi.waitFor(async () => {
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
      expect(container.querySelector('[data-testid="tonight-answer-cheapest"]')?.textContent)
        .toContain(props.located === false ? "City Arms" : "Near Arms");
    });
  }

  function detail(overrides: Record<string, unknown> = {}): Response {
    return { ok: true, json: async () => ({ priceDatasetDigest: digest,
      venue: { id: "near", prices: [
        { price_gbp: 4.5, pint_name: "Selected lager", measure: "pint", pub_url: "https://selected.example/menu", scraped_at_values: "2026-07-03T12:00:00Z" },
        { price_gbp: 4.5, pint_name: "Other lager", measure: "pint", pub_url: "https://other.example/menu", scraped_at_values: "2026-07-04T12:00:00Z" },
      ] }, ...overrides,
    }) } as Response;
  }

  function expectUnavailable() {
    const card = container.querySelector('[data-testid="tonight-answer-cheapest"]');
    expect(card?.textContent).toContain("Near Arms");
    expect(card?.textContent).toContain("Drink unavailable");
    expect(card?.textContent).toContain("Serving unavailable");
    expect(card?.textContent).toContain("Publisher not recorded");
    expect(card?.textContent).toContain("Read date not recorded");
    expect(card?.textContent).not.toContain("Slim lager");
    expect(card?.textContent).not.toContain("Slim menu");
    expect(card?.querySelector("time")).toBeNull();
  }

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    clearSurfaceCache();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    detailRequests = [];
    signal = undefined;
    const held = new Promise<Response>((resolve, fail) => { reply = resolve; reject = fail; });
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input).split("?")[0];
      if (path?.startsWith("/api/venue/")) {
        detailRequests.push(path);
        signal = init?.signal ?? undefined;
        return held;
      }
      if (path === "/data/venues_slim.manifest.json") return { ok: true, json: async () => ({
        version: 2, priceDatasetDigest: digest,
        grid: { originLat: 0, originLon: 0, latStep: 1, lonStep: 1 },
        shards: [{ id: "core", core: true, url: "/data/venues_slim.core.json", count: 1, bbox: [-0.2, 51.45, 0, 51.55] }],
      }) } as Response;
      if (path === "/data/venues_slim.core.json") return { ok: true, json: async () => ({ d: digest, rows: [{
        id: "near", name: "Near Arms", lat: origin.lat, lng: origin.lng, borough: "Soho", cheapestPrice: 4.5,
        priceSource: "Slim menu", priceSourceUrl: "https://slim.example/menu", priceObservedAt: "2026-07-03",
        cheapestPint: "Slim lager", measure: "pint",
      }] }) } as Response;
      return { ok: true, json: async () => ({ rows: [] }) } as Response;
    }));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    clearSurfaceCache();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each([false, true])("withholds all nearby facts until matching detail succeeds, area=%s", async (area) => {
    await render({ area });
    expectUnavailable();
    expect(detailRequests).toEqual(["/api/venue/near"]);
    await act(async () => { reply(detail()); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    const card = container.querySelector('[data-testid="tonight-answer-cheapest"]');
    expect(card?.textContent).toContain("Selected lager");
    expect(card?.textContent).toContain("3 Jul 2026");
    expect(card?.querySelector('a[href="https://selected.example/menu"]')).not.toBeNull();
    expect(card?.textContent).not.toContain("Other lager");
  });

  it.each(["failed", "http", "snapshot", "venue", "missing"])("keeps facts unavailable after a %s detail read", async (failure) => {
    await render();
    await act(async () => {
      if (failure === "failed") reject(new Error("offline"));
      else if (failure === "http") reply({ ok: false } as Response);
      else if (failure === "snapshot") reply(detail({ priceDatasetDigest: "other" }));
      else if (failure === "venue") reply(detail({ venue: { id: "other", prices: [{ pint_name: "Wrong lager" }] } }));
      else reply(detail({ venue: { id: "near", prices: [] } }));
    });
    expectUnavailable();
  });

  it("cancels detail when the nearby winner disappears and preserves city evidence", async () => {
    await render();
    expect(signal?.aborted).toBe(false);
    await render({ located: false });
    expect(signal?.aborted).toBe(true);
    await act(async () => { reply(detail()); });
    expect(container.textContent).toContain("City lager");
    expect(container.textContent).toContain("4 Jul 2026");
    expect(container.textContent).not.toContain("Selected lager");
    expect(container.querySelector('a[href="https://city.example/menu"]')).not.toBeNull();
  });

  it("cancels the selected read on unmount", async () => {
    await render();
    expect(signal?.aborted).toBe(false);
    await act(async () => root.unmount());
    expect(signal?.aborted).toBe(true);
    await act(async () => { reply(detail()); });
    root = createRoot(container);
    expect(container.textContent).toBe("");
  });
});
