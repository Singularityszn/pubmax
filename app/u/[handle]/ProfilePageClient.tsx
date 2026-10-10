"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { notFound, useRouter } from "next/navigation";
import { use, useEffect, useRef, useState, useSyncExternalStore } from "react";

import ClaimMomentWelcome from "@/components/profile/ClaimMomentWelcome";
import ContributionLanesCard from "@/components/profile/ContributionLanesCard";
import FirstActionsRow from "@/components/profile/FirstActionsRow";
import FollowButton from "@/components/profile/FollowButton";
import ProfileMessageButton from "@/components/messages/ProfileMessageButton";
import NextBadgeChips from "@/components/profile/NextBadgeChips";
import OutTonightBoard from "@/components/profile/OutTonightBoard";
import OutTonightCrewLine from "@/components/profile/OutTonightCrewLine";
import OutTonightToggle from "@/components/profile/OutTonightToggle";
import PintPassport from "@/components/profile/PintPassport";
import ProfileEditor from "@/components/profile/ProfileEditor";
import ProfileHeader from "@/components/profile/ProfileHeader";
import SocialLinksEditor from "@/components/profile/SocialLinksEditor";
import type { PublicSocialLink } from "@/lib/socialConnections";
import SavedPubList from "@/components/profile/SavedPubList";
import WantedList from "@/components/wanted/WantedList";
import YourContributionsCard from "@/components/profile/YourContributionsCard";
import SiteNav from "@/components/nav/SiteNav";
import SiteNavMore, {
  type SiteNavMoreItem,
} from "@/components/nav/SiteNavMore";
import { useAuth } from "@/components/auth/AuthProvider";
import { useViewerHandle } from "@/components/auth/useViewerHandle";
import { useViewerSession } from "@/components/auth/useViewerSession";
import EmptyState from "@/components/ui/empty-state";
import { ACCOUNT_VISIBILITY_COPY } from "@/lib/accountVisibility";
import { getAccessToken } from "@/lib/authClient";
import { authedFetch } from "@/lib/authedFetch";
import { readProviderIdentityRevision } from "@/lib/authProviderRevision";
import { isLimitedProfileProjection } from "@/lib/profileVisibility";
import {
  AUTHOR_CRAWL_LIST_DEFAULT_LIMIT,
  AUTHOR_CRAWL_LIST_MAX_LIMIT,
  ownUnlistedCrawlsLabel,
} from "@/lib/authorCrawlList";
import { syncDeviceHandle } from "@/lib/identityClient";
import { isPubmaxxHandleImpersonationBlock } from "@/lib/pubmaxxIdentity";
import { accountClaimReturnToFromUrl } from "@/lib/accountClaimReturnTo";
import { BADGE_EVENTS } from "@/lib/badgeEvents";
import {
  BADGE_EVENT_OPT_INS_STORAGE_KEY,
  addBadgeEventOptIn,
  parseBadgeEventOptIns,
} from "@/lib/badgeEventOptIn";
import type { FollowCounts } from "@/lib/followStore";
import { buildPassport, hasPassportAreas } from "@/lib/passport";
import { buildProfileBadgeEventOptions } from "@/lib/profileBadgeEventGate";
import { discardBody } from "@/lib/responseBody";
import { revealWhenMounted } from "@/lib/revealWhenMounted";
import { loadSurfaceJson } from "@/lib/surfaceDataCache";
import { useSocialFriendsLaunch } from "@/lib/useSocialFriendsLaunch";
import {
  deriveProfileFromDrops,
  handleIsAdoptable,
  normalizeHandle,
  profileStats,
  withStoredProfile,
  type Profile,
  type ProfileDrop,
  type PublicProfile,
  type PublicProfileReadState,
} from "@/lib/profiles";
import {
  fetchFollowedListsForHandle,
  fetchSavedForHandle,
  groupDTOsByList,
  savedByList,
  type FollowedSavedListDTO,
  type ListType,
  type SavedPub,
  type SavedPubDTO,
} from "@/lib/savedPubs";
import { venueMapUrl } from "@/lib/venueMapUrl";
import { currentMode, modeEnablesLegacy } from "@/lib/viewMode";

import "./profile.css";

// Account settings, crews and the timeline are not the identity-loading
// paint. Static imports pulled their CSS and JS into /u/you's first document
// after #1411 mounted Wanted across that paint. Load them after the document
// is complete so they miss the interactive count.
const PubmaxxAccountHub = dynamic(
  () => import("@/components/profile/PubmaxxAccountHub"),
  { ssr: false },
);
const CrewsPanel = dynamic(
  () => import("@/components/social/CrewsPanel"),
  { ssr: false },
);
// The Diary list reads the owner-only API, so it loads only for the owner and
// stays out of every other profile's first paint.
const DiaryList = dynamic(() => import("@/components/diary/DiaryList"), { ssr: false });

const ProfileTimeline = dynamic(
  () => import("@/components/profile/ProfileTimeline"),
  { ssr: false },
);

// Public profile route /u/[handle]. Client/dynamic on purpose: no
// generateStaticParams, so the build never pre-renders every handle. It fetches
// the public Pint Drops feed, filters to this handle, synthesizes a demo
// profile, and renders the header, the handle's recent drops (photo-first), and
// their saved venues (from localStorage). It NEVER crashes: a missing handle, a
// failed fetch, or an empty result all resolve to a friendly state.

// The public drop DTO — kept loose; only the fields this page reads are named.
type PublicDrop = ProfileDrop & {
  venueId: string;
  // Enriched server-side by /api/pint-drops (withVenueNames): the human pub name
  // + a "/map?sel=…" url. Optional here because the local PublicDrop shape is
  // kept loose, but the API always sets both (name falls back to "A London pub").
  venueName?: string;
  venueMapUrl?: string;
  priceGbp?: number | null;
  pintPhotoUrl?: string | null;
  venuePhotoUrl?: string | null;
  passedDownNote?: string;
  drink?: string;
  era?: string;
  createdAt?: string;
};

type LoadState = "loading" | "ready" | "error" | "gone";

const BADGE_EVENT_IDS = BADGE_EVENTS.map((event) => event.id);
const BADGE_EVENT_OPT_IN_CHANGED = "pubmax-badge-event-opt-ins-changed";

function subscribeBadgeEventOptIns(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  window.addEventListener(BADGE_EVENT_OPT_IN_CHANGED, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(BADGE_EVENT_OPT_IN_CHANGED, onChange);
  };
}

function currentBadgeEventOptInRaw(): string {
  try {
    return localStorage.getItem(BADGE_EVENT_OPT_INS_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

function subscribeLegacyMode(onChange: () => void): () => void {
  const el = document.documentElement;
  const mo = new MutationObserver(onChange);
  mo.observe(el, { attributes: true, attributeFilter: ["data-mode", "data-legacy"] });
  window.addEventListener("storage", onChange);
  return () => {
    mo.disconnect();
    window.removeEventListener("storage", onChange);
  };
}

function currentLegacyMode(): boolean {
  if (typeof document !== "undefined" && document.documentElement.dataset.legacy === "1") {
    return true;
  }
  try {
    return modeEnablesLegacy(currentMode());
  } catch {
    return false;
  }
}

function isEventActive(event: (typeof BADGE_EVENTS)[number], now: string): boolean {
  const time = Date.parse(now);
  const startsAt = Date.parse(event.startsAt);
  const endsAt = Date.parse(event.endsAt);
  return (
    Number.isFinite(time) &&
    Number.isFinite(startsAt) &&
    Number.isFinite(endsAt) &&
    startsAt < endsAt &&
    time >= startsAt &&
    time < endsAt
  );
}

// localStorage fallback → DTO groups. The client has no server venue index, so a
// local-only save renders its id as the name (the demo degrade for a signed-out /
// offline viewer); the durable path is the one that carries real names. The map
// url is still correct (?sel=<id>), so the link works either way.
function localSavedDTOs(): Partial<Record<ListType, SavedPubDTO[]>> {
  const local: Partial<Record<ListType, SavedPub[]>> = savedByList();
  const groups: Partial<Record<ListType, SavedPubDTO[]>> = {};
  for (const key of Object.keys(local) as ListType[]) {
    groups[key] = (local[key] ?? []).map((pub) => ({
      venueId: pub.venueId,
      venueName: pub.venueId,
      venueMapUrl: venueMapUrl(pub.venueId),
      listType: pub.listType,
      note: pub.note,
      savedAt: pub.savedAt,
    }));
  }
  return groups;
}

// "you" is the sentinel handle the nav uses (/u/you) before a viewer handle is
// known. It is NOT a real person's handle - it means "the current viewer". A
// signed-in account handle or signed-out device handle redirects /u/you to the
// real profile; without either, /u/you renders the first-run passport (story 30).
const YOU_SENTINEL = "you";

/**
 * The You tab's one sign-in door, in the shape /social and /messages already
 * use. `from` returns the reader here once the session lands, so signing in
 * from the account tab does not park them on the front page.
 */
export const YOU_SIGN_IN_HREF = "/login?mode=signin&from=%2Fu%2Fyou";

export type ProfileSurface =
  | "missing"
  | "identity-loading"
  | "you-invitation"
  | "gone"
  | "error"
  | "profile";

export function profileSurfaceFor({
  routeHandle,
  identityResolved,
  hasUser,
  viewerHandle,
  state,
}: {
  routeHandle: string;
  identityResolved: boolean;
  hasUser: boolean;
  viewerHandle: string;
  state: LoadState;
}): ProfileSurface {
  if (!routeHandle) return "missing";
  const isYouRoute = routeHandle === YOU_SENTINEL;
  if (isYouRoute && identityResolved && !hasUser && viewerHandle === "") {
    return "you-invitation";
  }
  if (isYouRoute && (!identityResolved || Boolean(viewerHandle))) {
    return "identity-loading";
  }
  if (state === "gone") return "gone";
  if (state === "error") return "error";
  return "profile";
}

export function shouldShowContributionClaimNudge({
  isOwnProfile,
  identityResolved,
  hasUser,
}: {
  isOwnProfile: boolean;
  identityResolved: boolean;
  hasUser: boolean;
}): boolean {
  return isOwnProfile && identityResolved && !hasUser;
}

export function profileClaimOfferVisible({
  isAnonymous,
  isYouRoute,
  canAdoptHandle,
}: {
  isAnonymous: boolean;
  isYouRoute: boolean;
  canAdoptHandle: boolean;
}): boolean {
  return isAnonymous && !isYouRoute && canAdoptHandle;
}

export function ProfileClaimOffer({ onClaim }: { onClaim: () => void }) {
  return (
    <button type="button" className="profileClaimBtn" data-primary-action="" onClick={onClaim}>
      Claim this handle
    </button>
  );
}

export function ProfileFollowBoundary({
  friendsLaunchEnabled,
  isAnonymous,
  routeHandle,
  viewerHandle,
  following,
  followsViewer,
  onCountsChange,
}: {
  friendsLaunchEnabled: boolean;
  isAnonymous: boolean;
  routeHandle: string;
  viewerHandle: string;
  following: boolean;
  followsViewer: boolean;
  onCountsChange: (counts: FollowCounts) => void;
}): React.JSX.Element | null {
  if (!friendsLaunchEnabled) return null;
  if (isAnonymous) {
    return (
      <Link
        className="profileFollowSignIn"
        data-primary-action=""
        href={`/login?mode=signin&from=${encodeURIComponent(`/u/${routeHandle}`)}`}
      >
        Sign in to follow
      </Link>
    );
  }
  if (!viewerHandle) {
    return (
      <Link className="profileFollowSignIn" data-primary-action="" href="/u/you#account-settings">
        Claim a handle to follow
      </Link>
    );
  }
  return (
    <FollowButton
      key={`${routeHandle}:${following}:${followsViewer}`}
      targetHandle={routeHandle}
      followerHandle={viewerHandle}
      initialFollowing={following}
      followsViewer={followsViewer}
      onCountsChange={onCountsChange}
    />
  );
}

type ProfileSocialData = {
  socialLinks: readonly PublicSocialLink[];
  counts: FollowCounts | null;
  following: boolean;
  followsViewer: boolean;
};

export function profileSocialDataForLaunch(
  friendsLaunchEnabled: boolean,
  data: ProfileSocialData,
): ProfileSocialData {
  return friendsLaunchEnabled
    ? data
    : { socialLinks: [], counts: null, following: false, followsViewer: false };
}

export function YouSignedOutSurface({
  nightMemoriesInvite,
}: {
  nightMemoriesInvite: boolean;
}) {
  return (
    <section className="youIdentityIntro" aria-labelledby="you-title">
      <div className="youIdentityAvatar" aria-hidden="true">PXX</div>
      <div>
        <p className="profileSectionKicker">Your PUBMAXX identity</p>
        <h1 id="you-title">Make the night yours.</h1>
        <p>Claim a unique @handle, meet your Pub Pal, and keep every moment in one place.</p>
        {nightMemoriesInvite ? (
          <p className="youMemoriesInvite" role="status">
            Private Memories need a claimed @handle on your account. Claim yours below to keep nights in one place.
          </p>
        ) : null}
      </div>
      {/* ONE primary on the page (docs/design/LAUNCH_SCREENS.md): the claim.
          The hero keeps its own composition, so the mark rides the control.

          It is a LINK TO /login, not an in-page anchor. The anchor scrolled the
          reader down to the account block, which signed out is a restatement of
          the same invitation, so the You tab's only call to action landed on
          itself; the full nav account card is desktop-only at 640px
          (`.siteNavBar .authUser:not(.authUserNav)`). This is the door /social and /messages
          already open. */}
      <div className="youIdentityActions">
        <Link href={YOU_SIGN_IN_HREF} data-primary-action="">Claim your @handle</Link>
        <Link prefetch={false} href="/pal">Meet your Pub Pal</Link>
      </div>
    </section>
  );
}

function isNightMemoriesHash(hash: string): boolean {
  return hash.replace(/^#/, "").toLowerCase() === "night-memories";
}

function subscribeDocumentComplete(onStoreChange: () => void): () => void {
  if (document.readyState === "complete") return () => {};
  window.addEventListener("load", onStoreChange);
  return () => window.removeEventListener("load", onStoreChange);
}

/** True only after `window` `load`, so post-paint chunks start after the count. */
function useDocumentComplete(): boolean {
  return useSyncExternalStore(
    subscribeDocumentComplete,
    () => document.readyState === "complete",
    () => false,
  );
}

export default function ProfilePageClient({ params }: { params: Promise<{ handle: string }> }) {
  // Route params are a promise in the App Router; unwrap with `use`.
  const routeHandle = normalizeHandle(use(params)?.handle);
  const isYouRoute = routeHandle === YOU_SENTINEL;
  const router = useRouter();
  const documentComplete = useDocumentComplete();
  const { accountRevision, user, identityResolved, loading: sessionLoading, signOut } = useAuth();
  const viewerSession = useViewerSession();
  const socialFriendsLaunchEnabled = useSocialFriendsLaunch();
  const followKey = `${accountRevision}:${routeHandle}`;
  const storedBadgeEventOptInRaw = useSyncExternalStore(
    subscribeBadgeEventOptIns,
    currentBadgeEventOptInRaw,
    () => "",
  );
  const legacyMode = useSyncExternalStore(subscribeLegacyMode, currentLegacyMode, () => true);
  const [badgeEventOptInOverride, setBadgeEventOptInOverride] = useState<string | null>(null);
  const [badgeEventsNow, setBadgeEventsNow] = useState(() => new Date().toISOString());
  const badgeEventOptIns = parseBadgeEventOptIns(
    badgeEventOptInOverride ?? storedBadgeEventOptInRaw,
    BADGE_EVENT_IDS,
  );

  const geographyIdentityReady = identityResolved && !viewerSession.unresolved;
  const geographyUserId = user?.id ?? "";
  const geographyReadKey = `${accountRevision}:${geographyUserId}:${routeHandle}:${geographyIdentityReady}`;
  const [geographyRead, setGeographyRead] = useState<{
    key: string;
    drops: PublicDrop[];
    areas: string[];
  } | null>(null);
  const drops = geographyRead?.key === geographyReadKey ? geographyRead.drops : [];
  const passportAreas = geographyRead?.key === geographyReadKey ? geographyRead.areas : [];
  const [state, setState] = useState<LoadState>("loading");
  // Saved venues render as DTOs (venue NAME + map url). Durable when this handle has
  // server-side saves (/api/saved-pubs); otherwise the localStorage fallback
  // (savedByList) mapped into DTOs. Null until this handle's read answers for
  // this account, so the server render and the hydration paint match, neither
  // claims the list is empty before anyone has asked, and a previous account's
  // answer is never shown to the next one.
  const [savedRead, setSavedRead] = useState<{
    handle: string;
    accountRevision: number;
    groups: Partial<Record<ListType, SavedPubDTO[]>>;
  } | null>(null);
  const saved =
    savedRead?.handle === routeHandle && savedRead.accountRevision === accountRevision
      ? savedRead.groups
      : null;
  const [followedListsRead, setFollowedListsRead] = useState<{
    handle: string;
    accountRevision: number;
    lists: FollowedSavedListDTO[];
  } | null>(null);
  const followedLists =
    socialFriendsLaunchEnabled &&
    followedListsRead?.handle === routeHandle &&
    followedListsRead.accountRevision === accountRevision
      ? followedListsRead.lists
      : [];
  // The shared reader is the only place this surface may learn who is holding
  // the device. It returns null while identity is unresolved, so a cached
  // handle cannot name the previous account during session restore.
  const viewerHandleFromIdentity = useViewerHandle() ?? "";
  const viewerHandle = user ? viewerHandleFromIdentity : "";
  // The owner's own linked socials, public on their card by their own choice.
  const [socialLinks, setSocialLinks] = useState<PublicSocialLink[]>([]);
  // Durable profile row + follow graph, fetched from /api/profiles/[handle].
  // Null profile → fall back to the synthesized-from-drops identity.
  const [stored, setStored] = useState<PublicProfile | null>(null);
  // Which card the read was handed. A private account answers its full card to
  // its owner and to a mate, and the limited one to everybody else, so this is
  // what a reader needs to know that the fields below it are withheld rather
  // than unwritten.
  const [projection, setProjection] = useState<"full" | "limited">("full");
  // Whether that read has ANSWERED yet. Separate from `stored`, because
  // "nobody owns this handle" and "we could not find out" are two answers and
  // only the first one may offer a stranger the claim (`handleIsAdoptable`).
  const [publicRead, setPublicRead] = useState<PublicProfileReadState>("asking");
  const [counts, setCounts] = useState<FollowCounts | null>(null);
  const [following, setFollowing] = useState(false);
  // The mirror edge. Without it the header cannot tell "Mates" from
  // "Following", which is the only fact that says a lot formed.
  const [followsViewer, setFollowsViewer] = useState(false);
  const [followStateKey, setFollowStateKey] = useState(followKey);
  const accountRevisionRef = useRef(accountRevision);

  useEffect(() => {
    accountRevisionRef.current = accountRevision;
  }, [accountRevision]);

  // Owner-only "edit my profile" panel; opened from the header's Edit button.
  const [editing, setEditing] = useState(false);
  // Post-save confirmation shown back in view mode; clears itself shortly.
  const [savedNotice, setSavedNotice] = useState(false);

  useEffect(() => {
    if (followStateKey === followKey) return;
    void Promise.resolve().then(() => {
      setFollowStateKey(followKey);
      setFollowing(false);
      setFollowsViewer(false);
      // A CARD DOES NOT CROSS A BOUNDARY. `followKey` is the account and the
      // handle together, so a sign-in, a sign-out and a walk to another profile
      // all land here, and the card held in state belongs to neither the new
      // account nor the new handle. Keeping it would print the PREVIOUS
      // reader's full card of a private account until the next read answered,
      // which is exactly the leak `lib/surfaceDataCache.ts` drops its whole
      // store at an account boundary to avoid. The read state goes back to
      // "asking" with it, so no claim is offered off an answer about somebody
      // else.
      setStored(null);
      setProjection("full");
      setPublicRead("asking");
    });
  }, [followKey, followStateKey]);
  // PUBLIC crawl count for this handle, from /api/crawls?author= (the
  // crawl-story store is server-only, so a client route carries the number).
  // TRI-STATE: null is "the read could not answer", never a confident zero, and
  // it arrives on the SAME read as the rows below so the tile and the section
  // can never contradict each other.
  const [storyCount, setStoryCount] = useState<number | null>(0);
  // The crawls themselves, so the Crawls tile opens something rather than
  // announcing a number with nowhere to go.
  const [authoredCrawls, setAuthoredCrawls] = useState<
    Array<{ slug: string; title: string; stops: number | null }>
  >([]);
  // How many rows this page asked for, and whether the server says there are
  // more behind them. One "Show more" step widens the page to the published
  // ceiling; past that the count itself says how many are still unlisted here.
  // The widening carries the handle it was asked for, so arriving at another
  // profile starts again at the first page with no reset effect.
  const [widenedCrawlPage, setWidenedCrawlPage] = useState("");
  const crawlLimit =
    widenedCrawlPage === routeHandle
      ? AUTHOR_CRAWL_LIST_MAX_LIMIT
      : AUTHOR_CRAWL_LIST_DEFAULT_LIMIT;
  const [crawlsHaveMore, setCrawlsHaveMore] = useState(false);
  // The owner's own published total — public PLUS unlisted — for the passport's
  // story-posts stat. Only the verified owner is answered, so it stays null for
  // everybody else and the public number stands in.
  const [ownStoryCount, setOwnStoryCount] = useState<number | null>(null);
  // The unlisted crawls behind the difference between that tally and the public
  // Crawls figure. They are ROWS, not a second number: an owner who is told they
  // have two more than the page lists needs a way to reach those two.
  const [ownUnlistedCrawls, setOwnUnlistedCrawls] = useState<
    Array<{ slug: string; title: string; stops: number | null }>
  >([]);
  // How many unlisted crawls there are ALTOGETHER, which is what the line above
  // those rows names. TRI-STATE like every count on this lane. It is not the
  // page length: the page is capped, and a capped figure could not reconcile
  // with the published tally on the passport, which is the one job that line
  // has. The unlisted lane pages on its own bound for the same reason the public
  // one does, and the widening carries the handle it was asked for.
  const [ownUnlistedTotal, setOwnUnlistedTotal] = useState<number | null>(null);
  const [unlistedHaveMore, setUnlistedHaveMore] = useState(false);
  const [widenedUnlistedPage, setWidenedUnlistedPage] = useState("");
  const unlistedLimit =
    widenedUnlistedPage === routeHandle
      ? AUTHOR_CRAWL_LIST_MAX_LIMIT
      : AUTHOR_CRAWL_LIST_DEFAULT_LIMIT;
  const [nightMemoriesInvite, setNightMemoriesInvite] = useState(false);

  useEffect(() => {
    if (!routeHandle || isYouRoute) return;
    const controller = new AbortController();
    async function resolveAlias() {
      const response = await fetch(`/api/identity/handle/resolve?handle=${encodeURIComponent(routeHandle)}`, { signal: controller.signal }).catch(() => null);
      if (!response?.ok || controller.signal.aborted) return;
      const resolution = await response.json() as {
        status?: string;
        currentHandle?: string;
        redirect?: boolean;
      };
      // Auth user deleted: handle stays reserved, public profile is gone.
      if (resolution.status === "gone") {
        setState("gone");
        return;
      }
      if (resolution.redirect && resolution.currentHandle) {
        router.replace(`/u/${encodeURIComponent(resolution.currentHandle)}`);
      }
    }
    void resolveAlias();
    return () => controller.abort();
  }, [isYouRoute, routeHandle, router]);

  useEffect(() => {
    if (!geographyIdentityReady) return;
    const controller = new AbortController();
    const requestRevision = accountRevision;

    // Public snapshots retain complete geography beside the bounded timeline.
    // Authenticated reads bypass those snapshots because visibility depends on the viewer.
    async function load() {
      const url = `/api/pint-drops?author=${encodeURIComponent(routeHandle)}`;
      const apply = (body: unknown) => {
        if (controller.signal.aborted || accountRevisionRef.current !== requestRevision || !hasPassportAreas(body)) return false;
        const all = body.drops as PublicDrop[];
        const mine = all.filter((d) => normalizeHandle(d.handle) === routeHandle);
        setGeographyRead({ key: geographyReadKey, drops: mine, areas: body.passportAreas });
        // Tombstone wins over a later drops load: never paint a live profile.
        setState((prev) => (prev === "gone" ? prev : "ready"));
        return true;
      };
      let outcome: "snapshot" | "network" | "failed" = "failed";
      if (geographyUserId) {
        // Viewer-permitted history must never enter the shared public cache.
        try {
          const bearer = await getAccessToken();
          if (controller.signal.aborted || accountRevisionRef.current !== requestRevision) return;
          if (!bearer) throw new Error("Profile viewer credentials are unavailable");
          const response = await fetch(url, {
            signal: controller.signal,
            headers: { authorization: `Bearer ${bearer}` },
          });
          if (response.ok) {
            const body: unknown = await response.json();
            if (apply(body)) outcome = "network";
          } else {
            await discardBody(response);
          }
        } catch {
          // The existing read-error surface handles failed authenticated reads.
        }
      } else {
        outcome = await loadSurfaceJson<unknown>(
          url,
          { signal: controller.signal, validate: hasPassportAreas },
          apply,
        );
      }
      // Aborted requests and responses for an earlier account must not set an error state.
      if (outcome !== "failed" || controller.signal.aborted || accountRevisionRef.current !== requestRevision) return;
      setState((prev) => (prev === "gone" ? prev : "error"));
    }

    void load();
    return () => controller.abort();
  }, [accountRevision, geographyIdentityReady, geographyReadKey, geographyUserId, routeHandle]);

  // Load this handle's saved venues: durable first (the API resolves real venue
  // names for the profile's handle), falling back to the viewer's localStorage
  // view mapped into DTOs. Done in an async callback (not the synchronous effect
  // body) so setState only runs in async work (react-hooks rule).
  //
  // The read is identity-bound, and restoring the session aborts every
  // identity-bound request, so asking before the session settled got an aborted
  // read that fell back to the local view and never asked again: an owner's
  // full load said "No saved venues yet." It waits for the session to settle
  // (never for the canonical handle, which may not come back), asks again when
  // the account changes, and drops an answer whose account is gone.
  useEffect(() => {
    if (sessionLoading) return;
    const controller = new AbortController();
    async function loadSaved() {
      const durable = routeHandle
        ? await fetchSavedForHandle(routeHandle, controller.signal)
        : null;
      if (controller.signal.aborted) return;
      if (readProviderIdentityRevision() !== accountRevision) return;
      // Durable hit (even an empty list) is authoritative for this handle; only a
      // null (no handle / request failed) falls back to the local view.
      setSavedRead({
        handle: routeHandle,
        accountRevision,
        groups: durable ? groupDTOsByList(durable) : localSavedDTOs(),
      });
    }
    void loadSaved();
    return () => controller.abort();
  }, [accountRevision, routeHandle, sessionLoading]);

  // Followed saved lists are public social context for this handle's saved view:
  // "Ken follows Sam's Date Night list" appears on /u/ken. Reads are fail-soft,
  // matching the API contract, because followed lists are additive context. The
  // read is identity-bound like the saved venues above, so it waits for the
  // session the same way.
  useEffect(() => {
    if (!socialFriendsLaunchEnabled || sessionLoading) return;
    const controller = new AbortController();
    async function loadFollowedLists() {
      const lists = routeHandle
        ? await fetchFollowedListsForHandle(routeHandle, controller.signal)
        : [];
      if (controller.signal.aborted) return;
      if (readProviderIdentityRevision() !== accountRevision) return;
      setFollowedListsRead({ handle: routeHandle, accountRevision, lists });
    }
    void loadFollowedLists();
    return () => controller.abort();
  }, [accountRevision, routeHandle, sessionLoading, socialFriendsLaunchEnabled]);

  // This handle's public crawls and their total (story 35 authorship), from one
  // read so the tile and the listing agree. Best-effort: a failure leaves an
  // unknown count and no rows, so the passport still renders. Runs in an async
  // callback (not the sync effect body) so setState never fires synchronously in
  // the effect — matching the loadSaved / loadProfile pattern above.
  useEffect(() => {
    // /u/you is the sentinel (not a real handle) — it has no stories to count, and
    // the route redirects to the real handle once one is known. Skip the fetch.
    if (!routeHandle || routeHandle === YOU_SENTINEL) return;
    const controller = new AbortController();
    async function loadStoryCount() {
      // A held answer seeds the passport before the network replies.
      const outcome = await loadSurfaceJson<{
        count?: number | null;
        hasMore?: boolean;
        crawls?: Array<{ slug: string; title: string; stops: number | null }>;
      }>(
        `/api/crawls?author=${encodeURIComponent(routeHandle)}&limit=${crawlLimit}`,
        { signal: controller.signal },
        (body) => {
          const next = body?.count;
          setStoryCount(typeof next === "number" && Number.isFinite(next) ? next : null);
          setAuthoredCrawls(Array.isArray(body?.crawls) ? body.crawls : []);
          setCrawlsHaveMore(body?.hasMore === true);
        },
      );
      // Fail-soft, but never with the LAST handle's number: a load that answered
      // nothing at all clears the count rather than leaving one profile wearing
      // another's stories. A failed revalidate over a seeded answer is not that
      // case — the seed is this handle's own.
      if (outcome !== "failed" || controller.signal.aborted) return;
      setStoryCount(null);
      setAuthoredCrawls([]);
      setCrawlsHaveMore(false);
    }
    void loadStoryCount();
    return () => controller.abort();
  }, [routeHandle, crawlLimit]);

  // The owner's own published tally and the unlisted crawls it counts.
  // Authenticated and never surface-cached: it is a viewer-scoped answer, so it
  // may not be held in the shared snapshot store beside the public one. All of
  // it runs in an async callback so setState never fires synchronously in the
  // effect body. `limit=1` because the public page in this reply is not the one
  // rendered - the surface-cached read above owns that - so asking for ten rows
  // and their stop lookup would spend a second query on rows nobody reads.
  useEffect(() => {
    const viewerOwnsThisProfile = viewerHandle !== "" && viewerHandle === routeHandle;
    const controller = new AbortController();
    async function loadOwnStoryCount() {
      if (!viewerOwnsThisProfile || routeHandle === YOU_SENTINEL) {
        setOwnStoryCount(null);
        setOwnUnlistedCrawls([]);
        setOwnUnlistedTotal(null);
        setUnlistedHaveMore(false);
        return;
      }
      const response = await authedFetch(
        `/api/crawls?author=${encodeURIComponent(routeHandle)}&scope=own&limit=1&unlistedLimit=${unlistedLimit}`,
        { signal: controller.signal, cache: "no-store" }, { requiresIdentity: true },
      ).catch(() => null);
      if (!response?.ok || controller.signal.aborted) {
        if (response) discardBody(response);
        return;
      }
      const body = (await response.json().catch(() => null)) as
        | {
            ownCount?: number | null;
            unlisted?: Array<{ slug: string; title: string; stops: number | null }>;
            unlistedTotal?: number | null;
            unlistedHasMore?: boolean;
          }
        | null;
      if (controller.signal.aborted) return;
      const own = body?.ownCount;
      setOwnStoryCount(typeof own === "number" && Number.isFinite(own) ? own : null);
      setOwnUnlistedCrawls(Array.isArray(body?.unlisted) ? body.unlisted : []);
      const unlistedTotal = body?.unlistedTotal;
      setOwnUnlistedTotal(
        typeof unlistedTotal === "number" && Number.isFinite(unlistedTotal)
          ? unlistedTotal
          : null,
      );
      setUnlistedHaveMore(body?.unlistedHasMore === true);
    }
    void loadOwnStoryCount();
    return () => controller.abort();
  }, [routeHandle, unlistedLimit, viewerHandle]);

  // /u/you resolution: once viewer identity is known, redirect the sentinel
  // route to its real profile. With no signed-out fallback, /u/you stays put and
  // renders the anonymous first-run passport below. Preserve any hash (e.g.
  // #night-memories from the landing CTA) so the destination can honour it.
  useEffect(() => {
    if (!isYouRoute) return;
    if (viewerHandle && viewerHandle !== YOU_SENTINEL) {
      const returnTo = accountClaimReturnToFromUrl(window.location.href);
      if (returnTo) {
        router.replace(returnTo);
        return;
      }
      const hash = window.location.hash;
      router.replace(`/u/${encodeURIComponent(viewerHandle)}${hash}`);
    }
  }, [isYouRoute, router, viewerHandle]);

  // Signed-out /u/you#night-memories: NightMemoryStudio only mounts on a signed-in
  // own profile, so the hash would be a dead end. Scroll to claim and say honestly
  // that Memories need a claimed handle first.
  useEffect(() => {
    if (!isYouRoute || viewerHandle !== "") return;
    if (!isNightMemoriesHash(window.location.hash)) return;
    // Frame callback keeps the effect body free of synchronous setState; the
    // scroll work below already happens against the painted DOM.
    const inviteFrame = window.requestAnimationFrame(() =>
      setNightMemoriesInvite(true),
    );
    void inviteFrame;
    const target = document.getElementById("account-settings");
    if (!target) return;
    window.history.replaceState(null, "", "#account-settings");
    target.scrollIntoView({ block: "start" });
    // The claim is selected by its PRIMARY mark rather than by its href: the
    // href is now the /login door, and a selector restating it would silently
    // stop focusing anything the next time that destination moves.
    const claimLink = document.querySelector<HTMLAnchorElement>(
      ".youIdentityActions a[data-primary-action]",
    );
    claimLink?.focus({ preventScroll: true });
  }, [isYouRoute, viewerHandle]);

  // Fetch the durable profile row + follow counts + whether the viewer follows
  // this handle. Best-effort: a failure just leaves the synthesized identity and
  // zeroed counts, so the page still renders.
  useEffect(() => {
    if (!routeHandle) return;
    const controller = new AbortController();
    const requestRevision = accountRevision;
    async function loadProfile() {
      const qs = viewerHandle
        ? `?viewer=${encodeURIComponent(viewerHandle)}`
        : "";
      // The viewer rides in the key, so one account never reads another's
      // follow edge; the whole store is dropped at an account boundary anyway
      // (lib/surfaceDataCache.ts). Failures keep the synthesized fallback.
      // A PRIVATE ACCOUNT'S OWN CARD RIDES THE BEARER, NEVER `?viewer=`. The
      // server seam derives its viewer from the token alone
      // (lib/profileVisibilityBoundary.server.ts), because a query parameter is
      // self-asserted, so a signed-in read has to send one or the owner of a
      // private profile would be handed the limited card on their own page. The
      // token is asked for only once this device HAS a handle, which is the same
      // condition that puts the viewer in the key above, so a signed-out read
      // waits for nothing.
      const bearer = viewerHandle
        ? await getAccessToken().catch(() => null)
        : null;
      const outcome = await loadSurfaceJson<{
        profile?: PublicProfile | null;
        projection?: string;
        status?: string;
        socialLinks?: PublicSocialLink[];
        counts?: FollowCounts | null;
        viewerFollowing?: boolean;
        followsViewer?: boolean;
      }>(
        `/api/profiles/${encodeURIComponent(routeHandle)}${qs}`,
        {
          signal: controller.signal,
          ...(bearer
            ? { init: { headers: { authorization: `Bearer ${bearer}` } } }
            : {}),
        },
        (body) => {
          if (controller.signal.aborted || accountRevisionRef.current !== requestRevision) return;
          const socialData = profileSocialDataForLaunch(socialFriendsLaunchEnabled, {
            socialLinks: body.socialLinks ?? [],
            counts: body.counts ?? null,
            following: Boolean(body.viewerFollowing),
            followsViewer: Boolean(body.followsViewer),
          });
          if (body.status === "gone") {
            setStored(null);
            setSocialLinks([...socialData.socialLinks]);
            setState("gone");
            setCounts(socialData.counts);
            return;
          }
          // Which of the two cards this read was handed, kept apart from the
          // choice the account made: a later read that comes back limited must
          // take a full card back down (`isLimitedProfileProjection` owns the
          // discriminant, so no surface restates it).
          setProjection(
            isLimitedProfileProjection({ projection: body.projection })
              ? "limited"
              : "full",
          );
          setStored(body.profile ?? null);
          setSocialLinks([...socialData.socialLinks]);
          setCounts(socialData.counts);
          setFollowing(socialData.following);
          setFollowsViewer(socialData.followsViewer);
        },
      );
      // What the PUBLIC read managed to say about this handle, kept apart from
      // what it said. `handleIsAdoptable` may only ever act on an answer.
      if (!controller.signal.aborted && accountRevisionRef.current === requestRevision) {
        setPublicRead(outcome === "failed" ? "failed" : "answered");
      }
    }
    void loadProfile();
    return () => controller.abort();
  }, [accountRevision, routeHandle, socialFriendsLaunchEnabled, viewerHandle]);

  // Overlay any durable, user-owned fields on top of the synthesized identity.
  const profile: Profile = withStoredProfile(
    deriveProfileFromDrops(routeHandle, drops as ProfileDrop[]),
    stored,
  );
  const followStateReady = followStateKey === followKey;
  const visibleSocialData = profileSocialDataForLaunch(socialFriendsLaunchEnabled, {
    socialLinks,
    counts,
    following: followStateReady && following,
    followsViewer: followStateReady && followsViewer,
  });
  const stats = profileStats(drops as ProfileDrop[]);
  const isOwnProfile = viewerHandle !== "" && viewerHandle === routeHandle;
  const identityReadyForSurface = identityResolved && !viewerSession.unresolved;
  const isAnonymous = identityReadyForSurface && viewerSession.signedOut;
  // A stranger may only adopt a handle NOBODY owns. The offer used to ride on
  // `isAnonymous` alone, so a signed-out visitor met "Claim this handle" under
  // a founding member's face, bio and number - and taking it wrote their handle
  // onto this device and opened the edit surface.
  const handleReserved =
    routeHandle !== "" &&
    routeHandle !== YOU_SENTINEL &&
    isPubmaxxHandleImpersonationBlock(routeHandle);
  const canAdoptHandle = handleIsAdoptable({
    read: publicRead,
    ownerProfile: stored,
    tombstoned: state === "gone",
    handleReserved,
  });
  useEffect(() => {
    if (!routeHandle || routeHandle === YOU_SENTINEL) return;
    if (handleReserved) notFound();
  }, [routeHandle, handleReserved]);

  // Signed-out /u/you: the viewer has no handle yet. This is an INVITATION, not a
  // profile — so it shows only the honest "make the night yours" intro + the
  // claim/account surface, never the pseudo-profile scaffolding (a "@you"
  // passport header, timeline, saved list) that reads like a bug (spec #393).
  const youSignedOut = isYouRoute && isAnonymous;
  // `/u/you` remains a sentinel for one render after a resolved handle arrives,
  // while the router moves to the account profile. Keep that handoff neutral so
  // the sentinel never paints the synthesized `You` card.
  const surface = profileSurfaceFor({
    routeHandle,
    identityResolved: identityReadyForSurface,
    hasUser: Boolean(user),
    viewerHandle,
    state,
  });
  const passportIsOwn = isOwnProfile || (isYouRoute && isAnonymous);
  const joinedBadgeEventIds = new Set(badgeEventOptIns.optedInEventIds);
  const joinableBadgeEvents =
    passportIsOwn && !legacyMode
      ? BADGE_EVENTS.filter(
          (event) => isEventActive(event, badgeEventsNow) && !joinedBadgeEventIds.has(event.id),
        )
      : [];

  // Pint Passport geography covers the complete visible author history. The
  // other drop statistics use the bounded timeline and the crawl-story count from
  // /api/crawls?author= (storyCount above). A durable crawl story IS the posted
  // crawl AND the story post — both passport inputs draw from the one authored-
  // story number per buildPassport's semantics. On the anonymous /u/you
  // first-run route, the passport reads as own and shows the "start yours" CTA.
  const passport = buildPassport(drops as ProfileDrop[], {
    areas: passportAreas,
    crawls: storyCount,
    // Story posts are what this author PUBLISHED, so the owner's own number
    // counts their unlisted crawls too. Everybody else sees the public one.
    storyPosts: ownStoryCount ?? storyCount,
    badgeEvents: buildProfileBadgeEventOptions({
      isOwnPassport: passportIsOwn,
      legacyMode,
      now: badgeEventsNow,
      optIns: badgeEventOptIns,
    }),
  });

  function joinBadgeEvent(eventId: string) {
    const now = new Date();
    const nowIso = now.toISOString();
    const event = BADGE_EVENTS.find((candidate) => candidate.id === eventId);
    // Re-check the window at click time: a Join button rendered before the
    // event ended must not persist a post-expiry opt-in (badgeEventsNow is
    // captured at mount and can be stale).
    setBadgeEventsNow(nowIso);
    if (!event || !isEventActive(event, nowIso)) return;
    const next = addBadgeEventOptIn(
      badgeEventOptInOverride ?? currentBadgeEventOptInRaw(),
      eventId,
      now,
      BADGE_EVENT_IDS,
    );
    let persisted = false;
    try {
      window.localStorage.setItem(BADGE_EVENT_OPT_INS_STORAGE_KEY, next.serialized);
      persisted = true;
    } catch {
      // Storage disabled/private mode — keep the opt-in for this mounted session.
    }
    // Clear the optimistic override once the write lands so the store (which
    // also sees cross-tab "storage" updates) is the source of truth; only keep
    // the override as a session fallback when the write failed.
    setBadgeEventOptInOverride(persisted ? null : next.serialized);
    window.dispatchEvent(new Event(BADGE_EVENT_OPT_IN_CHANGED));
  }

  // Claim this handle: an anonymous visitor adopts the route handle as their own
  // demo identity (localStorage `pubmax_handle`), the same identity that authors
  // a pint drop or a follow. This remains a client-only, self-asserted signed-out
  // claim. Signed-in ownership comes from the account handle instead.
  function claimHandle() {
    try {
      syncDeviceHandle(window.localStorage, routeHandle);
    } catch {
      // storage disabled — the in-memory claim below still owns this session
    }
    setEditing(true);
  }

  useEffect(() => {
    if (!savedNotice) return;
    const timeout = window.setTimeout(() => setSavedNotice(false), 4_000);
    return () => window.clearTimeout(timeout);
  }, [savedNotice]);

  // Editing must be unmistakable: opening it lands the reader on the editing
  // surface itself, not wherever the toggle happened to sit.
  function openEditor() {
    setSavedNotice(false);
    setEditing(true);
    window.requestAnimationFrame(() => {
      document
        .getElementById("profile-editing")
        ?.scrollIntoView({ block: "start" });
    });
  }

  // "Edit profile" is reachable from the site nav, which can only carry a URL,
  // so ?edit=1 opens the editing surface on arrival. The parameter is spent
  // once: it is stripped straight away, so Back never re-opens the editor.
  useEffect(() => {
    if (!isOwnProfile) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("edit") !== "1") return;
    url.searchParams.delete("edit");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    const frame = window.requestAnimationFrame(() => {
      setEditing(true);
      window.requestAnimationFrame(() => {
        document.getElementById("profile-editing")?.scrollIntoView({ block: "start" });
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [isOwnProfile]);

  // A stored row changed under an OPEN editor: a photo went up, a cover moved,
  // one came down. The header repaints from the reply without a refetch and the
  // editor stays exactly where it is.
  //
  // THE DEFECT THIS SPLIT FIXES: this and `handleSaved` were one callback, so
  // every image write also ran `setEditing(false)`. Choosing a profile photo on
  // a phone threw the owner out to the read-only profile, and somebody there to
  // change five things had to re-open the editor after the first.
  function handleProfileChanged(next: PublicProfile) {
    setStored(next);
  }

  // The FORM was saved, which is the end of an editing session: apply the row,
  // return to view mode, and say so.
  function handleSaved(saved: PublicProfile) {
    setStored(saved);
    setEditing(false);
    setSavedNotice(true);
  }

  // Header action slot. Three mutually-exclusive states, and in each ONE control
  // carries `data-primary-action` (docs/design/LAUNCH_SCREENS.md: Edit profile
  // for the owner, Follow for a visitor). The profile hero keeps its own
  // composition (the face over the band's edge, the name beside it), which the
  // Screen primitive's fixed order cannot hold, so the mark rides the control.
  //  • own profile  → Edit (toggles the inline editor)
  //  • anonymous, on a handle NOBODY owns → Claim this handle (adopt, then edit)
  //  • other viewer → Follow
  // The claim's second condition is the whole point: it is an offer about an
  // EMPTY handle, so it may only be made once the public read has answered and
  // reported no owner (`handleIsAdoptable`). An anonymous viewer on somebody
  // else's profile falls through to Follow, which is what they came for.
  // On the /u/you sentinel route we never offer "Claim this handle" ("you" isn't
  // a real handle to adopt) - the passport's first-run CTA drives the next step.
  // An unresolved viewer gets no identity-bearing action at all: a Follow
  // button carrying the wrong actor is worse than one that arrives a beat late.
  function headerActionSlot() {
    return !identityReadyForSurface ? null : isOwnProfile ? (
    <>
      {/* The crew-invite loop's entry point: your own add link. Opening it shows
          the share surface (ConfirmFollow's self branch), so a friend can add
          you at the table and you become each other's lot. */}
      {socialFriendsLaunchEnabled ? (
        <Link className="profileInviteLink" href={`/add/${encodeURIComponent(routeHandle)}`}>
          Invite your lot
        </Link>
      ) : null}
      <button
        type="button"
        className="profileEditToggle"
        data-primary-action=""
        aria-expanded={editing}
        onClick={() => {
          if (editing) {
            setEditing(false);
          } else {
            openEditor();
          }
        }}
      >
        {editing ? "Close editor" : "Edit profile"}
      </button>
      <Link prefetch={false} className="profilePalLink" href="/pal">Meet your Pub Pal</Link>
    </>
  ) : profileClaimOfferVisible({ isAnonymous, isYouRoute, canAdoptHandle }) ? (
    <ProfileClaimOffer onClaim={claimHandle} />
  ) : isYouRoute ? null : (
    <>
      <ProfileFollowBoundary
        friendsLaunchEnabled={socialFriendsLaunchEnabled}
        isAnonymous={isAnonymous}
        routeHandle={routeHandle}
        viewerHandle={viewerHandle}
        following={visibleSocialData.following}
        followsViewer={visibleSocialData.followsViewer}
        onCountsChange={setCounts}
      />
      {/* E4: additive 1:1 messaging control. Only renders when the viewer has a
          handle distinct from this profile (the button self-guards). */}
      <ProfileMessageButton
        targetHandle={routeHandle}
        viewerHandle={viewerHandle}
      />
    </>
    );
  }
  const headerActions = headerActionSlot();

  function buildProfileOptions(): SiteNavMoreItem[] {
    return [
    {
      id: "edit-profile",
      label: "Edit profile",
      description: "Change your name, photos, bio, or what you're into",
      onSelect: openEditor,
    },
    {
      id: "analytics-settings",
      label: "Analytics choices",
      description: "Review optional usage analytics",
      onSelect: () => {
        // The block is inside the account hub, a dynamic import (#1421), so a
        // tap can land before it exists. The tap still moves the hash, and the
        // scroll waits for the block rather than doing nothing.
        window.history.replaceState(null, "", "#analytics-settings");
        revealWhenMounted(() => {
          const target = document.getElementById("analytics-settings");
          target?.scrollIntoView({ block: "start" });
          return Boolean(target);
        });
      },
    },
    {
      href: "/about",
      label: "About",
      description: "What PUBMAXX is for",
    },
    {
      href: "/privacy",
      label: "Privacy",
      description: "How PUBMAXX handles data",
    },
    {
      href: "/terms",
      label: "Terms",
      description: "Rules for using PUBMAXX",
    },
      ...(user
        ? [
            {
              id: "sign-out",
              label: "Sign out",
              description: "End this account session",
              onSelect: signOut,
            } satisfies SiteNavMoreItem,
          ]
        : []),
    ];
  }
  const profileOptions: SiteNavMoreItem[] = buildProfileOptions();

  // THE SURFACE IS PICKED ONCE, AND EACH ANSWER IS ITS OWN FUNCTION.
  //
  // `profileSurfaceFor` already decides which of these a reader gets; what sat
  // here was every one of their bodies inline in one ternary chain, so the
  // component scored a complexity of 91 against a ceiling of 35 and a reader
  // had to hold five surfaces at once to follow any of them. These are NESTED
  // functions rather than components on purpose, the way PubMap was taken
  // apart: ESLint scores complexity per function, a nested call leaves the
  // React element tree identical where a component would add a fibre, and the
  // source text the profile fences read stays in this file.
  function identityLoadingSurface() {
    return (
      <section className="profileIdentityLoadingSurface" aria-label="Loading your profile">
        <ProfileHeader
          profile={profile}
          stats={stats}
          viewerState="loading"
        />
      </section>
    );
  }

  function goneSurface() {
    return (
      <section className="profileGoneState" aria-labelledby="profile-gone-title">
        <p className="profileSectionKicker">@{routeHandle}</p>
        <h1 id="profile-gone-title">This account has left</h1>
        <p className="profileEmpty">
          The handle is still reserved. Past pints stay attributed, but
          there is no live profile here any more.
        </p>
        <p className="profileEmpty">
          <Link prefetch={false} href="/map" data-primary-action="">Back to the map</Link>
        </p>
      </section>
    );
  }

  function errorSurface() {
    return (
      <div className="profileErrorState">
        <ProfileHeader
          profile={profile}
          stats={stats}
          socialLinks={visibleSocialData.socialLinks}
          crawls={storyCount}
          memories={stats.memoriesPosted}
          drops={drops}
          followers={visibleSocialData.counts?.followers}
          following={visibleSocialData.counts?.following}
          actions={headerActions}
        />
        <p className="profileEmpty">
          Couldn&apos;t load pints right now. Try again.
        </p>
      </div>
    );
  }

  function seasonalBadgeSection() {
    return (
      !youSignedOut && joinableBadgeEvents.length ? (
        <section className="passportQuestOptIn" aria-labelledby="questOptInHeading">
          <div>
            <p className="passportQuestOptInKicker">Optional events</p>
            <h2 id="questOptInHeading" className="passportQuestOptInTitle">
              Seasonal badges
            </h2>
            <p className="passportQuestOptInCopy">
              Join only if you want them. Progress starts from the moment you join.
            </p>
          </div>
          <div className="passportQuestOptInActions">
            {joinableBadgeEvents.map((event) => (
              <button
                key={event.id}
                type="button"
                className="passportCta passportCtaPrimary"
                onClick={() => joinBadgeEvent(event.id)}
              >
                Join {event.label}
              </button>
            ))}
          </div>
        </section>
      ) : null
    );
  }

  function editingSection() {
    return (
      isOwnProfile && editing ? (
        <section
          id="profile-editing"
          className="profileEditingSurface"
          aria-labelledby="profile-editing-title"
        >
          <h2 id="profile-editing-title">Editing your profile</h2>
          <ProfileEditor
            handle={routeHandle}
            initial={{
              // Only pre-fill from durable, user-owned values — never the
              // synthesized bio/name (those are placeholders the user hasn't
              // authored, so the fields should read as empty and editable).
              displayName: stored?.displayName,
              bio: stored?.bio,
              homeCity: stored?.homeCity,
              avatarUrl: stored?.avatarUrl,
              coverUrl: stored?.coverUrl,
              coverUrls: stored?.coverUrls,
              favouriteDrink: stored?.favouriteDrink,
              interests: stored?.interests,
              workplace: stored?.workplace,
              // The one field that IS pre-filled from a value nobody typed: the
              // account is always one thing or the other, and the control has to
              // open on the answer the row already holds.
              visibility: stored?.visibility,
            }}
            onSaved={handleSaved}
            onProfileChanged={handleProfileChanged}
            onClose={() => setEditing(false)}
          />
          {/* Linked socials are public content the owner typed in,
              so they edit beside the public fields. Account
              plumbing lives in Account settings below. */}
          {user ? <SocialLinksEditor /> : null}
        </section>
      ) : null
    );
  }

  function timelineSection() {
    return (
      !youSignedOut ? (
        <section id="timeline" className="profileDropsSection" aria-labelledby="dropsHeading">
          <h2 id="dropsHeading" className="profileSectionHeading">
            Timeline
          </h2>

          {state === "loading" ? (
            <div className="profileTimelineSkel feedList" aria-hidden="true">
              {Array.from({ length: 2 }).map((_, i) => (
                <div key={i} className="feedCard feedCardSkeleton">
                  <div className="feedSkelHead">
                    <span className="feedSkelAvatar" />
                    <span className="feedSkelLine feedSkelLineShort" />
                  </div>
                  <div className="feedSkelPhoto" />
                  <div className="feedSkelLine" />
                </div>
              ))}
            </div>
          ) : drops.length === 0 ? (
            <p className="profileEmpty">No pints logged under @{routeHandle} yet.</p>
          ) : (
            <ProfileTimeline drops={drops as Array<Record<string, unknown>>} />
          )}
        </section>
      ) : null
    );
  }

  // The destination behind the Crawls tile. It prints only when this handle has
  // published one, so an empty section never sits under a zero - or when the
  // owner has an unlisted crawl, which lives nowhere else at all.
  function crawlsSection() {
    return !youSignedOut &&
      (authoredCrawls.length > 0 || ownUnlistedCrawls.length > 0) ? (
        <section
          id="crawl-stories"
          className="profileDropsSection"
          aria-labelledby="crawlStoriesHeading"
        >
          <h2 id="crawlStoriesHeading" className="profileSectionHeading">
            Crawls
          </h2>
          <ul className="profileCrawlList">
            {authoredCrawls.map((crawl) => (
              <li key={crawl.slug} className="profileCrawlRow">
                <Link href={`/crawls/${encodeURIComponent(crawl.slug)}`}>
                  {crawl.title}
                </Link>
                {typeof crawl.stops === "number" ? (
                  <span className="profileCrawlStops">
                    {crawl.stops} {crawl.stops === 1 ? "stop" : "stops"}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
          {/* The tile counts every public crawl, so a page that
              shows fewer has to SAY so rather than reading as the
              whole set. One step widens the page to the ceiling;
              past that the remainder is named plainly. */}
          {crawlsHaveMore ? (
            crawlLimit < AUTHOR_CRAWL_LIST_MAX_LIMIT ? (
              <button
                type="button"
                className="profileCrawlMore"
                onClick={() => setWidenedCrawlPage(routeHandle)}
              >
                Show more crawls
              </button>
            ) : typeof storyCount === "number" ? (
              <p className="profileEmpty">
                And {storyCount - authoredCrawls.length} more.
              </p>
            ) : null
          ) : null}
          {/* The owner's own unlisted crawls, and the ONE line that
              says why their published tally is larger than the
              public figure above it. A count with no way through
              would be a dead end wearing a number, so the line
              opens the rows it counts. Nobody but the verified
              owner is ever answered with them. */}
          {ownUnlistedCrawls.length > 0 ? (
            <details className="profileCrawlUnlisted">
              <summary>{ownUnlistedCrawlsLabel(ownUnlistedTotal)}</summary>
              <ul className="profileCrawlList">
                {ownUnlistedCrawls.map((crawl) => (
                  <li key={crawl.slug} className="profileCrawlRow">
                    <Link href={`/crawls/${encodeURIComponent(crawl.slug)}`}>
                      {crawl.title}
                    </Link>
                    {typeof crawl.stops === "number" ? (
                      <span className="profileCrawlStops">
                        {crawl.stops} {crawl.stops === 1 ? "stop" : "stops"}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
              {/* The line above names every unlisted crawl, so a
                  page holding fewer has to open the rest rather
                  than leaving the difference unreachable. One step
                  widens to the ceiling, then the remainder is named
                  the way the public lane names its own. */}
              {unlistedHaveMore ? (
                unlistedLimit < AUTHOR_CRAWL_LIST_MAX_LIMIT ? (
                  <button
                    type="button"
                    className="profileCrawlMore"
                    onClick={() => setWidenedUnlistedPage(routeHandle)}
                  >
                    Show more unlisted crawls
                  </button>
                ) : typeof ownUnlistedTotal === "number" ? (
                  <p className="profileEmpty">
                    And {ownUnlistedTotal - ownUnlistedCrawls.length} more.
                  </p>
                ) : null
              ) : null}
            </details>
          ) : null}
        </section>
      ) : null;
  }

  function readySurface() {
    return (
      <>
        {/* Desktop multi-pane (≥1024): identity/bio docks into a sticky left
            pane; passport, timeline and saved flow in the main pane. Both
            panes are display:contents below the breakpoint, so the phone
            layout is the same single column it was before. */}
        <div className="profileLayout">
            {isOwnProfile ? (
              <div className="profileOwnerUtilities">
                <SiteNavMore
                  className="profileOptions"
                  label="Options"
                  ariaLabel="Profile options"
                  items={profileOptions}
                />
              </div>
            ) : null}
            <div className="profileIdentityPane">
              <div className={isOwnProfile ? "youProfileIdentity" : undefined}>
                <ProfileHeader
                  profile={profile}
                  stats={stats}
                  socialLinks={visibleSocialData.socialLinks}
                  crawls={storyCount}
                  memories={stats.memoriesPosted}
                  drops={drops}
                  followers={visibleSocialData.counts?.followers}
                  following={visibleSocialData.counts?.following}
                  actions={headerActions}
                />
              </div>
            </div>

            <div className="profileContentPane">
              {/* The one place a withheld card SAYS it is withheld. Without it a
                  private profile reads as a person who has written nothing about
                  themselves, which is a different claim entirely. */}
              {projection === "limited" ? (
                <EmptyState title={ACCOUNT_VISIBILITY_COPY.strangerTitle}>
                  {ACCOUNT_VISIBILITY_COPY.strangerBody}
                </EmptyState>
              ) : null}

              {passportIsOwn && !youSignedOut ? (
                <div id="passport">
                  <PintPassport
                    handle={routeHandle}
                    displayName={profile.displayName}
                    data={passport}
                    isOwn={passportIsOwn}
                    hero
                  />
                </div>
              ) : null}

              {isOwnProfile ? (
                <YourContributionsCard
                  handle={routeHandle}
                  claimNudge={shouldShowContributionClaimNudge({
                    isOwnProfile,
                    identityResolved: identityReadyForSurface,
                    hasUser: Boolean(user),
                  })}
                />
              ) : null}

              {isOwnProfile ? (
                <>
                  <ClaimMomentWelcome />
                  <FirstActionsRow />
                  <ContributionLanesCard handle={routeHandle} />
                  <OutTonightToggle handle={routeHandle} />
                  <OutTonightBoard viewerHandle={routeHandle} />
                </>
              ) : null}

              {(isYouRoute || isOwnProfile) && !youSignedOut ? (
                <nav className="youProfileTabs" aria-label="Your profile sections">
                  <a href="#timeline">Moments</a>
                  <a href="#passport">Passport</a>
                  <a href="#wanted">Wanted</a>
                  <a href="#saved-pubs">Saved</a>
                  <a href="#account-settings">Account settings</a>
                </nav>
              ) : null}

              {!passportIsOwn ? (
                <PintPassport
                  handle={routeHandle}
                  displayName={profile.displayName}
                  data={passport}
                  isOwn={passportIsOwn}
                  hero={false}
                />
              ) : null}

              {!isOwnProfile && routeHandle && routeHandle !== YOU_SENTINEL ? (
                <OutTonightCrewLine ownerHandle={routeHandle} viewerHandle={viewerHandle} />
              ) : null}

              {/* Quest chips (Loop 2): next-badge progress for the viewed handle.
                  NextBadgeChips fetches public drops and filters by handle — works
                  for any profile with drops; renders nothing when empty. Own
                  profile also surfaces local "Crawls walked" from crawlCompletion. */}
              {routeHandle && routeHandle !== YOU_SENTINEL ? (
                <NextBadgeChips handle={routeHandle} showCrawlsWalked={isOwnProfile} />
              ) : null}

              {seasonalBadgeSection()}

              {isOwnProfile && savedNotice && !editing ? (
                <p className="profileSavedNotice" role="status">
                  Saved
                </p>
              ) : null}

              {editingSection()}

              {timelineSection()}

              {crawlsSection()}

              {/* /u/you redirects to the real handle the moment one is
                  known, so gating this on the sentinel alone left the
                  owner's own Wanted tab pointing at nothing. */}
              {isYouRoute || isOwnProfile ? <WantedList /> : null}

              {isYouRoute || isOwnProfile ? <DiaryList /> : null}

              {/* Your crews, on your own page only. It resolves the Social
                  gate itself and renders nothing when Social is in
                  preview, so this card never promises what the flag has
                  not opened. */}
              {isOwnProfile ? (
                <CrewsPanel viewerHandle={viewerHandle} resolveAccess />
              ) : null}

              {!youSignedOut ? (
                <div id="saved-pubs">
                  <SavedPubList
                    ownerHandle={isYouRoute ? viewerHandle : routeHandle}
                    groups={saved}
                    followedLists={followedLists}
                  />
                </div>
              ) : null}

              {isYouRoute || isOwnProfile ? (
                <div id="account-settings">
                  <PubmaxxAccountHub />
                </div>
              ) : null}
            </div>
        </div>

        <footer className="profileFloor">
          <p>
            PUBMAXX is for over-18s. Drink responsibly, know the facts at{" "}
            <a href="https://www.drinkaware.co.uk" rel="noreferrer">
              drinkaware.co.uk
            </a>
            .
          </p>
        </footer>
      </>
    );
  }

  function surfaceBody() {
    if (surface === "missing") {
      return <p className="profileEmpty">That profile link is missing a handle.</p>;
    }
    if (surface === "you-invitation") {
      return <YouSignedOutSurface nightMemoriesInvite={nightMemoriesInvite} />;
    }
    if (surface === "identity-loading") return identityLoadingSurface();
    if (surface === "gone") return goneSurface();
    if (surface === "error") return errorSurface();
    return readySurface();
  }

  return (
    <div className="lp profilePage">
      <SiteNav active="profile" />

      <main id="main" className="container profileMain pageHidesCreateFab">
        {surfaceBody()}
        {surface === "identity-loading" || surface === "you-invitation" ? (
          <WantedList
            key="you-wanted-panel"
            body={surface === "you-invitation" && documentComplete}
          />
        ) : null}
        {surface === "you-invitation" && documentComplete ? (
          <div id="account-settings">
            <PubmaxxAccountHub />
          </div>
        ) : null}
      </main>
    </div>
  );
}
