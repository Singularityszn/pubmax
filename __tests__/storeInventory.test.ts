import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import ts from "typescript";

// THE STORE INVENTORY (#727, section 1). One row per `lib/*Store*.ts` module,
// naming how it chooses between process-memory and Supabase and which class it
// belongs to. It is a TEST FIXTURE, never a runtime registry: nothing imports
// it, and the assertions below hold each module's SOURCE to its row.
//
// For seam-selected stores, keyless memory means an allowed development path.
// selectStore refuses unconfigured deployed production. Inline exceptions keep their own policy.
//
// The dual-backend seam is `lib/storeBackend.ts` (`selectStore`,
// `createDualBackendStore`, `admin`, `createFailSoftGuard`,
// `onMissingDurableWrite`, `missingTables`). A store may not redeclare what the
// seam already owns. A store that still branches on `isSupabaseConfigured()`
// by hand declares EVERY such call site here with a reason, and that count may
// only ever go DOWN: a new hand-rolled branch fails this test until its row
// says why it cannot ride the seam. Migrating a policy-heavy store is a
// slice of its own with a contract test, never a by-product of this fence.

type StoreClass =
  /** Memory and Supabase implementations of one interface, chosen at the seam, nothing else. */
  | "plain-dual-backend"
  /** Same seam, plus schema-miss fallback, production strictness, column ladders or authorization at the store boundary. */
  | "policy-heavy"
  /** The durable side is a cache or an overlay over a source that exists without it. */
  | "cache-backed"
  /** Backend chosen inline per operation. Named here so the exception is visible, not hidden. */
  | "legacy-exception"
  /** Holds no memory-versus-Supabase choice at all (durable-only RPC, or no Supabase in the module). */
  | "not-dual-backend";

type Selector =
  /** `selectStore(memory, supabase)` or `createDualBackendStore(memory, supabase)` from the seam. */
  | "selectStore"
  /** `isSupabaseConfigured()` ternaries or guards written by hand. */
  | "inline"
  /** No backend choice in the module. */
  | "none";

type StoreRow = {
  /** Exported interfaces or operations, named in the source file. */
  interface: readonly string[];
  /** The unconfigured backend and ordinary failure policy. */
  fallback: string;
  /** Current missing-table/column behaviour, including explicit exceptions. */
  schemaMissing: string;
  /** The caller or domain module that owns authorization, never the selector. */
  authorizationOwner: string;
  /** Exported resets; null means this module exports no reset helper. */
  resetHelper: readonly string[] | null;
  class: StoreClass;
  selector: Selector;
  /**
   * Exact number of `isSupabaseConfigured()` call sites the module keeps
   * besides the seam. Omitted means zero. Every non-zero count carries a reason.
   */
  inlineBranches?: number;
  /** Required for `inline`, `legacy-exception`, `not-dual-backend` and any non-zero `inlineBranches`. */
  reason?: string;
};

const STORE_INVENTORY: Record<string, StoreRow> = {
  "lib/adultSelfAssertionStore.ts": {
    interface: ["AdultSelfAssertionStore"],
    fallback: "Keyless memory; durable read errors propagate.",
    schemaMissing:
      "Missing reads use memory; missing writes refuse memory in production.",
    authorizationOwner:
      "Caller verifies account via identity routes; socialLaunch owns adult eligibility.",
    resetHelper: ["__resetMemoryAdultSelfAssertions"],
    class: "policy-heavy",
    selector: "selectStore",
  },
  "lib/analyticsReceiptStore.ts": {
    interface: ["AnalyticsReceiptStore"],
    fallback: "Keyless memory receipts; durable claim errors return error.",
    schemaMissing: "RPC/schema failure returns error, never a claimed receipt.",
    authorizationOwner:
      "api/events and verifiedAnalytics.server validate signed delivery subjects.",
    resetHelper: ["__resetMemoryAnalyticsReceipts"],
    class: "plain-dual-backend",
    selector: "selectStore",
  },
  "lib/areaDemandStore.ts": {
    interface: ["AreaDemandStore"],
    fallback:
      "Keyless memory counts; failed writes carry failed=true and failed reads return zero.",
    schemaMissing:
      "Writes refuse production memory with failed=true; counts may read memory.",
    authorizationOwner:
      "The demand route supplies the rate-limited observation; no account entitlement at this store.",
    resetHelper: ["__resetAreaDemand"],
    class: "policy-heavy",
    selector: "selectStore",
  },
  "lib/checkInStore.ts": {
    interface: ["CheckInStore"],
    fallback: "Keyless memory; durable errors throw.",
    schemaMissing: "No schema fallback; durable errors propagate.",
    authorizationOwner:
      "Check-in routes verify actors; store operations receive and filter handles.",
    resetHelper: ["__resetMemoryCheckIns"],
    class: "plain-dual-backend",
    selector: "selectStore",
  },
  "lib/cityEnrichmentCheckpointStore.server.ts": {
    interface: ["CityEnrichmentCheckpointStore"],
    fallback:
      "Keyless memory checkpoints; failed reads report durable=false and failed operations name unavailability.",
    schemaMissing:
      "Missing checkpoint storage uses memory, reporting its durability in results.",
    authorizationOwner:
      "Cron/admin callers own credentials; checkpoint owner and lease guard concurrent writes.",
    resetHelper: ["resetCityEnrichmentCheckpointMemory"],

    class: "policy-heavy",
    selector: "selectStore",
    inlineBranches: 1,
    reason:
      "cityEnrichmentCheckpointIsDurable() tells the cron whether a checkpoint exists at all.",
  },
  "lib/commentsStore.ts": {
    interface: ["CommentsStore"],
    fallback:
      "Keyless memory; failed public/review reads return empty lists; writes throw.",
    schemaMissing:
      "No separate schema fallback; ordinary failure policy applies.",
    authorizationOwner:
      "Comment routes derive actors and gate moderator writes; store validates content and actor hashes.",
    resetHelper: ["__resetMemoryComments"],
    class: "plain-dual-backend",
    selector: "selectStore",
  },
  "lib/communityPriceStore.ts": {
    interface: ["CommunityPriceStore"],
    fallback:
      "Keyless memory; communityPriceStore and observations each select a backend. Public reads expose degradation; price and venue-signal writes can return failed=true.",
    schemaMissing:
      "Missing price and signal writes refuse production memory. Public reads return degraded memory data. Legacy report/moderate use memory; moderateWithState reports unavailable.",
    authorizationOwner:
      "Contribution identity and admin routes own actors; store owns corroboration, reporting and source policy.",
    resetHelper: [
      "resetCommunityPriceCategoryIndexMemo",
      "__resetCommunityPrices",
    ],
    class: "policy-heavy",
    selector: "selectStore",
  },
  "lib/contributorLeaderboardStore.ts": {
    interface: ["readContributorLeaderboard", "readContributorLaneStats"],
    fallback:
      "Keyless demo aggregate; durable errors return the explicit unavailable result.",
    schemaMissing:
      "No memory store migration fallback; configured read failure stays unavailable.",
    authorizationOwner:
      "Public aggregate reader; contributorLeaderboard owns admissible contribution policy.",
    resetHelper: null,

    class: "legacy-exception",
    selector: "inline",
    inlineBranches: 1,
    reason:
      "Read seam with no memory implementation of the all-time aggregate; keyless answers the demo tally.",
  },
  "lib/crawlStoryStore.ts": {
    interface: [
      "cleanVisibility",
      "slugify",
      "createCrawlStory",
      "getCrawlStoryBySlug",
      "getStoryAuthor",
      "listAuthoredCrawlPage",
      "listOwnUnlistedCrawlPage",
      "isAuthor",
      "deleteCrawlStory",
      "updateCrawlStory",
    ],
    fallback:
      "Keyless story maps; durable operations preserve their null/false/empty failure shapes.",
    schemaMissing:
      "No shared schema fallback; each exported operation owns its durable error result.",
    authorizationOwner:
      "Story operations check author handles; calling routes establish the verified actor.",
    resetHelper: ["__resetCrawlStories"],

    class: "legacy-exception",
    selector: "inline",
    inlineBranches: 6,
    reason:
      "Per-operation branching over two tables with fail-soft reads; no single interface to select.",
  },
  "lib/feedFreshnessStore.ts": {
    interface: ["FeedFreshnessStore"],
    fallback:
      "Keyless memory stamps; durable reads return null on failure; writes return stamped with failed=true.",
    schemaMissing:
      "Reads may use memory; writes use memory outside production and return failed=true in production.",
    authorizationOwner:
      "Cron callers own refresh authority; stamps carry feed metadata, not user authority.",
    resetHelper: ["__resetFeedFreshnessStore"],
    class: "policy-heavy",
    selector: "selectStore",
  },
  "lib/followStore.ts": {
    interface: ["FollowStore"],
    fallback: "Keyless memory graph; durable errors propagate.",
    schemaMissing: "No schema fallback; durable errors propagate.",
    authorizationOwner:
      "Follow routes bind the actor through resolveMessageHandle and gateHandleAction; store refuses self-follow.",
    resetHelper: ["__resetMemoryFollows"],
    class: "plain-dual-backend",
    selector: "selectStore",
  },
  "lib/freshnessStoreOverlay.ts": {
    interface: ["resolveStoreObservedAt", "resolveDurableFeedStoreReads"],
    fallback:
      "No backend factory; unconfigured, unreachable, empty and ok are distinct read outcomes.",
    schemaMissing:
      "Missing durable feed schema is unreachable with migration guidance, never fresh.",
    authorizationOwner:
      "Read-only freshness aggregation; feed writers own authority.",
    resetHelper: null,

    class: "cache-backed",
    selector: "inline",
    inlineBranches: 3,
    reason:
      "One per store-stamped feed (feed_freshness, What's-On listings, weather snapshots): each answers an explicit `unconfigured` kind so the freshness spine can name the absence rather than read an unmeasured feed as fresh.",
  },
  "lib/harvestOverlayStore.ts": {
    interface: ["HarvestOverlayStore"],
    fallback:
      "Keyless memory overlay unless requireDurable refuses it; durable failures report failure/degradation.",
    schemaMissing:
      "Missing storage returns the explicit failed/degraded result; non-dry folds require durability.",
    authorizationOwner:
      "Harvest fold CLI and source policy own writes; store enforces requireDurable.",
    resetHelper: ["__resetHarvestOverlayStore"],

    class: "policy-heavy",
    selector: "selectStore",
    inlineBranches: 1,
    reason:
      "`requireDurable` refuses a non-dry harvest fold with no Supabase rather than folding into memory.",
  },
  "lib/identityHandleStore.ts": {
    interface: ["IdentityHandleStore"],
    fallback:
      "Keyless alias and owner maps also use profileStore. Returned claim/rename RPC errors report storage refusal; rejected calls can throw.",
    schemaMissing: "No schema-to-memory fallback in the durable identity path.",
    authorizationOwner:
      "Identity routes supply verified account IDs. Store and RPCs enforce reservations, claims, aliases and rename cooldowns.",
    resetHelper: ["__resetMemoryIdentityHandles"],
    class: "policy-heavy",
    selector: "selectStore",
  },
  "lib/importNotesStore.ts": {
    interface: [
      "validateImportNote",
      "enqueueImportNote",
      "listImportNotes",
      "dismissImportNote",
      "restoreImportNote",
    ],
    fallback:
      "JSON file with memory fallback when the filesystem is unavailable.",
    schemaMissing: "Not applicable: no Supabase schema in this module.",
    authorizationOwner:
      "Moderator callers own note review; validateImportNote owns accepted input.",
    resetHelper: ["resetImportNotesForTests", "unloadImportNotesForTests"],

    class: "not-dual-backend",
    selector: "none",
    reason:
      "JSON file under .data/ with an in-memory fallback; no Supabase in the module.",
  },
  "lib/messagesStore.ts": {
    interface: ["MessagesStore"],
    fallback:
      "Keyless message maps; durable inbox failures degrade, and failed thread reads return empty. Memory-format conversation IDs route directly to memory.",
    schemaMissing:
      "Missing message tables can use memory, including production writes. Missing client_message_id retries the durable insert without its idempotency key.",
    authorizationOwner:
      "messageAuth binds the viewer; store checks conversation membership and sender participation.",
    resetHelper: ["__resetMemoryMessages"],
    class: "policy-heavy",
    selector: "selectStore",
  },
  "lib/nightMemoryStore.ts": {
    interface: [
      "createNightMemory",
      "createNightMemoryFromPlanRecap",
      "listNightMemories",
      "addNightMoment",
      "listNightMoments",
      "removeNightMoment",
      "removeNightMemory",
      "createNightStory",
      "listNightStoryInbox",
      "markContributorsDepartedByProfileId",
      "getNightStory",
      "getPublishedRecapSource",
      "safeNightStory",
      "getNightStoryWorkspaceResult",
      "getNightStoryWorkspace",
      "updateNightStoryDraftResult",
      "upsertStoryContributor",
      "acceptStoryContributionResult",
      "acceptStoryContribution",
      "declineStoryContributionResult",
      "addStoryMoment",
      "setMomentPublicationConsent",
      "proposeNightStoryPublication",
      "confirmNightStoryPublication",
      "findPublishAltTextGap",
      "setMomentAltText",
    ],
    fallback:
      "Keyless maps; per-operation durable null/refusal/result shapes; only removal selectors share the seam.",
    schemaMissing:
      "Legacy branches retain their own error results; no uniform missing-schema fallback.",
    authorizationOwner:
      "Night memory/story operations check host, contributor and publication consent; routes bind account identity.",
    resetHelper: ["__resetNightMemoryStore"],

    class: "legacy-exception",
    selector: "selectStore",
    inlineBranches: 24,
    reason:
      "Every legacy operation branches inline over several tables and maps; the largest hand-rolled exception. The removal pair (D06) rides selectStore, so the 24 may only shrink from here.",
  },
  "lib/nightProfileStore.ts": {
    interface: ["NightProfileStore"],
    fallback:
      "Keyless memory profiles; durable errors throw and concurrent updates return conflict.",
    schemaMissing: "No schema fallback; durable failures propagate.",
    authorizationOwner:
      "Night-profile route derives the owner ID; store filters all profile operations by owner.",
    resetHelper: ["__resetNightProfileStore"],
    class: "plain-dual-backend",
    selector: "selectStore",
  },
  "lib/nightSignalStore.server.ts": {
    interface: ["NightSignalCandidateStore", "NightSignalCheckpointStore"],
    fallback:
      "Keyless candidate/checkpoint maps; failed operations expose unavailable/null results.",
    schemaMissing:
      "Missing reads/checkpoints can use memory; candidate writes/reviews refuse production memory with unavailable.",
    authorizationOwner:
      "Cron and isModerator callers authorize sweeps/reviews; store guards review state and leases.",
    resetHelper: ["resetNightSignalStoreMemory"],

    class: "policy-heavy",
    selector: "selectStore",
    inlineBranches: 1,
    reason:
      "nightSignalStoreIsDurable() tells the sweep whether a candidate outlives one invocation.",
  },
  "lib/notificationsStore.ts": {
    interface: ["NotificationsStore"],
    fallback:
      "Keyless inboxes; durable emit failures do not fail parent writes, and inbox reads fail empty.",
    schemaMissing:
      "No distinct schema fallback; existing best-effort operation policy applies.",
    authorizationOwner:
      "Notification routes bind the inbox owner; notification producers choose recipients.",
    resetHelper: ["__resetMemoryNotifications"],

    class: "policy-heavy",
    selector: "selectStore",
    inlineBranches: 2,
    reason:
      "Two pint-drop lookups read the durable table only when configured, beside the selected store.",
  },
  "lib/occupancyStore.ts": {
    interface: ["OccupancyStore"],
    fallback:
      "Keyless memory reports; durable read failures are degraded; failed writes throw.",
    schemaMissing:
      "Missing table reads degrade in production and use memory elsewhere; writes refuse production fallback. Missing moderation columns retry base columns.",
    authorizationOwner:
      "Visit/moderation callers bind verified actors; store validates reporter IDs, retakes, reports and hidden rows.",
    resetHelper: ["__resetMemoryOccupancyReports"],
    class: "policy-heavy",
    selector: "selectStore",
  },
  "lib/operatorProposalsStore.ts": {
    interface: ["OperatorProposalStore"],
    fallback:
      "Keyless memory proposals; durable reads return empty/null on failure; hard write errors throw.",
    schemaMissing:
      "Legacy missing-schema handlers use memory for reads and writes.",
    authorizationOwner:
      "Operator proposal routes bind account ownership and moderator review; store owns proposal transitions.",
    resetHelper: ["__resetOperatorProposals"],
    class: "policy-heavy",
    selector: "selectStore",
  },
  "lib/pendingPlanRecapStore.ts": {
    interface: ["PendingPlanRecapStore"],
    fallback:
      "Keyless private recap map; durable operation failures propagate.",
    schemaMissing:
      "schemaMissFallback refuses memory in production for reads and writes; memory elsewhere.",
    authorizationOwner:
      "Pending-recap routes bind owner IDs; store filters completion rows by owner.",
    resetHelper: ["__resetPendingPlanRecapStore"],
    class: "policy-heavy",
    selector: "selectStore",
  },
  "lib/pintDropsStore.ts": {
    interface: ["PintDropStore"],
    fallback:
      "Keyless memory delegates to pintDrops. Durable database errors normally throw; optional columns have explicit retries.",
    schemaMissing:
      "Durable retries can omit receipt or visibility columns. Missing measure columns refuse non-pints. No generic table-to-memory fallback.",
    authorizationOwner:
      "Pint Drop routes derive and gate the actor; priced drops require verified contribution identity. Admin routes gate moderation.",
    resetHelper: null,
    class: "policy-heavy",
    selector: "selectStore",
  },
  "lib/planCollaborationStore.ts": {
    interface: ["PlanCollaborationStore"],
    fallback:
      "Keyless shared memory state; safe store wrappers retain operation-specific result shapes.",
    schemaMissing:
      "Missing schema returns ok=false with error=error through the safe wrapper; no memory fallback.",
    authorizationOwner:
      "Plan collaboration methods enforce participant/capability roles; routes authenticate the supplied actor.",
    resetHelper: ["__resetPlanCollaboration"],
    class: "policy-heavy",
    selector: "selectStore",
  },
  "lib/planGroupPrefsStore.ts": {
    interface: ["PlanGroupPrefsStore"],
    fallback:
      "Keyless shared memory preferences; configured failures return ok=false with error=error.",
    schemaMissing:
      "No common schema fallback; durable operation errors remain explicit.",
    authorizationOwner:
      "Plan preference callers establish plan capability; store filters by plan ID.",
    resetHelper: ["__resetPlanGroupPrefs"],
    class: "plain-dual-backend",
    selector: "selectStore",
  },
  "lib/planInviteRsvpStore.ts": {
    interface: ["PlanInviteRsvpStore", "PlanInviteReactionStore"],
    fallback:
      "Keyless shared RSVP/reaction maps; durable failures retain each operation contract.",
    schemaMissing:
      "No factory-owned schema fallback; RSVP and reaction operations own durable errors.",
    authorizationOwner:
      "Invite routes validate capabilities and membership; store binds rows to plan/member keys.",
    resetHelper: ["__resetMemoryRsvps", "__resetMemoryReactions"],
    class: "plain-dual-backend",
    selector: "selectStore",
  },
  "lib/planStore.ts": {
    interface: ["PlanStore"],
    fallback:
      "Keyless plan map; durable reads and writes preserve per-operation null/refusal/error results.",
    schemaMissing:
      "Missing context-create RPC retries the old atomic RPC without NightContext. Account join errors fail closed; inline helper memory paths bypass the getter guard.",
    authorizationOwner:
      "Plan routes establish capabilities; planStore and planCrewIdentity enforce host/member ownership.",
    resetHelper: ["__resetMemoryPlans"],

    class: "legacy-exception",
    selector: "selectStore",
    inlineBranches: 13,
    reason:
      "Capability, invite and idempotency lanes branch per operation; the store getter alone rides the seam.",
  },
  "lib/presenceStore.ts": {
    interface: ["PresenceStore"],
    fallback:
      "Keyless memory presence, with ambient demo rows only when unconfigured.",
    schemaMissing:
      "No common schema fallback; durable operation errors remain explicit.",
    authorizationOwner:
      "Presence routes derive the actor; store filters handles and expiry windows.",
    resetHelper: ["__resetPresence"],

    class: "policy-heavy",
    selector: "selectStore",
    inlineBranches: 1,
    reason:
      "Ambient demo presence is blended in only where no durable store answers.",
  },
  "lib/priceTrustEventStore.ts": {
    interface: ["PriceTrustEventStore"],
    fallback:
      "Keyless event/credit maps; durable failures follow each event or credit operation result.",
    schemaMissing:
      "Missing reads may use memory; missing writes use onMissingDurableWrite and refuse production memory.",
    authorizationOwner:
      "Verified contribution writers own authority keys; store owns event reversal and credit uniqueness.",
    resetHelper: ["__resetMemoryPriceTrustEvents"],
    class: "policy-heavy",
    selector: "selectStore",
  },
  "lib/privateIdentityStore.ts": {
    interface: ["privateIdentityStore"],
    fallback:
      "Keyless private identity rows; durable failures preserve explicit operation errors.",
    schemaMissing:
      "No schema-to-memory fallback; create/update constraints remain durable.",
    authorizationOwner:
      "Identity routes derive the account ID; store reads and writes only that owner key.",
    resetHelper: ["__resetMemoryPrivateIdentities"],
    class: "plain-dual-backend",
    selector: "selectStore",
  },
  "lib/profileCoverPhotoStore.ts": {
    interface: ["ProfileCoverPhotoStore"],
    fallback: "Keyless cover rows; durable operations throw on failure.",
    schemaMissing:
      "No table fallback; the moderation RPC has an explicit unconfigured null result.",
    authorizationOwner:
      "Profile image routes prove ownership; store owns cover positions and moderation state preservation.",
    resetHelper: ["__resetProfileCoverPhotos"],

    class: "policy-heavy",
    selector: "selectStore",
    inlineBranches: 1,
    reason:
      "The cross-store moderation RPC has no memory equivalent and answers null without Supabase.",
  },
  "lib/profileStore.ts": {
    interface: ["ProfileStore"],
    fallback:
      "Keyless profile rows; durable operations keep explicit read/write errors.",
    schemaMissing:
      "A missing report-actor RPC uses durable read-modify-write with a concurrency warning. No general additive-field or table-to-memory fallback.",
    authorizationOwner:
      "Profile routes verify ownership before image writes; profileStore owns claim guards and preserves hidden-image moderation.",
    resetHelper: ["__resetMemoryProfiles"],
    class: "policy-heavy",
    selector: "selectStore",
  },
  "lib/pubPalStore.ts": {
    interface: [
      "getPubPalResult",
      "getPubPal",
      "createPubPalResult",
      "createPubPal",
      "updatePubPalResult",
      "deletePubPalResult",
      "listPalMemoriesResult",
      "confirmPalMemoryResult",
      "updatePalMemoryResult",
      "deletePalMemoryResult",
      "addMasteryEvent",
    ],
    fallback:
      "Keyless Pal/memory maps; durable operations expose typed unavailable/error results.",
    schemaMissing:
      "Legacy inline branches own storage errors; no generic memory fallback after a configured failure.",
    authorizationOwner:
      "Pub Pal routes derive owner IDs; operations restrict Pal memories to their owner.",
    resetHelper: ["__resetPubPalStore"],

    class: "legacy-exception",
    selector: "inline",
    inlineBranches: 8,
    reason:
      "Result-typed operations branch inline over two maps; no interface pair to select.",
  },
  "lib/pushTokenStore.ts": {
    interface: ["PushTokenStore"],
    fallback: "Keyless token map; durable errors propagate.",
    schemaMissing: "No schema fallback; durable errors propagate.",
    authorizationOwner:
      "Push registration routes bind subscriptions; sending credentials and consent belong to push callers.",
    resetHelper: ["__resetMemoryPushTokens"],
    class: "plain-dual-backend",
    selector: "selectStore",
  },
  "lib/ratingsStore.ts": {
    interface: ["RatingsStore"],
    fallback:
      "Keyless rating map; durable errors propagate except the schema-specific path.",
    schemaMissing:
      "Legacy missing-ratings-schema handlers use memory for reads and writes.",
    authorizationOwner:
      "Rating callers derive actor hashes; store owns per-actor ratings and summary projection.",
    resetHelper: ["__resetMemoryRatings"],
    class: "policy-heavy",
    selector: "selectStore",
  },
  "lib/reactionsStore.ts": {
    interface: ["ReactionsStore"],
    fallback:
      "Keyless reactions; durable errors propagate and missing referenced drops get a named refusal.",
    schemaMissing:
      "No schema fallback; foreign-key refusal is distinct from a missing schema.",
    authorizationOwner:
      "Reaction routes bind actor hashes; store owns unique actor/drop reactions.",
    resetHelper: ["__resetMemoryReactions"],
    class: "plain-dual-backend",
    selector: "selectStore",
  },
  "lib/referralStore.ts": {
    interface: ["ReferralStore"],
    fallback:
      "Keyless referral/credit maps; durable operations retain their contract result shapes.",
    schemaMissing:
      "Missing writes use onMissingDurableWrite; missing read paths retain their own fallback policy.",
    authorizationOwner:
      "Referral routes derive identity; store owns qualification, uniqueness and milestone proof.",
    resetHelper: ["__resetMemoryReferrals"],
    class: "policy-heavy",
    selector: "selectStore",
  },
  "lib/roundsStore.ts": {
    interface: ["RoundsStore"],
    fallback:
      "Keyless Round state; durable failures return null or typed error results.",
    schemaMissing:
      "No shared schema fallback; each Round operation preserves its failure result.",
    authorizationOwner:
      "Round operations enforce owner/member/promotion actors; routes bind the verified actor.",
    resetHelper: ["__resetMemoryRounds"],
    class: "plain-dual-backend",
    selector: "selectStore",
  },
  "lib/savedPubsStore.ts": {
    interface: ["SavedPubsStore", "SavedListsStore", "SavedListFollowsStore"],
    fallback:
      "Keyless saved pubs, lists and list-follow maps; durable operations preserve their declared failure results.",
    schemaMissing:
      "No shared schema fallback; ensure/save/list/follow methods retain their own error contracts.",
    authorizationOwner:
      "Saved-pub routes derive handles; store scopes saved rows and lists to their owner.",
    resetHelper: [
      "__resetMemorySavedPubs",
      "__resetMemorySavedLists",
      "__resetMemorySavedListFollows",
    ],
    class: "plain-dual-backend",
    selector: "selectStore",
  },
  "lib/socialConnectionStore.ts": {
    interface: ["SocialConnectionStore"],
    fallback: "Keyless connection map; durable errors propagate.",
    schemaMissing: "No schema fallback; durable errors propagate.",
    authorizationOwner:
      "Social OAuth/manual connection routes bind owner IDs; store filters connections by owner.",
    resetHelper: ["__resetMemorySocialConnections"],
    class: "plain-dual-backend",
    selector: "selectStore",
  },
  "lib/socialCrewStore.ts": {
    interface: ["SocialCrewStore"],
    fallback:
      "Supabase RPC store only; unavailable is explicit and dependencies are injectable.",
    schemaMissing:
      "No memory fallback; RPC errors become SocialCrewStoreError/unavailable outcomes.",
    authorizationOwner:
      "socialCrewActor callers and crew RPCs enforce host/member/visibility rules.",
    resetHelper: null,

    class: "not-dual-backend",
    selector: "none",
    reason:
      "RPC-only durable store with injectable dependencies; no memory implementation.",
  },
  "lib/socialInteractionStore.ts": {
    interface: ["SocialInteractionStore"],
    fallback: "Keyless interaction store; ordinary durable errors propagate.",
    schemaMissing:
      "Missing-schema reads may use memory; writes pass onMissingDurableWrite and refuse production fallback.",
    authorizationOwner:
      "Verified Social actors, relationship checks and RPCs enforce visibility, blocks, moderation and staff roles.",
    resetHelper: null,
    class: "policy-heavy",
    selector: "selectStore",
  },
  "lib/socialPostConsentStore.ts": {
    interface: ["SocialPostConsentStore"],
    fallback:
      "Supabase RPC store only; typed SocialPostConsentStoreError failures.",
    schemaMissing:
      "No memory fallback; schema/RPC failures remain typed errors.",
    authorizationOwner:
      "Consent RPCs and caller-derived profile IDs enforce contributor, owner and moderator actions.",
    resetHelper: null,

    class: "not-dual-backend",
    selector: "none",
    reason: "RPC-only durable store; no memory implementation.",
  },
  "lib/socialPostStore.ts": {
    interface: ["SocialPostStore"],
    fallback:
      "The getter returns Supabase directly when requiresSupabaseStore is true, otherwise uses selectStore. Ordinary and domain errors propagate.",
    schemaMissing:
      "Missing social_posts or moderation-job tables permit memory reads only when requiresSupabaseStore is false. Writes also pass onMissingDurableWrite.",
    authorizationOwner:
      "Verified Social actors and social post policy/RPCs own visibility, edits, consent and moderation.",
    resetHelper: null,
    class: "policy-heavy",
    selector: "selectStore",
  },
  "lib/stepOutNudgeStore.ts": {
    interface: ["StepOutNudgeStore"],
    fallback:
      "Keyless preference/send-stamp maps; durable failures follow the operation contract.",
    schemaMissing:
      "Missing reads use memory; writes refuse production memory through onMissingDurableWrite.",
    authorizationOwner:
      "Preference routes bind owners; cron owns sending, and opt-in/send stamps constrain selection.",
    resetHelper: ["__resetStepOutNudgeStore"],
    class: "policy-heavy",
    selector: "selectStore",
  },
  "lib/venueOperatorsStore.ts": {
    interface: ["VenueOperatorStore"],
    fallback:
      "Keyless operator claims; failed reads return null/false/empty and write errors throw.",
    schemaMissing:
      "Missing reads use memory; claim/state writes refuse production memory.",
    authorizationOwner:
      "Account-derived claim routes and moderator review own authorization; store owns verified operator state.",
    resetHelper: ["__resetVenueOperators"],
    class: "policy-heavy",
    selector: "selectStore",
  },
  "lib/venuePhotoStore.ts": {
    interface: ["VenuePhotoStore"],
    fallback:
      "Keyless photo rows; failed lists are degraded, lookups null and hard writes throw.",
    schemaMissing:
      "Missing lists mark memory results degraded; writes refuse production memory; cap-count failures throw.",
    authorizationOwner:
      "Verified upload/report routes and admin moderation own actors; store owns photo caps and review state.",
    resetHelper: ["__resetVenuePhotos"],
    class: "policy-heavy",
    selector: "selectStore",
  },
  "lib/visitReportsStore.ts": {
    interface: ["VisitReportStore"],
    fallback:
      "Keyless visit reports; failed public reads/counts are degraded and hard writes throw.",
    schemaMissing:
      "Missing public reads mark memory data degraded; writes refuse production memory; review lists retain their explicit fallback.",
    authorizationOwner:
      "Contribution routes verify actors/adult policy; admin gates moderation and store owns reporting state.",
    resetHelper: ["__resetVisitReports"],
    class: "policy-heavy",
    selector: "selectStore",
  },
  "lib/walkRouteStore.ts": {
    interface: ["WalkRouteStore"],
    fallback:
      "Keyless route cache; durable read failure is a cache miss and failed cache writes are skipped.",
    schemaMissing:
      "Missing reads and writes use memory cache; no authoritative user record is claimed.",
    authorizationOwner:
      "Internal routing cache; walk-route callers validate coordinates and cache keys, no account entitlement here.",
    resetHelper: ["__resetWalkRouteStore"],
    class: "cache-backed",
    selector: "selectStore",
  },
  "lib/wantedStore.ts": {
    interface: ["WantedStore"],
    fallback:
      "Keyless Wanted map; failed lists are degraded and failed lookups null; hard writes throw.",
    schemaMissing:
      "Missing reads use memory; create/fulfil/delete/promotion writes refuse production memory.",
    authorizationOwner:
      "Wanted routes derive owner actors; store filters every saved target by owner.",
    resetHelper: ["__resetWanteds"],
    class: "policy-heavy",
    selector: "selectStore",
  },
  "lib/weatherRecommendationStore.ts": {
    interface: ["WeatherRecommendationStore"],
    fallback:
      "Keyless shared recommendations; durable public failures are degraded.",
    schemaMissing:
      "Missing public reads/counts degrade in production; writes refuse production memory. Leaderboard fallback marks degradation.",
    authorizationOwner:
      "Authored recommendation routes verify authors and moderation; store owns publication/admissibility rules.",
    resetHelper: ["__resetWeatherRecommendations"],
    class: "policy-heavy",
    selector: "selectStore",
  },
  "lib/weatherSnapshotStore.ts": {
    interface: ["WeatherSnapshotStore"],
    fallback:
      "Keyless weather cache; failed durable reads return null and writes return failed=true.",
    schemaMissing: "Missing reads/writes use the memory weather snapshot.",
    authorizationOwner:
      "Weather cron owns acquisition; public readers cannot authorize snapshot writes.",
    resetHelper: ["__resetWeatherSnapshotStore"],
    class: "cache-backed",
    selector: "selectStore",
  },
  "lib/whatsOnListingStore.ts": {
    interface: ["WhatsOnListingStore"],
    fallback:
      "Keyless listing cache; unconfigured deployed production explicitly answers unavailable.",
    schemaMissing:
      "Missing writes refuse production memory with failed=true; reads expose durable=false and degradation.",
    authorizationOwner:
      "Whats-On cron owns reviewed listing writes; store owns per-kind generation watermarks.",
    resetHelper: ["__resetWhatsOnListingStore"],

    class: "policy-heavy",
    selector: "selectStore",
    inlineBranches: 1,
    reason:
      "Deployed production with no Supabase answers an unavailable store instead of memory.",
  },
  "lib/whatsOnStore.ts": {
    interface: [
      "baselineSourceObservedAt",
      "loadBaselineWhatsOn",
      "mergeWhatsOn",
      "loadWhatsOn",
    ],
    fallback:
      "Committed snapshot plus injectable live top-up; failures preserve the baseline with read status.",
    schemaMissing:
      "No local Supabase selector; durable listing failures fall back to the committed bundle with status.",
    authorizationOwner:
      "Harvest permission and listing admission rules own public facts; loadWhatsOn is a read interface.",
    resetHelper: ["__resetWhatsOnLiveTopUp"],

    class: "not-dual-backend",
    selector: "none",
    reason:
      "Bundled baseline files plus an injectable live merge; no Supabase in the module.",
  },
};

// Existing configuration branches outside store modules. These rows record policy, not migration approval.
const INLINE_BACKEND_INVENTORY: Record<string, Omit<StoreRow, "class">> = {
  "app/add/[handle]/page.tsx": {
    interface: ["metadata", "AddHandlePage"],
    selector: "inline",
    inlineBranches: 1,
    fallback:
      "Configured missing profiles return notFound; keyless mode permits the demo page.",
    schemaMissing:
      "This configuration guard adds no schema fallback; configured operations keep their own error handling.",
    authorizationOwner:
      "The calling route or job owns actor authorization; this module keeps its domain checks.",
    resetHelper: null,
    reason:
      "Configured missing profiles return notFound; keyless mode permits the demo page.",
  },
  "app/api/account/route.ts": {
    interface: ["DELETE"],
    selector: "inline",
    inlineBranches: 1,
    fallback: "Unconfigured account deletion returns 503.",
    schemaMissing:
      "This configuration guard adds no schema fallback; configured operations keep their own error handling.",
    authorizationOwner:
      "This route owns request authorization; configuration grants no actor rights.",
    resetHelper: null,
    reason: "Unconfigured account deletion returns 503.",
  },
  "app/api/ask/route.ts": {
    interface: ["POST"],
    selector: "inline",
    inlineBranches: 1,
    fallback:
      "LLM use requires configured storage in production; local development can proceed.",
    schemaMissing:
      "This configuration guard adds no schema fallback; configured operations keep their own error handling.",
    authorizationOwner:
      "This route owns request authorization; configuration grants no actor rights.",
    resetHelper: null,
    reason:
      "LLM use requires configured storage in production; local development can proceed.",
  },
  "app/api/auth/handle-password/route.ts": {
    interface: ["POST"],
    selector: "inline",
    inlineBranches: 1,
    fallback: "Unconfigured password sign-in returns 503.",
    schemaMissing:
      "This configuration guard adds no schema fallback; configured operations keep their own error handling.",
    authorizationOwner:
      "This route owns request authorization; configuration grants no actor rights.",
    resetHelper: null,
    reason: "Unconfigured password sign-in returns 503.",
  },
  "app/api/check-ins/route.ts": {
    interface: ["GET", "POST", "DELETE"],
    selector: "inline",
    inlineBranches: 2,
    fallback:
      "Required but unconfigured durable storage returns 503; keyless development retains its existing path.",
    schemaMissing:
      "This configuration guard adds no schema fallback; configured operations keep their own error handling.",
    authorizationOwner:
      "This route owns request authorization; configuration grants no actor rights.",
    resetHelper: null,
    reason:
      "Required but unconfigured durable storage returns 503; keyless development retains its existing path.",
  },
  "app/api/cron/cheap-pint-ping/route.ts": {
    interface: ["runtime", "dynamic", "maxDuration", "GET"],
    selector: "inline",
    inlineBranches: 1,
    fallback: "Unconfigured storage skips the push job.",
    schemaMissing:
      "This configuration guard adds no schema fallback; configured operations keep their own error handling.",
    authorizationOwner:
      "This route owns request authorization; configuration grants no actor rights.",
    resetHelper: null,
    reason: "Unconfigured storage skips the push job.",
  },
  "app/api/cron/step-out-nudge/route.ts": {
    interface: ["runtime", "dynamic", "maxDuration", "GET"],
    selector: "inline",
    inlineBranches: 1,
    fallback: "Unconfigured storage skips the push job.",
    schemaMissing:
      "This configuration guard adds no schema fallback; configured operations keep their own error handling.",
    authorizationOwner:
      "This route owns request authorization; configuration grants no actor rights.",
    resetHelper: null,
    reason: "Unconfigured storage skips the push job.",
  },
  "app/api/founding-members/route.ts": {
    interface: ["FoundingMemberEntry", "GET"],
    selector: "inline",
    inlineBranches: 1,
    fallback:
      "Required but unconfigured durable storage returns 503; keyless development retains its existing path.",
    schemaMissing:
      "This configuration guard adds no schema fallback; configured operations keep their own error handling.",
    authorizationOwner:
      "This route owns request authorization; configuration grants no actor rights.",
    resetHelper: null,
    reason:
      "Required but unconfigured durable storage returns 503; keyless development retains its existing path.",
  },
  "app/api/identity/handle/claim/route.ts": {
    interface: ["POST"],
    selector: "inline",
    inlineBranches: 1,
    fallback:
      "Required but unconfigured durable storage returns 503; keyless development retains its existing path.",
    schemaMissing:
      "This configuration guard adds no schema fallback; configured operations keep their own error handling.",
    authorizationOwner:
      "This route owns request authorization; configuration grants no actor rights.",
    resetHelper: null,
    reason:
      "Required but unconfigured durable storage returns 503; keyless development retains its existing path.",
  },
  "app/api/identity/handle/rename/route.ts": {
    interface: ["POST"],
    selector: "inline",
    inlineBranches: 1,
    fallback:
      "Required but unconfigured durable storage returns 503; keyless development retains its existing path.",
    schemaMissing:
      "This configuration guard adds no schema fallback; configured operations keep their own error handling.",
    authorizationOwner:
      "This route owns request authorization; configuration grants no actor rights.",
    resetHelper: null,
    reason:
      "Required but unconfigured durable storage returns 503; keyless development retains its existing path.",
  },
  "app/api/me/night-profile/route.ts": {
    interface: ["GET", "PUT"],
    selector: "inline",
    inlineBranches: 1,
    fallback:
      "Required but unconfigured durable storage returns 503; keyless development retains its existing path.",
    schemaMissing:
      "This configuration guard adds no schema fallback; configured operations keep their own error handling.",
    authorizationOwner:
      "This route owns request authorization; configuration grants no actor rights.",
    resetHelper: null,
    reason:
      "Required but unconfigured durable storage returns 503; keyless development retains its existing path.",
  },
  "app/api/me/pending-plan-recaps/route.ts": {
    interface: ["GET", "PUT", "POST"],
    selector: "inline",
    inlineBranches: 1,
    fallback:
      "Required but unconfigured durable storage returns 503; keyless development retains its existing path.",
    schemaMissing:
      "This configuration guard adds no schema fallback; configured operations keep their own error handling.",
    authorizationOwner:
      "This route owns request authorization; configuration grants no actor rights.",
    resetHelper: null,
    reason:
      "Required but unconfigured durable storage returns 503; keyless development retains its existing path.",
  },
  "app/api/pint-drops/route.ts": {
    interface: ["POST", "GET"],
    selector: "inline",
    inlineBranches: 1,
    fallback:
      "Required but unconfigured durable storage returns 503; keyless development retains its existing path.",
    schemaMissing:
      "This configuration guard adds no schema fallback; configured operations keep their own error handling.",
    authorizationOwner:
      "This route owns request authorization; configuration grants no actor rights.",
    resetHelper: null,
    reason:
      "Required but unconfigured durable storage returns 503; keyless development retains its existing path.",
  },
  "app/api/profiles/[handle]/follow/route.ts": {
    interface: ["POST"],
    selector: "inline",
    inlineBranches: 1,
    fallback:
      "Required but unconfigured durable storage returns 503; keyless development retains its existing path.",
    schemaMissing:
      "This configuration guard adds no schema fallback; configured operations keep their own error handling.",
    authorizationOwner:
      "This route owns request authorization; configuration grants no actor rights.",
    resetHelper: null,
    reason:
      "Required but unconfigured durable storage returns 503; keyless development retains its existing path.",
  },
  "app/api/profiles/[handle]/route.ts": {
    interface: ["GET", "PATCH", "DELETE", "PUT"],
    selector: "inline",
    inlineBranches: 2,
    fallback:
      "Required but unconfigured durable storage returns 503; keyless development retains its existing path.",
    schemaMissing:
      "This configuration guard adds no schema fallback; configured operations keep their own error handling.",
    authorizationOwner:
      "This route owns request authorization; configuration grants no actor rights.",
    resetHelper: null,
    reason:
      "Required but unconfigured durable storage returns 503; keyless development retains its existing path.",
  },
  "app/api/profiles/directory/route.ts": {
    interface: ["DirectoryEntry", "GET"],
    selector: "inline",
    inlineBranches: 1,
    fallback:
      "Required but unconfigured durable storage returns 503; keyless development retains its existing path.",
    schemaMissing:
      "This configuration guard adds no schema fallback; configured operations keep their own error handling.",
    authorizationOwner:
      "This route owns request authorization; configuration grants no actor rights.",
    resetHelper: null,
    reason:
      "Required but unconfigured durable storage returns 503; keyless development retains its existing path.",
  },
  "app/api/profiles/search/route.ts": {
    interface: ["GET"],
    selector: "inline",
    inlineBranches: 1,
    fallback:
      "Required but unconfigured durable storage returns 503; keyless development retains its existing path.",
    schemaMissing:
      "This configuration guard adds no schema fallback; configured operations keep their own error handling.",
    authorizationOwner:
      "This route owns request authorization; configuration grants no actor rights.",
    resetHelper: null,
    reason:
      "Required but unconfigured durable storage returns 503; keyless development retains its existing path.",
  },
  "app/api/pub-pal/llm/route.ts": {
    interface: ["POST"],
    selector: "inline",
    inlineBranches: 1,
    fallback:
      "The configured backend condition controls the durable request fence.",
    schemaMissing:
      "This configuration guard adds no schema fallback; configured operations keep their own error handling.",
    authorizationOwner:
      "This route owns request authorization; configuration grants no actor rights.",
    resetHelper: null,
    reason:
      "The configured backend condition controls the durable request fence.",
  },
  "app/api/pub-pal/voice-token/route.ts": {
    interface: ["GET", "POST"],
    selector: "inline",
    inlineBranches: 2,
    fallback:
      "Unconfigured usage uses the memory meter; configured usage uses the durable RPC.",
    schemaMissing:
      "This configuration guard adds no schema fallback; configured operations keep their own error handling.",
    authorizationOwner:
      "This route owns request authorization; configuration grants no actor rights.",
    resetHelper: null,
    reason:
      "Unconfigured usage uses the memory meter; configured usage uses the durable RPC.",
  },
  "app/api/saved-pubs/list-follows/route.ts": {
    interface: ["GET", "POST"],
    selector: "inline",
    inlineBranches: 1,
    fallback:
      "Required but unconfigured durable storage returns 503; keyless development retains its existing path.",
    schemaMissing:
      "This configuration guard adds no schema fallback; configured operations keep their own error handling.",
    authorizationOwner:
      "This route owns request authorization; configuration grants no actor rights.",
    resetHelper: null,
    reason:
      "Required but unconfigured durable storage returns 503; keyless development retains its existing path.",
  },
  "app/api/starter-packs/[slug]/follow/route.ts": {
    interface: ["POST"],
    selector: "inline",
    inlineBranches: 1,
    fallback:
      "Required but unconfigured durable storage returns 503; keyless development retains its existing path.",
    schemaMissing:
      "This configuration guard adds no schema fallback; configured operations keep their own error handling.",
    authorizationOwner:
      "This route owns request authorization; configuration grants no actor rights.",
    resetHelper: null,
    reason:
      "Required but unconfigured durable storage returns 503; keyless development retains its existing path.",
  },
  "app/api/starter-packs/route.ts": {
    interface: ["GET"],
    selector: "inline",
    inlineBranches: 1,
    fallback:
      "Required but unconfigured durable storage returns 503; keyless development retains its existing path.",
    schemaMissing:
      "This configuration guard adds no schema fallback; configured operations keep their own error handling.",
    authorizationOwner:
      "This route owns request authorization; configuration grants no actor rights.",
    resetHelper: null,
    reason:
      "Required but unconfigured durable storage returns 503; keyless development retains its existing path.",
  },
  "app/bar-tab/[id]/opengraph-image.tsx": {
    interface: ["runtime", "alt", "size", "contentType", "Image"],
    selector: "inline",
    inlineBranches: 1,
    fallback: "Selects the memory or Supabase Pint Drop reader for the image.",
    schemaMissing:
      "This configuration guard adds no schema fallback; configured operations keep their own error handling.",
    authorizationOwner:
      "The calling route or job owns actor authorization; this module keeps its domain checks.",
    resetHelper: null,
    reason: "Selects the memory or Supabase Pint Drop reader for the image.",
  },
  "app/bar-tab/[id]/page.tsx": {
    interface: ["generateMetadata", "BarTabPage"],
    selector: "inline",
    inlineBranches: 1,
    fallback: "Selects the memory or Supabase Pint Drop reader for the page.",
    schemaMissing:
      "This configuration guard adds no schema fallback; configured operations keep their own error handling.",
    authorizationOwner:
      "The calling route or job owns actor authorization; this module keeps its domain checks.",
    resetHelper: null,
    reason: "Selects the memory or Supabase Pint Drop reader for the page.",
  },
  "app/ledger/[id]/page.tsx": {
    interface: ["generateMetadata", "LedgerPage"],
    selector: "inline",
    inlineBranches: 1,
    fallback: "Selects the memory or Supabase Pint Drop reader for the page.",
    schemaMissing:
      "This configuration guard adds no schema fallback; configured operations keep their own error handling.",
    authorizationOwner:
      "The calling route or job owns actor authorization; this module keeps its domain checks.",
    resetHelper: null,
    reason: "Selects the memory or Supabase Pint Drop reader for the page.",
  },
  "lib/creatorListDiscoveryRoute.server.ts": {
    interface: [
      "CreatorListDiscoveryRouteDependencies",
      "handleCreatorListDiscoveryRequest",
    ],
    selector: "inline",
    inlineBranches: 1,
    fallback: "Required but unconfigured durable storage returns 503.",
    schemaMissing:
      "This configuration guard adds no schema fallback; configured operations keep their own error handling.",
    authorizationOwner:
      "The discovery route handler owns request checks; creator-list reads expose only public discovery data.",
    resetHelper: null,
    reason: "Required but unconfigured durable storage returns 503.",
  },
  "lib/followWrite.server.ts": {
    interface: ["FollowWriteResult", "followOnce"],
    selector: "inline",
    inlineBranches: 1,
    fallback: "A missing profile refuses a follow when storage is configured.",
    schemaMissing:
      "This configuration guard adds no schema fallback; configured operations keep their own error handling.",
    authorizationOwner:
      "Calling routes use resolveMessageHandle and gateHandleAction before follow writes.",
    resetHelper: null,
    reason: "A missing profile refuses a follow when storage is configured.",
  },
  "lib/handlePasswordSignIn.ts": {
    interface: [
      "HandlePasswordSession",
      "resolveAuthEmailForHandle",
      "accountHasPassword",
      "signInWithEmailPassword",
    ],
    selector: "inline",
    inlineBranches: 2,
    fallback: "Unconfigured password metadata and account lookups return null.",
    schemaMissing:
      "This configuration guard adds no schema fallback; configured operations keep their own error handling.",
    authorizationOwner:
      "The handle-password route owns rate limits; GoTrue verifies the password. The current-identity route gates password metadata.",
    resetHelper: null,
    reason: "Unconfigured password metadata and account lookups return null.",
  },
  "lib/heritage.ts": {
    interface: [
      "HeritageFact",
      "storedFactSource",
      "HeritageResponse",
      "NO_STORY_LINE",
      "HeritageReadResult",
      "retrieveHeritageWithStatus",
      "retrieveHeritage",
      "answerHeritage",
    ],
    selector: "inline",
    inlineBranches: 1,
    fallback: "Unconfigured retrieval returns no stored rows.",
    schemaMissing:
      "This configuration guard adds no schema fallback; configured operations keep their own error handling.",
    authorizationOwner:
      "The heritage route owns request limits; this reader retrieves public heritage facts.",
    resetHelper: ["__resetHeritageCache"],
    reason: "Unconfigured retrieval returns no stored rows.",
  },
  "lib/mapSearchEvents.server.ts": {
    interface: ["MapSearchEventInput", "recordMapSearchEvent"],
    selector: "inline",
    inlineBranches: 1,
    fallback: "Unconfigured storage skips event persistence.",
    schemaMissing:
      "This configuration guard adds no schema fallback; configured operations keep their own error handling.",
    authorizationOwner:
      "The map-search route owns event admission and request limits.",
    resetHelper: null,
    reason: "Unconfigured storage skips event persistence.",
  },
  "lib/messageAuth.ts": {
    interface: [
      "resolveMessageHandle",
      "LinkedActorGate",
      "requireLinkedActor",
    ],
    selector: "inline",
    inlineBranches: 1,
    fallback:
      "Selects the memory or durable profile lookup before actor checks.",
    schemaMissing:
      "This configuration guard adds no schema fallback; configured operations keep their own error handling.",
    authorizationOwner:
      "callerUserId verifies the session; profileOwnership.gateHandleAction checks the resolved handle at the calling route.",
    resetHelper: null,
    reason: "Selects the memory or durable profile lookup before actor checks.",
  },
  "lib/messagePhotoMedia.server.ts": {
    interface: [
      "MESSAGE_PHOTO_MAX_BYTES",
      "MESSAGE_PHOTO_SIGNED_TTL_SECONDS",
      "PreparedMessagePhoto",
      "StagedMessagePhoto",
      "MessagePhotoStorage",
      "MessagePhotoError",
      "prepareMessagePhoto",
      "supabaseMessagePhotoStorage",
      "stagePreparedMessagePhoto",
      "promoteStagedMessagePhoto",
      "discardStagedMessagePhoto",
      "removeMessagePhotoObject",
      "signMessagePhotoObject",
      "DownloadedMessagePhoto",
      "downloadMessagePhotoObject",
    ],
    selector: "inline",
    inlineBranches: 3,
    fallback:
      "Unconfigured uploads fail; removal skips storage and signing returns null.",
    schemaMissing:
      "This configuration guard adds no schema fallback; configured operations keep their own error handling.",
    authorizationOwner:
      "Message routes own conversation membership and the actor check before media writes.",
    resetHelper: null,
    reason:
      "Unconfigured uploads fail; removal skips storage and signing returns null.",
  },
  "lib/nightMomentMedia.ts": {
    interface: [
      "uploadNightMomentPhoto",
      "removeNightMomentPhoto",
      "NIGHT_MOMENT_PHOTO_TTL_SECONDS",
      "PUBLIC_RECAP_PHOTO_TTL_SECONDS",
      "signedNightMomentPhotoUrl",
    ],
    selector: "inline",
    inlineBranches: 2,
    fallback:
      "Unconfigured uploads fail and retain the draft; signing returns null.",
    schemaMissing:
      "This configuration guard adds no schema fallback; configured operations keep their own error handling.",
    authorizationOwner:
      "Night Moment routes own the signed-in account and draft ownership checks.",
    resetHelper: null,
    reason:
      "Unconfigured uploads fail and retain the draft; signing returns null.",
  },
  "lib/pintDropLookup.ts": {
    interface: [
      "PublicDrop",
      "filterPubliclyReadableDropIds",
      "getPintDropById",
    ],
    selector: "inline",
    inlineBranches: 2,
    fallback: "Selects the memory or durable public report lookup.",
    schemaMissing:
      "Missing retirement or visibility columns use the existing compatible query shapes.",
    authorizationOwner:
      "Public reads apply Pint Drop visibility and caller-supplied viewer context; configuration grants no viewer rights.",
    resetHelper: null,
    reason: "Selects the memory or durable public report lookup.",
  },
  "lib/pintDrops.ts": {
    interface: [
      "dropMatchesCityScope",
      "PintDropReviewStatus",
      "cleanVibeTags",
      "validatePintDrop",
      "isRateLimited",
      "isLimited",
      "addPintDrop",
      "hasPricedDropToday",
      "listVisiblePintDrops",
      "listAllVisiblePintDrops",
      "visibilityOf",
      "normalizeViewerHandle",
      "isAuthor",
      "qualifiesForFriends",
      "canViewOnPublicSurface",
      "isPubliclyReadableDrop",
      "findPintDropsByIds",
      "listLegacyPintDropsForVenue",
      "REPORT_HIDE_THRESHOLD",
      "PintDropReportIdentity",
      "reportPintDrop",
      "verifiedPintDropReportCount",
      "listByStatus",
      "listReportedPintDrops",
      "confirmPintDrop",
      "listConfirmedPintDrops",
      "restorePintDrop",
      "keepHiddenPintDrop",
    ],
    selector: "inline",
    inlineBranches: 1,
    fallback:
      "Unconfigured rate limits use memory; configured limits use the RPC.",
    schemaMissing:
      "This configuration guard adds no schema fallback; configured operations keep their own error handling.",
    authorizationOwner:
      "Pint Drop routes own actor and moderator checks; pintDrops owns visibility policy and rate-limit identity.",
    resetHelper: ["__resetPintDrops"],
    reason:
      "Unconfigured rate limits use memory; configured limits use the RPC.",
  },
  "lib/planCrewIdentity.ts": {
    interface: [
      "PlanMembershipClaimResult",
      "PlanMembershipRecoveryResult",
      "planAccountRecoveryToken",
      "claimPlanMembership",
      "recoverPlanMembership",
      "linkPlanMemberUser",
      "linkPlanOwnerUser",
      "listPlanMemberUserIds",
    ],
    selector: "inline",
    inlineBranches: 4,
    fallback:
      "Unconfigured account bindings and membership recovery use memory.",
    schemaMissing:
      "A missing claim RPC can use legacyClaimPlanMembership; failure never proves membership.",
    authorizationOwner:
      "Plan routes establish the account and member capability; membership claims enforce account binding.",
    resetHelper: null,
    reason: "Unconfigured account bindings and membership recovery use memory.",
  },
  "lib/profileCoverPhotoRoute.server.ts": {
    interface: [
      "ProfileCoverPhotoRouteDeps",
      "defaultProfileCoverPhotoRouteDeps",
      "coverPhotoDTOs",
      "handleProfileCoverPhotoList",
      "handleProfileCoverPhotoUpload",
      "handleProfileCoverPhotoDelete",
      "handleProfileCoverPhotoMove",
      "handleProfileCoverPhotoReport",
    ],
    selector: "inline",
    inlineBranches: 1,
    fallback: "Required but unconfigured durable storage returns 503.",
    schemaMissing:
      "This configuration guard adds no schema fallback; configured operations keep their own error handling.",
    authorizationOwner:
      "profileOwnership.gateHandleAction and the route handler require the profile owner account.",
    resetHelper: null,
    reason: "Required but unconfigured durable storage returns 503.",
  },
  "lib/profileImageMedia.server.ts": {
    interface: [
      "PROFILE_IMAGE_MAX_BYTES",
      "PROFILE_IMAGE_SIGNED_TTL_SECONDS",
      "PreparedProfileImage",
      "UploadedProfileImage",
      "ProfileImageStorage",
      "ProfileImageError",
      "prepareProfileImage",
      "supabaseProfileImageStorage",
      "stagePreparedProfileImage",
      "promoteStagedProfileImage",
      "discardStagedProfileImage",
      "signProfileImageObject",
      "DownloadedProfileImage",
      "downloadProfileImageObject",
      "purgeProfileImageObjects",
    ],
    selector: "inline",
    inlineBranches: 4,
    fallback:
      "Unconfigured uploads fail; removal skips storage, signing returns null and object listing returns empty.",
    schemaMissing:
      "This configuration guard adds no schema fallback; configured operations keep their own error handling.",
    authorizationOwner:
      "profileImageRoute.server and profileCoverPhotoRoute.server verify profile ownership before calling the media pipeline.",
    resetHelper: null,
    reason:
      "Unconfigured uploads fail; removal skips storage, signing returns null and object listing returns empty.",
  },
  "lib/profileImageRoute.server.ts": {
    interface: [
      "ProfileImageRouteDeps",
      "defaultProfileImageRouteDeps",
      "handleProfileImageUpload",
      "handleProfileImageDelete",
      "handleProfileImageReport",
    ],
    selector: "inline",
    inlineBranches: 2,
    fallback: "Required but unconfigured durable storage returns 503.",
    schemaMissing:
      "This configuration guard adds no schema fallback; configured operations keep their own error handling.",
    authorizationOwner:
      "profileOwnership.gateHandleAction and the route handler require the profile owner account.",
    resetHelper: null,
    reason: "Required but unconfigured durable storage returns 503.",
  },
  "lib/profileImageServe.server.ts": {
    interface: [
      "PROFILE_IMAGE_SERVE_CACHE_CONTROL",
      "ProfileImageServeDeps",
      "defaultProfileImageServeDeps",
      "handleProfileImageServe",
    ],
    selector: "inline",
    inlineBranches: 1,
    fallback: "Unconfigured image serving returns 404.",
    schemaMissing:
      "This configuration guard adds no schema fallback; configured operations keep their own error handling.",
    authorizationOwner:
      "The serve handler checks profile visibility, moderation and image generation before public serving.",
    resetHelper: null,
    reason: "Unconfigured image serving returns 404.",
  },
  "lib/roundPriceBudget.ts": {
    interface: [
      "ROUND_PRICE_ACTOR_LIMIT",
      "ROUND_PRICE_WINDOW_MS",
      "ROUND_PRICE_DEGRADED_RETRY_SECONDS",
      "RoundPriceBudgetMode",
      "RoundPriceBudget",
      "RoundPriceLineCharge",
      "roundPriceActorKey",
      "chargeRoundPriceLines",
    ],
    selector: "inline",
    inlineBranches: 1,
    fallback: "Unconfigured budget charging uses memory.",
    schemaMissing:
      "This configuration guard adds no schema fallback; configured operations keep their own error handling.",
    authorizationOwner:
      "Round and price submission routes supply the authenticated profile actor for budget charging.",
    resetHelper: null,
    reason: "Unconfigured budget charging uses memory.",
  },
  "lib/serverEnv.ts": {
    interface: [
      "DEV_RATE_LIMIT_SALT",
      "assertProductionSecrets",
      "assertServerEnv",
    ],
    selector: "inline",
    inlineBranches: 1,
    fallback:
      "Required but unconfigured production storage fails startup validation.",
    schemaMissing:
      "This configuration guard adds no schema fallback; configured operations keep their own error handling.",
    authorizationOwner:
      "Deployment configuration owns startup requirements; assertServerEnv grants no request authority.",
    resetHelper: null,
    reason:
      "Required but unconfigured production storage fails startup validation.",
  },
  "lib/socialOAuth.ts": {
    interface: [
      "socialProviderAvailability",
      "readSocialOAuthState",
      "createSocialOAuthStart",
      "encryptSocialCredential",
      "socialOAuthScopes",
      "completeSocialOAuth",
    ],
    selector: "inline",
    inlineBranches: 2,
    fallback:
      "Unconfigured OAuth state uses memory; configured state uses durable storage.",
    schemaMissing:
      "This configuration guard adds no schema fallback; configured operations keep their own error handling.",
    authorizationOwner:
      "Social OAuth routes establish the owner; consume_social_oauth_state enforces one-use state and provider matching.",
    resetHelper: null,
    reason:
      "Unconfigured OAuth state uses memory; configured state uses durable storage.",
  },
  "lib/socialPostCreateRequest.server.ts": {
    interface: ["readSocialPostCreateRequest"],
    selector: "inline",
    inlineBranches: 1,
    fallback: "Unconfigured idempotency lookup returns null.",
    schemaMissing: "A missing create-request table returns null.",
    authorizationOwner:
      "Social post creation supplies the verified author profile and idempotency key.",
    resetHelper: null,
    reason: "Unconfigured idempotency lookup returns null.",
  },
  "lib/socialPostMedia.server.ts": {
    interface: [
      "SOCIAL_PHOTO_MAX_BYTES",
      "SOCIAL_PHOTO_MAX_DIMENSION",
      "SOCIAL_PHOTO_MAX_PIXELS",
      "SOCIAL_PHOTO_OUTPUT_DIMENSION",
      "SOCIAL_MEDIA_SIGNED_TTL_SECONDS",
      "PreparedSocialPhoto",
      "UploadedSocialPhoto",
      "ClaimedSocialPhotoCleanup",
      "SocialPhotoStorage",
      "SocialPhotoError",
      "prepareSocialPhoto",
      "supabaseSocialPhotoStorage",
      "uploadPreparedSocialPhoto",
      "reserveSocialPhotoUpload",
      "reconcileSocialPhotoUpload",
      "signSocialPhotoObject",
      "purgeDetachedSocialPhotos",
      "purgeOrphanedSocialPhotoUploads",
      "purgeClaimedSocialPhotoRows",
    ],
    selector: "inline",
    inlineBranches: 7,
    fallback:
      "Unconfigured uploads fail; storage cleanup and signing skip work; reservation and claim results remain operation-specific.",
    schemaMissing:
      "This configuration guard adds no schema fallback; configured operations keep their own error handling.",
    authorizationOwner:
      "Social post routes verify the author; cleanup RPCs enforce the claimed generation and cleanup token.",
    resetHelper: null,
    reason:
      "Unconfigured uploads fail; storage cleanup and signing skip work; reservation and claim results remain operation-specific.",
  },
  "lib/stepOutNudgeSelect.server.ts": {
    interface: [
      "SoftPlanCandidate",
      "DealCandidate",
      "StepOutNudgeSelectDeps",
      "defaultStepOutNudgeSelectDeps",
      "selectOwedStepOutNudge",
      "accountIdForOwnerActor",
    ],
    selector: "inline",
    inlineBranches: 2,
    fallback: "Unconfigured selection returns empty plans or no profile.",
    schemaMissing:
      "This configuration guard adds no schema fallback; configured operations keep their own error handling.",
    authorizationOwner:
      "Step-out cron authorization controls selection; queries filter the plan and account owner.",
    resetHelper: null,
    reason: "Unconfigured selection returns empty plans or no profile.",
  },
  "lib/trustedSigningKey.server.ts": {
    interface: [
      "MIN_TRUSTED_SIGNING_SECRET_BYTES",
      "TrustedSigningKeyUnavailableError",
      "trustedSigningKey",
      "isTrustedSigningKeyUnavailableError",
    ],
    selector: "inline",
    inlineBranches: 1,
    fallback:
      "Missing secrets throw in production or configured mode; only keyless development may use an ephemeral key.",
    schemaMissing:
      "This configuration guard adds no schema fallback; configured operations keep their own error handling.",
    authorizationOwner:
      "Trusted-signing callers own capability verification; this module requires the deployment secret.",
    resetHelper: null,
    reason:
      "Missing secrets throw in production or configured mode; only keyless development may use an ephemeral key.",
  },
  "lib/uploadedImage.server.ts": {
    interface: [
      "UPLOADED_IMAGE_MAX_BYTES",
      "UPLOADED_IMAGE_MAX_DIMENSION",
      "UPLOADED_IMAGE_MAX_PIXELS",
      "UPLOADED_IMAGE_ALLOWED_TYPES",
      "DownloadedUploadedImage",
      "UploadedImageReadFailure",
      "UploadedImageReadResult",
      "readUploadedImageObject",
      "downloadUploadedImageObject",
      "uploadedImageStorageBody",
      "uploadUploadedImageObject",
      "UploadedImageWriteProof",
      "proveUploadedImageWrite",
      "UploadedImageErrorCode",
      "PreparedImage",
      "ImagePreparationSpec",
      "prepareUploadedImage",
    ],
    selector: "inline",
    inlineBranches: 1,
    fallback: "Unconfigured reads report storage_unconfigured.",
    schemaMissing:
      "This configuration guard adds no schema fallback; configured operations keep their own error handling.",
    authorizationOwner:
      "The owning profile, message or venue photo route controls access; this module only checks stored image bytes.",
    resetHelper: null,
    reason: "Unconfigured reads report storage_unconfigured.",
  },
  "lib/venuePhotoMedia.server.ts": {
    interface: [
      "VENUE_PHOTO_MAX_BYTES",
      "VENUE_PHOTO_SIGNED_TTL_SECONDS",
      "PreparedVenuePhoto",
      "StagedVenuePhoto",
      "VenuePhotoStorage",
      "VenuePhotoError",
      "prepareVenuePhoto",
      "supabaseVenuePhotoStorage",
      "stagePreparedVenuePhoto",
      "promoteStagedVenuePhoto",
      "discardStagedVenuePhoto",
      "signVenuePhotoObject",
      "DownloadedVenuePhoto",
      "downloadVenuePhotoObject",
    ],
    selector: "inline",
    inlineBranches: 3,
    fallback:
      "Unconfigured uploads fail; removal skips storage and signing returns null.",
    schemaMissing:
      "This configuration guard adds no schema fallback; configured operations keep their own error handling.",
    authorizationOwner:
      "Venue photo routes verify the social actor before media writes.",
    resetHelper: null,
    reason:
      "Unconfigured uploads fail; removal skips storage and signing returns null.",
  },
  "lib/venuePhotoServe.server.ts": {
    interface: [
      "VENUE_PHOTO_SERVE_CACHE_CONTROL",
      "VenuePhotoServeDeps",
      "defaultVenuePhotoServeDeps",
      "handleVenuePhotoServe",
    ],
    selector: "inline",
    inlineBranches: 1,
    fallback: "Unconfigured image serving returns 404.",
    schemaMissing:
      "This configuration guard adds no schema fallback; configured operations keep their own error handling.",
    authorizationOwner:
      "The serve handler checks photo moderation and author retirement before public serving.",
    resetHelper: null,
    reason: "Unconfigured image serving returns 404.",
  },
  "lib/wantedPromotion.server.ts": {
    interface: ["WantedPromotionResult", "promoteWantedToSavedList"],
    selector: "inline",
    inlineBranches: 1,
    fallback:
      "Unconfigured promotion uses memory; configured promotion uses the RPC.",
    schemaMissing:
      "This configuration guard adds no schema fallback; configured operations keep their own error handling.",
    authorizationOwner:
      "Wanted promotion callers own actor admission; the promotion RPC enforces the stored promotion transition.",
    resetHelper: null,
    reason:
      "Unconfigured promotion uses memory; configured promotion uses the RPC.",
  },
  "scripts/build_pint_index_snapshot.mjs": {
    interface: ["<module>"],
    selector: "inline",
    inlineBranches: 1,
    fallback:
      "Unconfigured storage stops the snapshot build before it can replace real data.",
    schemaMissing:
      "This configuration guard adds no schema fallback; configured operations keep their own error handling.",
    authorizationOwner:
      "The CLI or cron caller owns execution credentials; configuration grants no actor rights.",
    resetHelper: null,
    reason:
      "Unconfigured storage stops the snapshot build before it can replace real data.",
  },
  "scripts/push/sendDailyBrief.mjs": {
    interface: ["buildCurrentDailyBrief", "main"],
    selector: "inline",
    inlineBranches: 1,
    fallback:
      "Unconfigured storage skips live sends; dry runs remain available.",
    schemaMissing:
      "This configuration guard adds no schema fallback; configured operations keep their own error handling.",
    authorizationOwner:
      "The CLI or cron caller owns execution credentials; configuration grants no actor rights.",
    resetHelper: null,
    reason: "Unconfigured storage skips live sends; dry runs remain available.",
  },
  "scripts/push/sendStepOutNudge.mjs": {
    interface: ["main"],
    selector: "inline",
    inlineBranches: 1,
    fallback:
      "Unconfigured storage skips live sends; dry runs remain available.",
    schemaMissing:
      "This configuration guard adds no schema fallback; configured operations keep their own error handling.",
    authorizationOwner:
      "The CLI or cron caller owns execution credentials; configuration grants no actor rights.",
    resetHelper: null,
    reason: "Unconfigured storage skips live sends; dry runs remain available.",
  },
};

// Existing adopters stay in place. These test links are evidence pointers, not a full coverage claim.
const FACTORY_ADOPTIONS = {
  "lib/adultSelfAssertionStore.ts": {
    tests: [
      "__tests__/adultSelfAssertionRoute.test.ts",
      "__tests__/adultSelfAssertionStore.test.ts",
    ],
    disposition:
      "Retain. Account checks and first-tap semantics remain outside the selector; both adapters reject blank account IDs.",
  },
  "lib/feedFreshnessStore.ts": {
    tests: ["__tests__/storePilotParity.test.ts"],
    disposition:
      "Retain. Named pilot. Preserve result-style write failures and held metadata reads.",
  },
  "lib/harvestOverlayStore.ts": {
    tests: [
      "__tests__/harvestOverlayStore.test.ts",
      "__tests__/harvestOverlayStoreMalformed.test.ts",
    ],
    disposition:
      "Retain. The caller's requireDurable option and degraded overlay results remain outside the factory.",
  },
  "lib/occupancyStore.ts": {
    tests: [
      "__tests__/storePilotParity.test.ts",
      "__tests__/occupancyStore.test.ts",
      "__tests__/occupancyStorePre0109.test.ts",
    ],
    disposition:
      "Retain. Named pilot. Keep moderation, retake and missing-column policy inside its adapter.",
  },
  "lib/priceTrustEventStore.ts": {
    tests: [
      "__tests__/priceTrustEventStore.test.ts",
      "__tests__/priceTrustEventStoreDurable.test.ts",
    ],
    disposition:
      "Retain. Event reversals, credits and degraded reads remain domain policy.",
  },
  "lib/stepOutNudgeStore.ts": {
    tests: [
      "__tests__/stepOutNudgeStore.test.ts",
      "__tests__/stepOutNudgeStoreParity.test.ts",
    ],
    disposition:
      "Retain. Opt-in and withdrawal remain subscription policy; both adapters preserve disabled-lane send stamps.",
  },
  "lib/walkRouteStore.ts": {
    tests: ["__tests__/walkRouteStore.test.ts"],
    disposition:
      "Retain. TTL and cache failures remain adapter policy; both adapters validate coordinate arrays with the existing decoder.",
  },
  "lib/wantedStore.ts": {
    tests: ["__tests__/wantedStore.test.ts"],
    disposition: "Retain. Owner filtering and fulfilment remain domain policy.",
  },
};

const SEAM = "lib/storeBackend.ts";

function storeModules(): string[] {
  return readdirSync(join(process.cwd(), "lib"))
    .filter((name) => /Store.*\.ts$/.test(name) && !name.endsWith(".d.ts"))
    .map((name) => `lib/${name}`)
    .filter((path) => path !== SEAM)
    .sort();
}

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

function count(src: string, needle: string): number {
  return src.split(needle).length - 1;
}

function parsedSource(path: string): ts.SourceFile {
  return ts.createSourceFile(path, source(path), ts.ScriptTarget.Latest, true);
}

function exportedNames(path: string): string[] {
  return parsedSource(path).statements.flatMap((statement) => {
    if (
      !ts.canHaveModifiers(statement) ||
      !ts
        .getModifiers(statement)
        ?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
    )
      return [];
    if (ts.isVariableStatement(statement)) {
      return statement.declarationList.declarations.flatMap((declaration) =>
        ts.isIdentifier(declaration.name) ? [declaration.name.text] : [],
      );
    }
    if (
      (ts.isFunctionDeclaration(statement) ||
        ts.isInterfaceDeclaration(statement) ||
        ts.isTypeAliasDeclaration(statement) ||
        ts.isClassDeclaration(statement) ||
        ts.isEnumDeclaration(statement)) &&
      statement.name
    )
      return [statement.name.text];
    return [];
  });
}

function inlineBackendCalls(path: string): number {
  let calls = 0;
  function visit(node: ts.Node): void {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      [
        "isSupabaseConfigured",
        "selectStore",
        "createDualBackendStore",
      ].includes(node.expression.text)
    )
      calls += 1;
    ts.forEachChild(node, visit);
  }
  visit(parsedSource(path));
  return calls;
}

function productionModules(directory: string): string[] {
  return readdirSync(join(process.cwd(), directory), {
    withFileTypes: true,
  }).flatMap((entry) => {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) return productionModules(path);
    return /\.(?:[cm]?js|tsx?)$/.test(path) && !path.endsWith(".d.ts")
      ? [path]
      : [];
  });
}

// This fence checks coverage and source references. Policy text still requires review.
describe("backend inventory evidence (#727)", () => {
  it("records all existing factory adopters without widening the factory boundary", () => {
    const adopters = storeModules().filter((path) =>
      source(path).includes("createDualBackendStore("),
    );
    expect(Object.keys(FACTORY_ADOPTIONS).sort()).toEqual(adopters.sort());
    for (const [path, evidence] of Object.entries(FACTORY_ADOPTIONS)) {
      expect(evidence.disposition.startsWith("Retain."), path).toBe(true);
      for (const test of evidence.tests)
        expect(source(test), test).toMatch(/\b(?:it|test)(?:\.each|\()/);
      const calls: ts.CallExpression[] = [];
      function visit(node: ts.Node): void {
        if (
          ts.isCallExpression(node) &&
          ts.isIdentifier(node.expression) &&
          node.expression.text === "createDualBackendStore"
        )
          calls.push(node);
        ts.forEachChild(node, visit);
      }
      visit(parsedSource(path));
      expect(calls, path).toHaveLength(1);
      expect(calls[0].arguments, path).toHaveLength(2);
      expect(calls[0].arguments.every(ts.isIdentifier), path).toBe(true);
    }
  });

  it("records every inline backend choice outside the store modules", () => {
    const paths = ["app", "components", "lib", "scripts"]
      .flatMap(productionModules)
      .filter((path) => path !== SEAM && !Object.hasOwn(STORE_INVENTORY, path))
      .filter((path) => inlineBackendCalls(path) > 0);
    expect(Object.keys(INLINE_BACKEND_INVENTORY).sort()).toEqual(paths.sort());
    for (const path of paths) {
      expect(inlineBackendCalls(path), path).toBe(
        INLINE_BACKEND_INVENTORY[path].inlineBranches,
      );
    }
  });

  it.each(Object.entries({ ...STORE_INVENTORY, ...INLINE_BACKEND_INVENTORY }))(
    "%s names its interface, policy owner and available reset helpers",
    (path, row) => {
      const names = exportedNames(path);
      expect(row.interface.length, path).toBeGreaterThan(0);
      for (const name of row.interface) {
        if (name === "<module>") expect(names, path).toEqual([]);
        else expect(names, `${path}: interface ${name}`).toContain(name);
      }
      for (const field of [
        "fallback",
        "schemaMissing",
        "authorizationOwner",
      ] as const) {
        expect(row[field].trim(), `${path}: ${field}`).not.toBe("");
      }
      const resets = names
        .filter((name) => /reset|unload.*Tests/i.test(name))
        .sort();
      expect(row.resetHelper ? [...row.resetHelper].sort() : [], path).toEqual(
        resets,
      );
      if (row.selector === "inline")
        expect(row.reason?.trim(), path).toBeTruthy();
    },
  );
});

const SEAM_SELECTORS = ["selectStore(", "createDualBackendStore("];

describe("store inventory (#727)", () => {
  const modules = storeModules();

  it("names every lib/*Store*.ts module, and nothing else", () => {
    expect(Object.keys(STORE_INVENTORY).sort()).toEqual(modules);
  });

  it("every exception carries a reason", () => {
    for (const [path, row] of Object.entries(STORE_INVENTORY)) {
      const needsReason =
        row.selector !== "selectStore" ||
        row.class === "legacy-exception" ||
        (row.inlineBranches ?? 0) > 0;
      if (needsReason) {
        expect(row.reason?.trim(), `${path} needs a reason`).toBeTruthy();
      }
    }
  });

  it.each(modules)("%s matches its inventory row", (path) => {
    const row = STORE_INVENTORY[path];
    const src = source(path);
    const usesSeam = SEAM_SELECTORS.some((needle) => src.includes(needle));
    const inline = count(src, "isSupabaseConfigured()");

    if (row.selector === "selectStore") {
      expect(
        usesSeam,
        `${path} declares selector selectStore but does not call it`,
      ).toBe(true);
    } else if (row.selector === "inline") {
      expect(
        usesSeam,
        `${path} calls the seam; move its row to selector selectStore`,
      ).toBe(false);
      expect(
        inline,
        `${path} declares inline selection but never asks isSupabaseConfigured()`,
      ).toBeGreaterThan(0);
    } else {
      expect(usesSeam, `${path} selects a backend; its row says none`).toBe(
        false,
      );
      expect(
        inline,
        `${path} branches on isSupabaseConfigured(); its row says none`,
      ).toBe(0);
    }

    expect(
      inline,
      `${path} has ${inline} isSupabaseConfigured() call site(s); its row declares ${row.inlineBranches ?? 0}. Ride the seam or say why in the row.`,
    ).toBe(row.inlineBranches ?? 0);
  });

  it.each(modules)("%s redeclares nothing the seam owns", (path) => {
    const src = source(path);
    expect(src, `${path}: import admin from lib/storeBackend`).not.toMatch(
      /^(?:export )?function admin\(\)/m,
    );
    expect(
      src,
      `${path}: import errorMessage from lib/storeBackend`,
    ).not.toMatch(/^(?:export )?function errorMessage\(/m);
    expect(
      src,
      `${path}: use missingTables(...) from lib/storeBackend`,
    ).not.toContain("Could not find the table");
    expect(src, `${path}: use selectStore from lib/storeBackend`).not.toMatch(
      /isSupabaseConfigured\(\)\s*\?\s*\w+\s*:\s*\w+;/,
    );
  });

  it("the seam imports no domain module", () => {
    const imports = [...source(SEAM).matchAll(/from "([^"]+)"/g)].map(
      (m) => m[1],
    );
    expect(imports.sort()).toEqual(
      ["@/lib/deploymentEnv", "@/lib/supabase", "@supabase/supabase-js"].sort(),
    );
  });
});
