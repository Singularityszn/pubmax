"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactElement } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import { useViewerSession } from "@/components/auth/useViewerSession";
import FoundersWallLink from "@/components/founding/FoundersWallLink";
import IntentLink from "@/components/nav/IntentLink";
import SiteNav from "@/components/nav/SiteNav";
import CreatorListsLane from "@/components/social/CreatorListsLane";
import FindYourLot from "@/components/social/FindYourLot";
import CrewsPanelPlaceholder from "@/components/social/CrewsPanelPlaceholder";
import PeopleDirectory from "@/components/social/PeopleDirectory";
import ReelsPending from "@/components/social/ReelsPending";
import SharedSocialPostCard from "@/components/social/SocialPostCard";
import SocialMomentLink from "@/components/social/SocialMomentLink";
import SocialFeedLoading from "@/components/social/SocialFeedLoading";
import PubRankingPlaceholder from "@/components/social/PubRankingPlaceholder";
import StarterPacks from "@/components/social/StarterPacks";
import {
  SOCIAL_SIGN_IN_HREF,
  SocialViewerState,
  type SocialViewerPhase,
} from "@/components/social/SocialViewerState";
import EmptyState from "@/components/ui/empty-state";
import Screen from "@/components/ui/screen";
import SampleSkeleton from "@/components/ui/sample-skeleton";
import { Button } from "@/components/ui/button";
import { ADULT_SELF_ASSERTION_ACTION } from "@/lib/adultGate";
import { authedActionFetch } from "@/lib/authedFetch";
import { subscribeDeviceIdentity } from "@/lib/deviceAccountIdentity";
import type { CityRivalryEntry } from "@/lib/cityRivalry";
import type { CuratedCrawl } from "@/lib/curatedCrawls";
import { discardBody } from "@/lib/responseBody";
import { getCity } from "@/lib/cities";
import { nightAreasByCity } from "@/lib/nightAreas";
import { normalizeHandle } from "@/lib/profiles";
import { relativeTime } from "@/lib/relativeTime";
import type { SocialAccessState } from "@/lib/socialAccess";
import {
  adultSelfAssertionLine,
  SOCIAL_SIGNED_OUT_VALUE_LINE,
  socialBoundaryCopy,
  socialInviteMessage,
  socialLoadingLabel,
  socialSurfaceName,
  type SocialBoundaryCopyState,
} from "@/lib/socialLaunch";
import {
  socialFeedRequestHref,
  socialShellHref,
  type SocialShellState,
} from "@/lib/socialShell";
import type { SocialPostDTO } from "@/lib/socialPosts";
import { matchesSocialPostFeedSelection } from "@/lib/socialPostFeedMembership";
import type { SocialPostLane } from "@/lib/socialPostReason";
import type { FeaturedOpenTableResult } from "@/lib/featuredOpenTable.server";
import type { SocialAlternatives } from "@/lib/socialAlternatives";
import { forgetSurfaceSnapshot, forgetSurfaceSnapshots, readSurfaceSnapshot, writeSurfaceSnapshot } from "@/lib/surfaceDataCache";
import { chronological, mergeSocialPostHead, readSocialPostHead, readSocialPostWindow, SOCIAL_REFRESH_PAGE_CAP, type SocialPostPage, type SocialPostWindow } from "@/lib/socialPostWindow";

import { useLogInPublicDay } from "@/lib/useLogInPublicDay";

import "./social.css";
import MatesActivity from "./MatesActivity";
import PintDropRecovery from "./PintDropRecovery";
import SocialLondonLane from "./SocialLondonLane";
import SocialLondonEmpty from "./SocialLondonEmpty";
import { socialLazy } from "./SocialLazy";
import { SocialPostEditor } from "./SocialPostEditor";

// The Product Hunt log in public day (lib/logInPublicDay.ts): that day's real
// Pint Drops, after the Social layout. Its chunk loads only on the day.
const LogInPublicDay = dynamic(() => import("@/components/pintdrop/LogInPublicDay"), {
  ssr: false,
  loading: () => null,
});

// The wait keeps the shape of what it stands for: the Post door keeps its
// word and width, and tools that often draw nothing (an empty tag inbox, no
// posts of your own) are announced, not drawn, so the feed never jumps.
const SocialComposer = socialLazy(() => import("./SocialComposer"), "Post controls", <button type="button" className="socialButton socialComposeOpen" disabled>Post</button>);
const CrewsPanel = socialLazy(() => import("@/components/social/CrewsPanel"), "Your crews", <p role="status">Loading your crews…</p>);
const PubRankingPanel = socialLazy(() => import("@/components/social/PubRankingPanel"), "Your pub ranking", <p role="status">Loading your pub ranking…</p>);
const SocialTagInbox = socialLazy(() => import("./SocialTagInbox"), "Tags", <p role="status" className="sr-only">Loading tags…</p>);
const SocialOutbox = socialLazy(() => import("./SocialOutbox"), "Your posts", <p role="status" className="sr-only">Loading your posts…</p>);
const ReelsViewer = socialLazy(
  () => import("@/components/social/ReelsViewer"),
  "Video",
  <p role="status">Loading video…</p>,
  (state, { opener, onClose }) => <ReelsPending opener={opener} onClose={onClose}>{state}</ReelsPending>,
);

export type SocialBoundaryState = SocialBoundaryCopyState;

const ACCESS_STATES = new Set<SocialAccessState>([
  "preview",
  "sign_in_required",
  "age_verification_required",
  "verified",
  "suspended",
]);
const DiscoverBody = dynamic(() => import("@/app/discover/DiscoverPageClient").then(module => module.DiscoverBody), {
  loading: () => <p role="status">Loading pubs and pints…</p>,
});

type AccessLoadState = "checking" | SocialAccessState | "unavailable";
type FeedLoadState = "idle" | "loading" | "ready" | "error";
type ActivityLoadState = "idle" | "loading" | "ready" | "unavailable";

type SocialActivityItem = {
  id: string;
  kind: "cheer" | "comment" | "repost" | "quote" | "feature_update" | "tag_proposal";
  readAt: string | null;
  createdAt: string;
};

type SocialPageClientProps = {
  initialState: SocialShellState;
  rivalry: CityRivalryEntry[];
  heritageCrawls: CuratedCrawl[];
  friendsLaunchEnabled?: boolean;
  /**
   * Whether a stranger reads the London lane (`socialLondonLaneOpen`, read by
   * the server page). Absent means closed: a caller that does not say so gets
   * the sign-in door, never a public read it did not ask for.
   */
  londonLaneOpen?: boolean;
  publicAlternatives?: SocialAlternatives;
  featuredOpenTable?: FeaturedOpenTableResult;
};

class SocialFeedDenied extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseAccessState(value: unknown): SocialAccessState | null {
  if (!isRecord(value) || typeof value.state !== "string") return null;
  return ACCESS_STATES.has(value.state as SocialAccessState)
    ? (value.state as SocialAccessState)
    : null;
}

function parseAdultPrompt(value: unknown): boolean {
  return isRecord(value) && value.adultPrompt === true;
}

function parseDraftScope(value: unknown): string | null {
  return isRecord(value) && typeof value.draftScope === "string" && /^[A-Za-z0-9_-]{43}$/.test(value.draftScope)
    ? value.draftScope : null;
}

function parseViewerHandle(value: unknown): string | null {
  if (!isRecord(value) || typeof value.viewerHandle !== "string") return null;
  const handle = normalizeHandle(value.viewerHandle);
  return handle || null;
}

function parsePostPage(value: unknown): SocialPostPage | null {
  if (!isRecord(value) || !Array.isArray(value.posts)) return null;
  const posts: SocialPostDTO[] = [];
  for (const candidate of value.posts) {
    if (!isRecord(candidate) || !isRecord(candidate.author)) return null;
    if (
      typeof candidate.id !== "string" ||
      typeof candidate.body !== "string" ||
      typeof candidate.createdAt !== "string" ||
      (candidate.author.handle !== null && typeof candidate.author.handle !== "string") ||
      typeof candidate.ownedByViewer !== "boolean" ||
      (candidate.venueName !== null && typeof candidate.venueName !== "string") ||
      !Array.isArray(candidate.hashtags)
    )
      return null;
    posts.push(candidate as SocialPostDTO);
  }
  const nextCursor = value.nextCursor;
  if (nextCursor === null) return { posts, nextCursor, scannedThrough: null };
  const boundary = value.scannedThrough;
  if (typeof nextCursor !== "string" || !isRecord(boundary) || typeof boundary.id !== "string" || !boundary.id ||
    typeof boundary.createdAt !== "string" || !Number.isFinite(Date.parse(boundary.createdAt))) return null;
  return { posts, nextCursor, scannedThrough: { id: boundary.id, createdAt: boundary.createdAt } };
}

const ACTIVITY_KINDS = new Set<SocialActivityItem["kind"]>([
  "cheer",
  "comment",
  "repost",
  "quote",
  "feature_update",
  "tag_proposal",
]);

function parseActivityPage(value: unknown): SocialActivityItem[] | null {
  if (!isRecord(value) || !Array.isArray(value.items)) return null;
  const items: SocialActivityItem[] = [];
  for (const candidate of value.items) {
    if (
      !isRecord(candidate) ||
      typeof candidate.id !== "string" ||
      typeof candidate.kind !== "string" ||
      !ACTIVITY_KINDS.has(candidate.kind as SocialActivityItem["kind"]) ||
      (candidate.readAt !== null && typeof candidate.readAt !== "string") ||
      typeof candidate.createdAt !== "string"
    )
      return null;
    items.push({
      id: candidate.id,
      kind: candidate.kind as SocialActivityItem["kind"],
      readAt: candidate.readAt as string | null,
      createdAt: candidate.createdAt,
    });
  }
  return items;
}

async function readPostPage(href: string, signal: AbortSignal): Promise<SocialPostPage> {
  const response = await authedActionFetch(href, {
    cache: "no-store", credentials: "same-origin", signal,
  }, { requiresIdentity: true });
  if (!response.ok) {
    discardBody(response);
    throw [401, 403].includes(response.status)
      ? new SocialFeedDenied()
      : new Error("Social feed unavailable");
  }
  const page = parsePostPage(await response.json());
  if (!page) throw new Error("Social feed malformed");
  return page;
}

export function SocialAccessBoundary({
  state,
  onRetry,
  adultPrompt = false,
  onAssertAdult,
  assertBusy = false,
  assertError = null,
  friendsLaunchEnabled = true,
}: {
  state: SocialBoundaryState;
  onRetry?: () => void;
  /** The one tap is this account's way through (see `needsAdultSelfAssertion`). */
  adultPrompt?: boolean;
  onAssertAdult?: () => void;
  assertBusy?: boolean;
  assertError?: string | null;
  friendsLaunchEnabled?: boolean;
}) {
  const boundaryCopy = socialBoundaryCopy(state, friendsLaunchEnabled);
  const assertionLine = adultSelfAssertionLine(friendsLaunchEnabled);
  // One line and at most one quiet way onward, in the EmptyState idiom every
  // other boundary here shares. Never a dialog: arrival is not an admin form.
  // The Screen above owns the one painted action when the surface is open, so
  // nothing here is filled for sign-in: the door sits in the head, not twice.
  const asking = state === "age_verification_required" && adultPrompt;
  const action =
    state === "sign_in_required" ? (
      friendsLaunchEnabled ? undefined : (
        <Link href={SOCIAL_SIGN_IN_HREF}>Sign in</Link>
      )
    ) : asking && onAssertAdult ? (
      <button type="button" onClick={onAssertAdult} disabled={assertBusy}>
        {ADULT_SELF_ASSERTION_ACTION}
      </button>
    ) : state === "unavailable" && onRetry ? (
      <button type="button" onClick={onRetry}>
        Retry
      </button>
    ) : undefined;
  return (
    <section
      className="socialBoundary"
      role={state === "unavailable" ? "alert" : "status"}
    >
      <EmptyState title={asking ? assertionLine : boundaryCopy} action={action}>
        {asking && assertError ? <span role="alert">{assertError}</span> : undefined}
      </EmptyState>
    </section>
  );
}

/**
 * The Social page's card: the shared card plus the composer for the viewer's
 * own post. Kept under this name so every caller and test reads it unchanged.
 */
export function SocialPostCard({ post, lane, canEdit = false, draftScope, onEdited, interactive = false, onOpenVideo }: { post: SocialPostDTO; lane?: SocialPostLane; canEdit?: boolean; draftScope?: string | null; onEdited?: (post?: SocialPostDTO) => void; interactive?: boolean; onOpenVideo?: (postId: string, opener: HTMLButtonElement) => void }) {
  return (
    <SharedSocialPostCard
      post={post}
      lane={lane}
      interactive={interactive}
      onOpenVideo={onOpenVideo}
      editor={canEdit && draftScope && onEdited ? <SocialPostEditor key={`${draftScope}:${post.id}`} post={post} draftScope={draftScope} onSaved={onEdited} /> : null}
    />
  );
}

function PostsControls({
  state,
}: {
  state: Extract<SocialShellState, { tab: "posts" }>;
}) {
  const router = useRouter();
  const areaValue = state.feed === "nearby" ? (state.area ?? "") : "";
  return (
    <>
      <nav className="socialLaneNav" aria-label="Post lanes">
        <IntentLink
          href="/social"
          aria-current={state.feed === "following" ? "page" : undefined}
        >
          Following
        </IntentLink>
        <IntentLink
          href="/social?feed=nearby"
          aria-current={state.feed === "nearby" ? "page" : undefined}
        >
          Nearby
        </IntentLink>
        <IntentLink
          href="/social?feed=discover"
          aria-current={state.feed === "discover" ? "page" : undefined}
        >
          Across town
        </IntentLink>
      </nav>
      {state.feed === "nearby" ? (
        <label className="socialAreaField">
          <span>Nearby area</span>
          <select
            name="area"
            autoComplete="off"
            value={areaValue}
            onChange={(event) => {
              const area = event.currentTarget.value;
              router.push(
                socialShellHref({
                  tab: "posts",
                  feed: "nearby",
                  area: area ? (area as NonNullable<typeof state.area>) : null,
                }),
              );
            }}
          >
            <option value="">Choose area</option>
            {nightAreasByCity().map((group) => (
              <optgroup key={group.cityId} label={getCity(group.cityId).displayName}>
                {group.areas.map((area) => (
                  <option key={area.slug} value={area.slug}>
                    {area.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
      ) : null}
    </>
  );
}

const ACTIVITY_LABEL: Record<SocialActivityItem["kind"], string> = {
  cheer: "Cheers",
  comment: "comment",
  repost: "repost",
  quote: "quote",
  feature_update: "feature update",
  tag_proposal: "photo tag",
};

export function SocialContextRail({
  status = "idle",
  items = [],
}: {
  status?: ActivityLoadState;
  items?: SocialActivityItem[];
}) {
  if (
    status === "idle" ||
    status === "unavailable" ||
    items.length === 0
  ) {
    return null;
  }

  return (
    <aside
      className="socialContextRail"
      aria-labelledby="social-activity-title"
    >
      <h2 id="social-activity-title">Activity</h2>
      {status === "loading" ? (
        <p role="status">Loading…</p>
      ) : (
        <ul>
          {items.map((item) => {
            const when = relativeTime(item.createdAt);
            return (
              <li key={item.id}>
                <span>
                  {item.readAt
                    ? ACTIVITY_LABEL[item.kind]
                    : `New ${ACTIVITY_LABEL[item.kind]}`}
                </span>
                {when ? <time dateTime={item.createdAt}>{when}</time> : null}
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}

// This existing controller intentionally keeps one owner for Social state.
// Account changes remount it through the small boundary below.
// eslint-disable-next-line complexity
function SocialPageAccountState({
  initialState,
  rivalry,
  heritageCrawls,
  friendsLaunchEnabled = true,
  londonLaneOpen = false,
  publicAlternatives,
  featuredOpenTable,
}: SocialPageClientProps) {
  const surfaceName = socialSurfaceName(friendsLaunchEnabled);
  const { accountRevision, user, identityResolved, identityUnavailable, retryIdentity } = useAuth();
  const viewerSession = useViewerSession();
  const viewerPhase: SocialViewerPhase =
    viewerSession.unresolved
      ? "unresolved"
      : viewerSession.signedIn
        ? "resolved"
        : "signed-out";
  const [accessRead, setAccess] = useState<AccessLoadState>("checking");
  const access = viewerSession.signedIn && !identityResolved && friendsLaunchEnabled
    ? "checking"
    : accessRead;
  const [adultPrompt, setAdultPrompt] = useState(false);
  const [assertBusy, setAssertBusy] = useState(false);
  const [assertError, setAssertError] = useState<string | null>(null);
  const [draftScope, setDraftScope] = useState<string | null>(null);
  const [viewerHandle, setViewerHandle] = useState<string | null>(null);
  // Find your lot mounts in the door while the session resolves and in the
  // rail after, so the typed handle lives here and survives that swap.
  const [findLotQuery, setFindLotQuery] = useState("");
  const [submittedPost, setSubmittedPost] = useState<SocialPostDTO | null>(null);
  const [accessAttempt, setAccessAttempt] = useState(0);
  // The account revision the current access answer belongs to. A re-check for
  // that same account keeps the answer on screen until the new one lands, so
  // an identity write in another tab no longer drops this tab to "checking",
  // which unmounted an open composer under the reader's hands.
  const answeredRevision = useRef<number | null>(null);
  const [feedAttempt, setFeedAttempt] = useState(0);
  const [feedStatus, setFeedStatus] = useState<FeedLoadState>("idle");
  const [activityStatus, setActivityStatus] =
    useState<ActivityLoadState>("idle");
  const [activityItems, setActivityItems] = useState<SocialActivityItem[]>([]);
  const [posts, setPosts] = useState<SocialPostDTO[]>([]);
  const postsRef = useRef(posts);
  useLayoutEffect(() => { postsRef.current = posts; }, [posts]);
  const [reelStart, setReelStart] = useState<{ postId: string; opener: HTMLButtonElement } | null>(null);
  const openReel = (postId: string, opener: HTMLButtonElement) => setReelStart({ postId, opener });
  const reelPosts = useMemo(() => posts.filter((post) => post.video), [posts]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreFailed, setMoreFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [quietFeedFailure, setQuietFeedFailure] = useState(false);
  const [newPostsWaiting, setNewPostsWaiting] = useState(false);
  const backgroundController = useRef<AbortController | null>(null);
  const [loadedPages, setLoadedPages] = useState(0);
  const feedPending = useRef(false);
  const feedData = useRef<{ key: string; page: SocialPostWindow } | null>(null);
  const [activityRevision, setActivityRevision] = useState(accountRevision);
  const activityRequestId = useRef(0);
  const feedRequestId = useRef(0);
  const moreController = useRef<AbortController | null>(null);
  const explicitFeedRefreshKey = useRef<string | null>(null);
  const feedHref = useMemo(
    () => socialFeedRequestHref(initialState),
    [initialState],
  );
  const feedSnapshotPrefix = user ? `social-posts:${user.id}:` : null;
  const feedSnapshotKey = feedSnapshotPrefix && feedHref
    ? `${feedSnapshotPrefix}${accountRevision}:${feedHref}` : null;
  const committedFeed = useRef<{
    actor: string | null;
    revision: number;
    prefix: string | null;
    key: string | null;
    selection: SocialShellState;
    editable: boolean;
  } | null>(null);
  useLayoutEffect(() => {
    committedFeed.current = {
      actor: user?.id ?? null, revision: accountRevision,
      prefix: feedSnapshotPrefix, key: feedSnapshotKey, selection: initialState,
      editable: access === "verified" && identityResolved,
    };
    return () => { committedFeed.current = null; };
  }, [user?.id, accountRevision, feedSnapshotPrefix, feedSnapshotKey, initialState, access, identityResolved]);
  const requestExplicitFeedRefresh = useCallback(() => {
    if (!feedSnapshotKey || feedPending.current || moreController.current) return;
    feedPending.current = true;
    explicitFeedRefreshKey.current = feedSnapshotKey;
    setRefreshing(true);
    setFeedAttempt(value => value + 1);
  }, [feedSnapshotKey]);
  const denyFeed = useCallback(() => {
    if (feedSnapshotKey) forgetSurfaceSnapshot(feedSnapshotKey);
    feedData.current = null;
    setPosts([]);
    setNextCursor(null);
    answeredRevision.current = null;
    setAccess("unavailable");
  }, [feedSnapshotKey]);

  useEffect(() => {
    if (initialState.tab === "discover") return;
    if (!friendsLaunchEnabled || viewerSession.phase !== "signed-in" || !identityResolved) {
      answeredRevision.current = null;
    }
    if (!friendsLaunchEnabled) {
      void Promise.resolve().then(() => {
        setAccess("preview");
        setAdultPrompt(false);
        setDraftScope(null);
        setViewerHandle(null);
      });
      return;
    }
    if (viewerSession.phase === "unresolved") {
      void Promise.resolve().then(() => setAccess("checking"));
      return;
    }
    if (viewerSession.phase === "signed-out") {
      void Promise.resolve().then(() => {
        setAccess("sign_in_required");
        setAdultPrompt(false);
        setDraftScope(null);
        setViewerHandle(null);
      });
      return;
    }
    if (!identityResolved) {
      void Promise.resolve().then(() => setAccess("checking"));
      return;
    }

    const controller = new AbortController();
    const requestRevision = accountRevision;
    if (answeredRevision.current !== requestRevision) {
      void Promise.resolve().then(() => setAccess("checking"));
    }
    authedActionFetch("/api/social/access", {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    }, { requiresIdentity: true })
      .then(async (response) => {
        if (!response.ok) throw new Error("Social access unavailable");
        const body = await response.json();
        const state = parseAccessState(body);
        if (!state) throw new Error("Social access malformed");
        return {
          state,
          adultPrompt: parseAdultPrompt(body),
          draftScope: parseDraftScope(body),
          viewerHandle: parseViewerHandle(body),
        };
      })
      .then((result) => {
        if (controller.signal.aborted) return;
        answeredRevision.current = requestRevision;
        setAccess(result.state);
        setAdultPrompt(result.adultPrompt);
        setDraftScope(result.draftScope);
        setViewerHandle(result.viewerHandle);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError"))
          return;
        answeredRevision.current = null;
        setAccess("unavailable");
      });
    return () => controller.abort();
  }, [
    accessAttempt,
    accountRevision,
    friendsLaunchEnabled,
    identityResolved,
    initialState.tab,
    viewerSession.phase,
  ]);

  // Claiming a handle on this very page changes the answer the access route
  // gives, and the claim announces itself (`emitIdentityHandleChanged`). Without
  // this the boundary held until a full reload, so somebody who had just chosen
  // their handle was still told Social was not for them.
  useEffect(() => {
    if (initialState.tab === "discover") return;
    return subscribeDeviceIdentity(() =>
      setAccessAttempt((value) => value + 1),
    );
  }, [initialState.tab]);

  // The one tap. It records the assertion and then re-asks the access route,
  // which stays the only authority on what this viewer may see.
  const assertAdult = useCallback(() => {
    setAssertBusy(true);
    setAssertError(null);
    authedActionFetch("/api/identity/adult-assertion", {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
    }, { requiresIdentity: true })
      .then((response) => {
        discardBody(response);
        if (!response.ok) throw new Error("Adult assertion refused");
        setAdultPrompt(false);
        setAccessAttempt((value) => value + 1);
      })
      .catch(() => {
        setAssertError("We could not save that just now. Try again.");
      })
      .finally(() => setAssertBusy(false));
  }, []);

  useEffect(() => {
    backgroundController.current?.abort();
    backgroundController.current = null;
    moreController.current?.abort();
    const requestId = ++feedRequestId.current;
    const replaceDeepWindow = explicitFeedRefreshKey.current === feedSnapshotKey;
    explicitFeedRefreshKey.current = null;
    if (access !== "verified" || !feedHref || !feedSnapshotKey) {
      if (["preview", "sign_in_required", "age_verification_required", "suspended"].includes(access) && feedData.current) {
        forgetSurfaceSnapshot(feedData.current.key);
      }
      feedData.current = null;
      void Promise.resolve().then(() => {
        if (feedRequestId.current !== requestId) return;
        setPosts([]);
        setNextCursor(null);
        setFeedStatus("idle");
        setLoadingMore(false);
        setRefreshing(false);
        setLoadedPages(0);
      });
      return;
    }

    const previous = feedData.current?.key === feedSnapshotKey
      ? feedData.current.page : readSurfaceSnapshot<SocialPostWindow>(feedSnapshotKey);
    const keepDeepWindow = (previous?.pages ?? 0) > SOCIAL_REFRESH_PAGE_CAP && !replaceDeepWindow;
    const controller = new AbortController();
    feedPending.current = !keepDeepWindow;
    const cancel = () => {
      controller.abort();
      feedPending.current = false;
      moreController.current?.abort();
      moreController.current = null;
    };
    void Promise.resolve().then(() => {
      if (feedRequestId.current !== requestId) return;
      const sameWindow = feedData.current?.key === feedSnapshotKey;
      if (feedData.current?.key !== feedSnapshotKey) {
        feedData.current = previous ? { key: feedSnapshotKey, page: previous } : null;
      }
      const held = feedData.current?.page;
      setPosts(held?.posts ?? []);
      setNextCursor(held?.nextCursor ?? null);
      setLoadedPages(held?.pages ?? 0);
      setFeedStatus(current => (sameWindow || replaceDeepWindow) && current === "error" ? "error" : held ? "ready" : "loading");
      setLoadingMore(false);
      setRefreshing(!keepDeepWindow);
      if (!sameWindow) setQuietFeedFailure(false);
      if (!sameWindow) setNewPostsWaiting(false);
      if (!sameWindow) setMoreFailed(false);
    });
    if (keepDeepWindow) return cancel;
    readSocialPostWindow(async cursor => {
      const href = cursor ? socialFeedRequestHref(initialState, cursor) : feedHref;
      if (!href) throw new Error("Social feed unavailable");
      return readPostPage(href, controller.signal);
    }, previous?.pages ?? 1)
      .then((page) => {
        if (controller.signal.aborted || feedRequestId.current !== requestId) return;
        feedData.current = { key: feedSnapshotKey, page };
        writeSurfaceSnapshot(feedSnapshotKey, page, Date.now(), { persist: false });
        setPosts(page.posts);
        setNextCursor(page.nextCursor);
        setLoadedPages(page.pages);
        if (!page.nextCursor || previous?.nextCursor !== page.nextCursor) setMoreFailed(false);
        setFeedStatus("ready");
        setQuietFeedFailure(false);
        setNewPostsWaiting(false);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError")
          return;
        if (!controller.signal.aborted && feedRequestId.current === requestId) {
          if (error instanceof SocialFeedDenied) denyFeed();
          else if (previous?.posts.length === 0) {
            setQuietFeedFailure(true);
            setFeedStatus("ready");
          } else setFeedStatus("error");
        }
      })
      .finally(() => {
        if (feedRequestId.current === requestId) {
          feedPending.current = false;
          setRefreshing(false);
        }
      });
    return cancel;
  }, [access, feedAttempt, feedHref, feedSnapshotKey, initialState, denyFeed]);

  useEffect(() => {
    if (access !== "verified" || !feedHref || !feedSnapshotKey) return;
    let failures = 0;
    let retryAfter = 0;
    const refresh = async () => {
      const held = feedData.current;
      if (newPostsWaiting || document.visibilityState === "hidden" || Date.now() < retryAfter ||
        held?.key !== feedSnapshotKey || held.page.pages > SOCIAL_REFRESH_PAGE_CAP ||
        feedPending.current || moreController.current || backgroundController.current) return;
      const controller = new AbortController();
      backgroundController.current = controller;
      const requestId = feedRequestId.current;
      const stillCurrent = () => !controller.signal.aborted &&
        backgroundController.current === controller && feedRequestId.current === requestId &&
        committedFeed.current?.key === feedSnapshotKey && committedFeed.current.editable &&
        feedData.current?.key === feedSnapshotKey;
      try {
        const result = await readSocialPostHead(cursor => {
          const href = cursor ? socialFeedRequestHref(initialState, cursor) : feedHref;
          if (!href) throw new Error("Social feed unavailable");
          return readPostPage(href, controller.signal);
        }, held.page);
        if (!stillCurrent()) return;
        failures = 0;
        retryAfter = 0;
        if (!result.contiguous) {
          setNewPostsWaiting(true);
          setQuietFeedFailure(false);
          setFeedStatus("ready");
          return;
        }
        const page = mergeSocialPostHead(feedData.current!.page, result.head);
        feedData.current = { key: feedSnapshotKey, page };
        writeSurfaceSnapshot(feedSnapshotKey, page, Date.now(), { persist: false, preserveAge: true });
        setPosts(page.posts);
        setNextCursor(page.nextCursor);
        setLoadedPages(page.pages);
        setFeedStatus("ready");
        setQuietFeedFailure(false);
        setNewPostsWaiting(false);
      } catch (error) {
        if (!stillCurrent()) return;
        if (error instanceof SocialFeedDenied) denyFeed();
        else {
          failures += 1;
          retryAfter = Date.now() + Math.min(120_000, 15_000 * 2 ** failures);
          setQuietFeedFailure(true);
          setFeedStatus(held.page.posts.length ? "error" : "ready");
        }
      } finally {
        if (backgroundController.current === controller) backgroundController.current = null;
      }
    };
    const onRefresh = () => void refresh();
    const timer = window.setInterval(onRefresh, 15_000);
    window.addEventListener("focus", onRefresh);
    window.addEventListener("online", onRefresh);
    document.addEventListener("visibilitychange", onRefresh);
    return () => {
      window.clearInterval(timer);
      backgroundController.current?.abort();
      backgroundController.current = null;
      window.removeEventListener("focus", onRefresh);
      window.removeEventListener("online", onRefresh);
      document.removeEventListener("visibilitychange", onRefresh);
    };
  }, [access, feedHref, feedSnapshotKey, initialState, newPostsWaiting, denyFeed]);

  useEffect(() => {
    const requestId = ++activityRequestId.current;
    void Promise.resolve().then(() => {
      if (activityRequestId.current !== requestId) return;
      setActivityRevision(accountRevision);
    });
    if (access !== "verified" || initialState.tab !== "posts") {
      void Promise.resolve().then(() => {
        if (activityRequestId.current !== requestId) return;
        setActivityStatus("idle");
        setActivityItems([]);
      });
      return;
    }

    const controller = new AbortController();
    void Promise.resolve().then(() => setActivityStatus("loading"));
    authedActionFetch("/api/social/interactions?view=notifications&limit=5", {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    }, { requiresIdentity: true })
      .then(async (response) => {
        if (!response.ok) throw new Error("Social activity unavailable");
        const items = parseActivityPage(await response.json());
        if (!items) throw new Error("Social activity malformed");
        return items;
      })
      .then((items) => {
        if (activityRequestId.current !== requestId) return;
        setActivityItems(items);
        setActivityStatus("ready");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError")
          return;
        if (activityRequestId.current === requestId) {
          setActivityItems([]);
          setActivityStatus("unavailable");
        }
      });
    return () => controller.abort();
  }, [accountRevision, access, initialState.tab]);

  const refreshAfterSave = useCallback(() => {
    feedRequestId.current += 1;
    setFeedAttempt(value => value + 1);
  }, []);

  const acceptPostEdit = useCallback((updated?: SocialPostDTO) => {
    const current = committedFeed.current;
    if (!current?.editable || current.actor !== user?.id || current.revision !== accountRevision) return;
    if (updated) {
      setSubmittedPost(updated);
      const active = feedData.current?.key === current.key ? feedData.current : null;
      if (current.prefix) forgetSurfaceSnapshots(current.prefix, active?.key ?? null);
      feedData.current = active;
      const selection = current.selection;
      if (active && selection.tab === "posts") {
        const next = chronological(postsRef.current.flatMap(item => {
          if (item.id !== updated.id) return [item];
          const edited = { ...updated, review: updated.review ?? item.review, video: updated.video ?? item.video, extraPhotos: updated.extraPhotos ?? item.extraPhotos };
          return matchesSocialPostFeedSelection(edited, selection.feed, selection.area, selection.tag)
            ? [edited] : [];
        }));
        postsRef.current = next;
        setPosts(next);
        const page = { ...active.page, posts: next };
        feedData.current = { key: active.key, page };
        writeSurfaceSnapshot(active.key, page, Date.now(), { persist: false, preserveAge: true });
      }
    }
    refreshAfterSave();
  }, [user?.id, accountRevision, refreshAfterSave]);

  const loadMore = useCallback(async () => {
    if (access !== "verified" || !nextCursor || loadingMore || feedPending.current || moreController.current) return;
    const href = socialFeedRequestHref(initialState, nextCursor);
    if (!href) return;
    backgroundController.current?.abort();
    backgroundController.current = null;
    const requestId = feedRequestId.current;
    const controller = new AbortController();
    moreController.current = controller;
    setLoadingMore(true);
    try {
      const page = await readPostPage(href, controller.signal);
      if (controller.signal.aborted || feedRequestId.current !== requestId) return;
      const byId = new Map(postsRef.current.map((post) => [post.id, post]));
      for (const post of page.posts) byId.set(post.id, post);
      const merged = { posts: chronological([...byId.values()]), nextCursor: page.nextCursor, pages: (feedData.current?.page.pages ?? 1) + 1 };
      if (feedSnapshotKey) {
        feedData.current = { key: feedSnapshotKey, page: merged };
        writeSurfaceSnapshot(feedSnapshotKey, merged, Date.now(), { persist: false, preserveAge: true });
      }
      setPosts(merged.posts);
      setNextCursor(page.nextCursor);
      setLoadedPages(merged.pages);
      setMoreFailed(false);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        if (feedRequestId.current === requestId) {
          if (error instanceof SocialFeedDenied) denyFeed();
          else setMoreFailed(true);
        }
      }
    } finally {
      if (moreController.current === controller) {
        moreController.current = null;
        setLoadingMore(false);
      }
    }
  }, [access, initialState, loadingMore, nextCursor, feedSnapshotKey, denyFeed]);

  const isPosts = initialState.tab === "posts";
  const logInPublicDay = useLogInPublicDay();
  const logInPublicSection = isPosts && logInPublicDay
    ? <LogInPublicDay day={logInPublicDay} className="socialLogInPublic" />
    : null;
  const activeTag = initialState.tab === "posts" && initialState.feed === "discover" ? initialState.tag ?? null : null;
  const visibleActivityStatus = activityRevision === accountRevision ? activityStatus : "idle";
  const visibleActivityItems = activityRevision === accountRevision ? activityItems : [];
  const showPostsControls =
    friendsLaunchEnabled &&
    isPosts &&
    viewerPhase === "resolved" &&
    access === "verified";
  const showViewerCards =
    showPostsControls &&
    (!feedHref || feedStatus === "ready" || feedStatus === "error");
  const checkingPosts = friendsLaunchEnabled && isPosts && viewerPhase === "resolved" && access === "checking";
  const checkingTools = checkingPosts || (showPostsControls && !showViewerCards);
  // A signed-out reader meets the door in the body, so the packs go beside it
  // there rather than in the narrow rail, where they left the column empty.
  const packsBesideTheDoor =
    friendsLaunchEnabled && isPosts && viewerPhase === "signed-out";
  // The route's one primary action is Post (docs/design/LAUNCH_SCREENS.md).
  // For a verified account it IS the composer: the trigger sits in the Screen's
  // primary slot and the sheet it opens is fixed, so nothing else on the page
  // wears the fill.
  //
  const composeReady = showPostsControls && draftScope !== null;
  const primary: ReactElement = composeReady ? (
    <SocialComposer
      key={draftScope}
      draftScope={draftScope}
      triggerLabel="Post"
      onSaved={(saved) => {
        if (saved) setSubmittedPost(saved);
        refreshAfterSave();
      }}
    />
  ) : identityUnavailable ? (
    <Link prefetch={false} href="/map">Open the map</Link>
  ) : viewerPhase === "signed-out" ? (
    // AN EMERGENCY ROLLBACK TAKES THE VALUE WITH IT. Under
    // PUBMAX_SOCIAL_FRIENDS_LAUNCH=0 the body is the invite-only preview
    // boundary on BOTH tabs, so the public tab is not public any more and
    // pointing the one painted action at it would send a stranger back to the
    // wall they are already looking at. The map is the destination that holds
    // whatever the flag says, and the preview boundary keeps its own quiet
    // sign-in way onward underneath.
    isPosts && friendsLaunchEnabled ? (
      <Link prefetch={false} href={SOCIAL_SIGN_IN_HREF}>Sign in</Link>
    ) : (
      <Link prefetch={false} href="/map">
        Open the map
      </Link>
    )
  ) : !isPosts && viewerPhase === "resolved" ? (
    <Link prefetch={false} href="/social">Post</Link>
  ) : (
    <button type="button" disabled>
      Post
    </button>
  );
  // The quiet way onward names the search-and-invite surface in the rail,
  // which mounts under the same condition.
  const secondary =
    friendsLaunchEnabled && isPosts ? (
      <a href="#find-lot-title">Find your lot</a>
    ) : undefined;

  const nightLinks = (
    <nav className="socialNightLinks" aria-label="Your night out">
      <Link prefetch={false} href="/messages">Messages</Link>
      <Link prefetch={false} href="/pal">Your Pub Pal</Link>
      <Link prefetch={false} href="/plan">Plan a crawl</Link>
      <SocialMomentLink />
    </nav>
  );
  const feedHeading = initialState.tab === "posts" ? (
    <header className="socialFeedHeading">
      <h2>{initialState.feed === "following" ? "Your lot, lately" : initialState.feed === "nearby" ? "Around your patch" : "Across the pub tables"}</h2>
      <p>{initialState.feed === "following" ? "Posts from people you follow. Newest first." : initialState.feed === "nearby" ? "Public posts tagged in this area. Newest first." : activeTag ? `Public posts tagged #${activeTag}. Newest first.` : "Public posts from across town. Newest first."}</p>
    </header>
  ) : null;
  const emptyFeedState = initialState.tab === "posts" ? (
    <EmptyState title="No posts here yet." action={
      initialState.feed === "following"
        ? <Link prefetch={false} href="/social?feed=discover">See posts across town</Link>
        : <Link prefetch={false} href="/social">Back to your following feed</Link>
    }>
      {activeTag
        ? `No public posts tagged #${activeTag} yet.`
        : initialState.feed === "following"
        ? "Your noticeboard is waiting for a good pub story. Find your lot below or share one of your own."
        : initialState.feed === "nearby"
          ? "No public posts in this patch yet. Pick another area or start the conversation."
          : "A quiet noticeboard, for now. Share a pub you rate or a photo from your night."}
    </EmptyState>
  ) : null;

  // A STRANGER ON THE POSTS TAB READS ONE COLUMN. Until the account answers,
  // and once it has answered nobody, the posts tab under the friends launch has
  // no feed to lay beside a rail, so the page is one reading column centred
  // with the head: the tabs, the boundary's one line, then what a stranger can
  // still use (who is already here, the handle search, the founders wall). It
  // used to be a 260px rail holding all of that beside a body holding the one
  // line, which left most of a desktop empty (taste plan, 18 Oct 2026).
  const doorMode = friendsLaunchEnabled && isPosts && (viewerPhase !== "resolved" || identityUnavailable);
  // THE LONDON LANE takes the door's slot once the session has answered
  // nobody. Until then the slot holds its size, because a surface that routes
  // the viewer may not guess who they are, and a signed-in reader must not
  // meet a stranger's lane on the way to their own feed.
  const londonLane = doorMode && londonLaneOpen && viewerPhase === "signed-out";
  const identityRecovery = identityUnavailable ? (
    <section className="socialBoundary" role="alert">
      <EmptyState
        title="We couldn't check your account."
        action={<Button type="button" variant="secondary" onClick={retryIdentity}>Retry</Button>}
      />
    </section>
  ) : null;
  const switcher = (
    <nav className="socialSwitcher" aria-label={`${surfaceName} view`}>
      <IntentLink href="/social" aria-current={isPosts ? "page" : undefined}>
        Posts
      </IntentLink>
      <IntentLink
        href="/social?tab=discover"
        aria-current={!isPosts ? "page" : undefined}
      >
        Pubs &amp; pints
      </IntentLink>
    </nav>
  );

  return (
    <>
      <main className={doorMode ? "socialPage socialPage--door" : "socialPage"} id="main-content">
        <Screen
          as="section"
          kicker={surfaceName}
          title={initialState.tab === "discover" ? "Pubs and pints" : "Plans, photos and people"}
          titleId="social-title"
          primary={primary}
          secondary={secondary}
        >
        {doorMode ? (
          <div className="socialDoor">
            {switcher}
            {identityRecovery}
            {(viewerPhase === "signed-out" || identityUnavailable) && publicAlternatives ? <SocialLondonEmpty alternatives={publicAlternatives} openTable={featuredOpenTable} /> : null}
            {londonLane ? (
              <SocialLondonLane />
            ) : !identityUnavailable ? (
            /* The boundary prints its line ONCE, under the head that carries
                the door, and says what Social holds rather than asking again.
                The slot keeps its size while the account answers, so nothing
                under it moves when the title appears. */
            <section
              className="socialDoorSlot"
              aria-label={`${surfaceName} posts`}
              aria-busy={viewerSession.unresolved || undefined}
              role={viewerSession.unresolved ? undefined : "status"}
            >
              {/* The title stays hidden until the account answers, so it names
                  no door it cannot yet offer. The public value line paints
                  immediately, and both lines reserve the slot's final size. */}
              <div aria-hidden={viewerSession.unresolved || undefined} className="socialRailContent">
                <EmptyState
                  title={
                    viewerSession.unresolved
                      ? socialLoadingLabel(friendsLaunchEnabled)
                      : socialBoundaryCopy("sign_in_required", friendsLaunchEnabled)
                  }
                >
                  {SOCIAL_SIGNED_OUT_VALUE_LINE}
                </EmptyState>
              </div>
              {viewerSession.unresolved ? (
                <div className="socialRailPending">
                  <SocialViewerState
                    phase="unresolved"
                    loadingLabel={socialLoadingLabel(friendsLaunchEnabled)}
                    inviteMessage={socialInviteMessage(friendsLaunchEnabled)}
                  />
                </div>
              ) : null}
            </section>
            ) : null}
            {/* The packs are public, so a stranger meeting the door sees who is
                already here. Read-only: following is an account action, and a
                button that answered 401 would be a second door. */}
            {packsBesideTheDoor ? <StarterPacks readOnly /> : null}
            {/* ONE live copy of the search-and-invite surface on this page. */}
            <FindYourLot myHandle={viewerHandle} compact query={findLotQuery} onQueryChange={setFindLotQuery} />
            {/* The founders wall: one quiet link, no count, and no branch on the
                reader (lib/foundingMembers.ts). */}
            <FoundersWallLink className="socialFoundersLink" />
          </div>
        ) : (
        <>
        <div className="socialFeedNavigation">
          {switcher}
          {showPostsControls ? nightLinks : checkingPosts ? (
            <SampleSkeleton label="Loading your night links">{nightLinks}</SampleSkeleton>
          ) : null}
        </div>
        <div className={isPosts ? "socialLayout" : "socialLayout socialLayout--discover"}>
          <div className="socialFeedColumn">
            {identityRecovery}
            {isPosts && publicAlternatives ? <SocialLondonEmpty alternatives={publicAlternatives} openTable={featuredOpenTable} /> : null}
            {showPostsControls ? <PostsControls state={initialState} /> : null}
            {checkingPosts && initialState.tab === "posts" ? (
              <SampleSkeleton label="Loading post lanes"><PostsControls state={initialState} /></SampleSkeleton>
            ) : null}
            {showViewerCards && viewerHandle ? <PintDropRecovery handle={viewerHandle} /> : null}
            {showViewerCards ? <SocialOutbox draftScope={draftScope} submittedPost={submittedPost} onPostChanged={acceptPostEdit} /> : null}

          {!friendsLaunchEnabled ? (
            <SocialAccessBoundary
              state="preview"
              friendsLaunchEnabled={false}
            />
          ) : initialState.tab === "discover" ? (
            <div className="socialDiscoverBody">
              <CreatorListsLane />
              <DiscoverBody
                rivalry={rivalry}
                heritageCrawls={heritageCrawls}
                embedded
              />
            </div>
          ) : viewerPhase === "signed-out" ? (
            // A stranger meets the boundary line alone: the head carries the
            // one sign-in door, and the rail carries the packs and the search.
            // The people directory and crews stay behind verified access.
            <SocialAccessBoundary
              state="sign_in_required"
              friendsLaunchEnabled={friendsLaunchEnabled}
            />
          ) : access === "checking" ? (
            <SampleSkeleton className="socialFeed" label={`Checking ${surfaceName} access…`}>
              {feedHeading}
              <div className="socialFeedEmpty">{emptyFeedState}</div>
            </SampleSkeleton>
          ) : access !== "verified" ? (
            <>
              <SocialAccessBoundary
                state={access}
                friendsLaunchEnabled={friendsLaunchEnabled}
                onRetry={
                  access === "unavailable"
                    ? () => setAccessAttempt((value) => value + 1)
                    : undefined
                }
                adultPrompt={adultPrompt}
                onAssertAdult={assertAdult}
                assertBusy={assertBusy}
                assertError={assertError}
              />
              <section className="socialFeedEmpty" aria-label="People on PUBMAXX">
                {/* Browse rides with search wherever search rides: both form
                    the friend graph, and neither reads a gated surface. Search
                    itself lives in the rail above, once. */}
                <PeopleDirectory myHandle={viewerHandle} />
              </section>
            </>
          ) : !feedHref ? (
            <section className="socialFeed" role="status">
              <EmptyState title="Choose a nearby area." />
            </section>
          ) : (
            <>
            {activeTag ? (
              <p className="socialTagChip">
                <span>Tag: #{activeTag}</span>
                <Link prefetch={false} href="/social?feed=discover" aria-label={`Clear the #${activeTag} filter`}>Clear</Link>
              </p>
            ) : null}
            {!(feedStatus === "ready" && posts.length === 0 && !nextCursor && !quietFeedFailure) ? <section
              className="socialFeed"
              aria-label={`${surfaceName} posts`}
              aria-busy={feedStatus === "loading" || loadingMore || refreshing}
            >
              {feedHeading}
              {loadedPages > 0 ? <div className="socialFeedControls">
                {newPostsWaiting ? <p className="socialFeedNewPosts" role="status">New posts are waiting. Refresh to see them.</p> : null}
                <Button type="button" variant="ghost" disabled={refreshing || loadingMore} onClick={requestExplicitFeedRefresh}>Refresh posts</Button>
              </div> : null}
              <p
                className="srOnly"
                role="status"
                aria-live="polite"
                aria-atomic="true"
              >
                {feedStatus === "loading"
                  ? `Loading ${surfaceName} posts…`
                  : loadingMore
                    ? `Loading more ${surfaceName} posts…`
                    : quietFeedFailure || feedStatus === "error"
                      ? ""
                      : `${posts.length} ${surfaceName} posts loaded.`}
              </p>
              {quietFeedFailure || (feedStatus === "error" && posts.length > 0) ? (
                <p className="socialFeedInlineError" role="status">
                  Couldn&rsquo;t refresh these posts. They show what loaded last.
                  <Button type="button" variant="secondary" aria-disabled={refreshing || loadingMore} aria-busy={refreshing} onClick={requestExplicitFeedRefresh}>Retry</Button>
                </p>
              ) : null}
              {feedStatus === "loading" && posts.length === 0 ? (
                <SocialFeedLoading />
              ) : feedStatus === "error" && posts.length === 0 ? (
                <div className="socialFeedError" role="alert">
                  <EmptyState
                    title={`${surfaceName} posts are unavailable right now.`}
                    action={
                      <button
                        type="button"
                        aria-disabled={refreshing || loadingMore}
                        aria-busy={refreshing}
                        onClick={requestExplicitFeedRefresh}
                      >
                        Retry
                      </button>
                    }
                  />
                </div>
              ) : posts.length === 0 && !quietFeedFailure ? (
                <div className="socialFeedEmpty" role="status">
                  {emptyFeedState}
                  {/* The search-and-invite surface is the rail's, once. */}
                  <PeopleDirectory myHandle={viewerHandle} />
                </div>
              ) : (
                <div className="socialPostList">
                  {reelPosts.length > 0 ? (
                    <button type="button" className="socialReelsEntry" onClick={(event) => openReel(reelPosts[0]!.id, event.currentTarget)}>
                      Watch reels <span>{reelPosts.length}</span>
                    </button>
                  ) : null}
                  {posts.map((post) => (
                    <SocialPostCard key={post.id} post={post} lane={initialState.feed ?? undefined} canEdit={post.ownedByViewer} draftScope={draftScope} interactive
                      onOpenVideo={openReel}
                      onEdited={acceptPostEdit} />
                  ))}
                  {reelStart ? <ReelsViewer posts={reelPosts} startPostId={reelStart.postId} opener={reelStart.opener} onClose={() => setReelStart(null)} /> : null}
                </div>
              )}
              {moreFailed ? <p className="socialFeedInlineError" role="alert">Couldn&rsquo;t load more posts.</p> : null}
              {(feedStatus === "ready" || posts.length > 0) && nextCursor ? (
                <Button
                  type="button"
                  variant="secondary"
                  className="socialLoadMore"
                  disabled={loadingMore || refreshing}
                  onClick={() => void loadMore()}
                >
                  {loadingMore ? "Loading…" : moreFailed ? "Try again" : "Load more"}
                </Button>
              ) : null}
            </section> : null}
            {initialState.feed === "following" ? <MatesActivity /> : null}
            </>
          )}

          </div>
          <aside className="socialControlRail" aria-label={`${surfaceName} views`}>
            {checkingTools ? (
              <SampleSkeleton className="socialViewerCards" label="Loading your Social tools">
                <PubRankingPlaceholder />
                {/* A static shape, not the lazy panel: the wait reserves the
                    crews card without its download or data read. */}
                <CrewsPanelPlaceholder />
              </SampleSkeleton>
            ) : null}
            {showViewerCards ? <SocialTagInbox /> : null}

            {/* Crews render their own neutral identity state before the
                verified gate answers. Protected crew data still stays behind
                that gate. */}
            {showViewerCards ? <PubRankingPanel refreshKey={submittedPost?.id ?? ""} /> : null}
            {showViewerCards ? (
              <CrewsPanel viewerHandle={viewerHandle} compact />
            ) : null}
            {/* Friend-graph formation rides the posts tab, and an EMERGENCY
                ROLLBACK (PUBMAX_SOCIAL_FRIENDS_LAUNCH=0) takes it with the rest
                of the surface: the body beside these becomes the preview
                boundary, so leaving them mounted would offer follows on a page
                that says it is not open yet. Pinned by
                __tests__/socialRollbackRender.test.tsx. */}
            {/* ONE live copy of the packs on this page. Signed-in cards keep
                their follow results; stranger cards are read-only, and the
                two render paths must never appear together. */}
            {friendsLaunchEnabled && isPosts ? <StarterPacks compact /> : null}
            {/* The founders wall. Public, already sitemapped, and until now
                reachable from nowhere inside the app. One quiet link, no
                count, and no branch on whether this reader holds a number:
                that would make the number a capability, which
                lib/foundingMembers.ts forbids. */}
            {isPosts ? <FoundersWallLink className="socialFoundersLink" /> : null}
            {/* And ONE live copy of the search-and-invite surface, for the same
                reason: the body used to mount a second one beside it, so an
                unverified viewer met the same heading, the same field and the
                same invite button twice at 1440 and stacked at 390 - and both
                copies carried `id="find-lot-title"`, which left every
                `aria-labelledby` on the page pointing at the first. */}
            {friendsLaunchEnabled && isPosts ? <FindYourLot myHandle={viewerHandle} compact query={findLotQuery} onQueryChange={setFindLotQuery} /> : null}
            {showPostsControls ? (
              <SocialContextRail status={visibleActivityStatus} items={visibleActivityItems} />
            ) : null}
          </aside>
        </div>
        </>
        )}
        {logInPublicSection}
        </Screen>
      </main>
    </>
  );
}

export default function SocialPageClient(props: SocialPageClientProps) {
  const { user } = useAuth();
  // The key is what isolates one account's Social state from the next: a switch
  // remounts this subtree so no held feed, composer draft or activity list can
  // carry over. SiteNav sits OUTSIDE it on purpose. The nav is not Social state,
  // and remounting it destroyed the account menu mid-switch: the open card that
  // is supposed to name the account you just switched TO disappeared instead,
  // against the law that a held profile card carries the handle it is about.
  return (
    <>
      <SiteNav active="social" />
      <SocialPageAccountState key={user?.id ?? "signed-out"} {...props} />
    </>
  );
}
