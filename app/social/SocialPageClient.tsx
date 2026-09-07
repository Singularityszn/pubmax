"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";


import { useAuth } from "@/components/auth/AuthProvider";
import { useViewerSession } from "@/components/auth/useViewerSession";
import FoundersWallLink from "@/components/founding/FoundersWallLink";
import SiteNav from "@/components/nav/SiteNav";
import HandleAvatar from "@/components/profile/HandleAvatar";
import CrewsPanel from "@/components/social/CrewsPanel";
import SocialPostActions from "@/components/social/SocialPostActions";
import SocialPostGallery from "@/components/social/SocialPostGallery";
import SocialVideoViewer, { socialFeedVideos } from "@/components/social/SocialVideoViewer";
import { socialPostPhotos } from "@/lib/socialGallery";
import CreatorListsLane from "@/components/social/CreatorListsLane";
import FindYourLot from "@/components/social/FindYourLot";
import PeopleDirectory from "@/components/social/PeopleDirectory";
import StarterPacks from "@/components/social/StarterPacks";
import {
  SOCIAL_SIGN_IN_HREF,
  SocialViewerState,
  type SocialViewerPhase,
} from "@/components/social/SocialViewerState";
import EmptyState from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import Screen from "@/components/ui/screen";
import { ADULT_SELF_ASSERTION_ACTION } from "@/lib/adultGate";
import { authedActionFetch } from "@/lib/authedFetch";
import { subscribeDeviceIdentity } from "@/lib/deviceAccountIdentity";
import type { CityRivalryEntry } from "@/lib/cityRivalry";
import type { CuratedCrawl } from "@/lib/curatedCrawls";
import { discardBody } from "@/lib/responseBody";
import { getCity } from "@/lib/cities";
import { getNightArea, nightAreasByCity } from "@/lib/nightAreas";
import { normalizeHandle } from "@/lib/profiles";
import { relativeTime } from "@/lib/relativeTime";
import type { SocialAccessState } from "@/lib/socialAccess";
import {
  adultSelfAssertionLine,
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
import { venueMapUrl } from "@/lib/venueMapUrl";

import "./social.css";
import "./socialDiscovery.css";
import SocialComposer from "./SocialComposer";
import SocialTagInbox from "./SocialTagInbox";
import SocialOutbox from "./SocialOutbox";

const DiscoverBody = dynamic(() => import("@/app/discover/DiscoverPageClient").then((module) => module.DiscoverBody));

export type SocialBoundaryState = SocialBoundaryCopyState;

const ACCESS_STATES = new Set<SocialAccessState>([
  "preview",
  "sign_in_required",
  "age_verification_required",
  "verified",
  "suspended",
]);

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
};

type SocialPostPage = {
  posts: SocialPostDTO[];
  nextCursor: string | null;
};

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
      typeof candidate.author.handle !== "string" ||
      typeof candidate.ownedByViewer !== "boolean" ||
      (candidate.venueName !== null && typeof candidate.venueName !== "string") ||
      !Array.isArray(candidate.hashtags)
    )
      return null;
    posts.push(candidate as SocialPostDTO);
  }
  const nextCursor = value.nextCursor;
  if (nextCursor !== null && typeof nextCursor !== "string") return null;
  return { posts, nextCursor: nextCursor as string | null };
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

function chronological(posts: SocialPostDTO[]): SocialPostDTO[] {
  return [...posts].sort((left, right) => {
    const time = Date.parse(right.createdAt) - Date.parse(left.createdAt);
    return time || right.id.localeCompare(left.id);
  });
}

export function SocialAccessBoundary({
  state,
  onRetry,
  adultPrompt = false,
  onAssertAdult,
  assertBusy = false,
  assertError = null,
  friendsLaunchEnabled = true,
  doorAbove = false,
}: {
  state: SocialBoundaryState;
  onRetry?: () => void;
  /**
   * The Screen above already carries the sign-in door as its one painted
   * action, so the line prints alone rather than a second way to the same
   * page.
   */
  doorAbove?: boolean;
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
  // The Screen above owns the one painted action, so nothing here is filled.
  const asking = state === "age_verification_required" && adultPrompt;
  const action =
    state === "sign_in_required" ? (
      doorAbove ? undefined : <Link href={SOCIAL_SIGN_IN_HREF}>Sign in</Link>
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

export function SocialPostCard({ post, canEdit = false, canInteract = false, draftScope, onEdited, onOpenVideo }: { post: SocialPostDTO; canEdit?: boolean; canInteract?: boolean; draftScope?: string | null; onEdited?: (post?: SocialPostDTO) => void; onOpenVideo?: () => void }) {
  const photos = socialPostPhotos(post);
  const area = post.area ? getNightArea(post.area) : null;
  const exactVenueId = post.venueProjected ? post.venueId : null;
  const when = relativeTime(post.createdAt);
  return (
    <article className="socialPostCard">
      <header className="socialPostMeta">
        <HandleAvatar
          handle={post.author.handle}
          avatarUrl={post.author.avatarUrl}
          className="socialPostAvatar"
          imageClassName="socialPostAvatar"
          size={32}
        />
        <Link className="socialPostAuthor" href={`/u/${encodeURIComponent(post.author.handle)}`}>
          @{post.author.handle}
        </Link>
        {when ? <time dateTime={post.createdAt}>{when}</time> : null}
      </header>
      {post.kind === "feature_request" ? (
        <p className="socialPostKind">Feature request</p>
      ) : null}
      {photos.length > 0 ? (
        <figure className="socialPostPhoto">
          <SocialPostGallery photos={photos} />
          {post.photos === undefined && post.photo?.tags && post.photo.tags.length > 0 ? (
            <figcaption>{post.photo.tags.map((tag) => `@${tag.handle}`).join(" ")}</figcaption>
          ) : null}
        </figure>
      ) : null}
      {onOpenVideo && photos.length === 1 && photos[0].kind === "video" ? <Button type="button" variant="ghost"
        className="socialVideoViewerTrigger" onClick={onOpenVideo}>Open video viewer</Button> : null}
      {post.body ? <p className="socialPostBody">{post.body}</p> : null}
      {area || exactVenueId ? (
        <p className="socialPostPlace">
          {area ? <span>{area.name}</span> : null}
          {exactVenueId ? (
            <Link href={venueMapUrl(exactVenueId)}>{post.venueName || "Open venue"}</Link>
          ) : null}
        </p>
      ) : null}
      {post.hashtags.length > 0 ? (
        <p className="socialPostTags">
          {post.hashtags.map((tag) => (
            <span key={tag}>#{tag}</span>
          ))}
        </p>
      ) : null}
      {post.editedAt ? <p className="socialPostEdited">Edited</p> : null}
      {canInteract ? <SocialPostActions post={post} /> : null}
      {canEdit && draftScope && onEdited ? <SocialComposer key={`${draftScope}:${post.id}`} post={post} draftScope={draftScope} onSaved={onEdited} /> : null}
    </article>
  );
}

export function SocialFeedPosts({ posts, draftScope, onEdited }: {
  posts: SocialPostDTO[];
  draftScope: string | null;
  onEdited: (post?: SocialPostDTO) => void;
}) {
  const [videoPostId, setVideoPostId] = useState<string | null>(null);
  const videos = socialFeedVideos(posts);
  return <div className="socialPostList">
    {videos.length > 0 ? <Button type="button" variant="ghost" className="socialVideoViewerTrigger"
      onClick={() => setVideoPostId(videos[0].postId)}>Watch videos</Button> : null}
    {posts.map(post => <SocialPostCard key={post.id} post={post} canEdit={post.ownedByViewer} canInteract
      draftScope={draftScope} onEdited={onEdited} onOpenVideo={() => setVideoPostId(post.id)} />)}
    {videoPostId ? <SocialVideoViewer videos={videos} initialPostId={videoPostId} onClose={() => setVideoPostId(null)} /> : null}
  </div>;
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
        <Link href="/social" aria-current={state.feed === "discover" ? "page" : undefined}>
          Discover
        </Link>
        <Link href="/social?feed=following" aria-current={state.feed === "following" ? "page" : undefined}>
          Following
        </Link>
        <Link href="/social?feed=nearby" aria-current={state.feed === "nearby" ? "page" : undefined}>
          Nearby
        </Link>
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
    (status === "ready" && items.length === 0)
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
}: SocialPageClientProps) {
  const surfaceName = socialSurfaceName(friendsLaunchEnabled);
  const { accountRevision, identityResolved } = useAuth();
  const viewerSession = useViewerSession();
  const viewerPhase: SocialViewerPhase =
    viewerSession.unresolved
      ? "unresolved"
      : viewerSession.signedIn
        ? "resolved"
        : "signed-out";
  const [accessResult, setAccessResult] = useState({
    state: "checking" as AccessLoadState,
    accountRevision,
  });
  const access = accessResult.accountRevision === accountRevision ? accessResult.state : "checking";
  const setAccess = useCallback((state: AccessLoadState) => {
    setAccessResult({ state, accountRevision });
  }, [accountRevision]);
  const [adultPrompt, setAdultPrompt] = useState(false);
  const [assertBusy, setAssertBusy] = useState(false);
  const [assertError, setAssertError] = useState<string | null>(null);
  const [draftScope, setDraftScope] = useState<string | null>(null);
  const [viewerHandle, setViewerHandle] = useState<string | null>(null);
  const [submittedPost, setSubmittedPost] = useState<SocialPostDTO | null>(null);
  const [accessAttempt, setAccessAttempt] = useState(0);
  const [feedAttempt, setFeedAttempt] = useState(0);
  const [feedStatus, setFeedStatus] = useState<FeedLoadState>("idle");
  const [activityStatus, setActivityStatus] =
    useState<ActivityLoadState>("idle");
  const [activityItems, setActivityItems] = useState<SocialActivityItem[]>([]);
  const [posts, setPosts] = useState<SocialPostDTO[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [activityRevision, setActivityRevision] = useState(accountRevision);
  const activityRequestId = useRef(0);
  const feedRequestId = useRef(0);
  const moreController = useRef<AbortController | null>(null);
  const feedHref = useMemo(
    () => socialFeedRequestHref(initialState),
    [initialState],
  );

  useEffect(() => {
    if (initialState.tab === "discover") return;
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
    // Rechecking this account must not unmount its open composer. A different
    // account is masked during render, before this effect runs.
    void Promise.resolve().then(() => {
      if (controller.signal.aborted) return;
      setAccessResult(current => current.accountRevision === accountRevision && current.state === "verified"
        ? current : { state: "checking", accountRevision });
    });
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
        setAccess(result.state);
        setAdultPrompt(result.adultPrompt);
        setDraftScope(result.draftScope);
        setViewerHandle(result.viewerHandle);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError")
          return;
        if (controller.signal.aborted) return;
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
    setAccess,
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
    moreController.current?.abort();
    const requestId = ++feedRequestId.current;
    if (access !== "verified" || !feedHref) {
      void Promise.resolve().then(() => {
        if (feedRequestId.current !== requestId) return;
        setPosts([]);
        setNextCursor(null);
        setFeedStatus("idle");
        setLoadingMore(false);
      });
      return;
    }

    const controller = new AbortController();
    void Promise.resolve().then(() => {
      if (feedRequestId.current !== requestId) return;
      setPosts([]);
      setNextCursor(null);
      setFeedStatus("loading");
      setLoadingMore(false);
    });
    authedActionFetch(feedHref, {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    }, { requiresIdentity: true })
      .then(async (response) => {
        if (!response.ok) throw new Error("Social feed unavailable");
        const page = parsePostPage(await response.json());
        if (!page) throw new Error("Social feed malformed");
        return page;
      })
      .then((page) => {
        if (feedRequestId.current !== requestId) return;
        setPosts(chronological(page.posts));
        setNextCursor(page.nextCursor);
        setFeedStatus("ready");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError")
          return;
        if (feedRequestId.current === requestId) setFeedStatus("error");
      });
    return () => {
      controller.abort();
      moreController.current?.abort();
      moreController.current = null;
    };
  }, [access, feedAttempt, feedHref]);

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

  const loadMore = useCallback(async () => {
    if (access !== "verified" || !nextCursor || loadingMore) return;
    const href = socialFeedRequestHref(initialState, nextCursor);
    if (!href) return;
    const requestId = feedRequestId.current;
    const controller = new AbortController();
    moreController.current?.abort();
    moreController.current = controller;
    setLoadingMore(true);
    try {
      const response = await authedActionFetch(href, {
        cache: "no-store",
        credentials: "same-origin",
        signal: controller.signal,
      }, { requiresIdentity: true });
      if (!response.ok) {
        discardBody(response);
        throw new Error("Social feed unavailable");
      }
      const page = parsePostPage(await response.json());
      if (!page) throw new Error("Social feed malformed");
      if (feedRequestId.current !== requestId) return;
      setPosts((current) => {
        const byId = new Map(current.map((post) => [post.id, post]));
        for (const post of page.posts) byId.set(post.id, post);
        return chronological([...byId.values()]);
      });
      setNextCursor(page.nextCursor);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        if (feedRequestId.current === requestId) setFeedStatus("error");
      }
    } finally {
      if (moreController.current === controller) {
        moreController.current = null;
        setLoadingMore(false);
      }
    }
  }, [access, initialState, loadingMore, nextCursor]);

  const isPosts = initialState.tab === "posts";
  const visibleActivityStatus = activityRevision === accountRevision ? activityStatus : "idle";
  const visibleActivityItems = activityRevision === accountRevision ? activityItems : [];
  const showPostsControls =
    friendsLaunchEnabled &&
    isPosts &&
    viewerPhase === "resolved" &&
    access === "verified";
  const showViewerCards =
    friendsLaunchEnabled &&
    isPosts &&
    viewerPhase === "resolved" &&
    access === "verified";
  // A signed-out reader meets the door in the body, so the packs go beside it
  // there rather than in the narrow rail, where they left the column empty.
  const packsBesideTheDoor =
    friendsLaunchEnabled && isPosts && viewerPhase === "signed-out";

  // The route's one primary action is Post (docs/design/LAUNCH_SCREENS.md).
  // For a verified account it IS the composer: the trigger sits in the Screen's
  // primary slot and the sheet it opens is fixed, so nothing else on the page
  // wears the fill. A stranger's first kept action is signing in, so their
  // primary is the door and says so, and the boundary below prints its line
  // without a second link to the same page (`doorAbove`). While the session or
  // the access answer is still open the control waits, because a surface that
  // routes the viewer may not guess who they are.
  const composeReady = showPostsControls && draftScope !== null;
  const primary: ReactElement = composeReady ? (
    <SocialComposer
      key={draftScope}
      draftScope={draftScope}
      triggerLabel="Post"
      onSaved={(saved) => {
        if (saved) setSubmittedPost(saved);
        setFeedAttempt((value) => value + 1);
      }}
    />
  ) : viewerPhase === "signed-out" ? (
    <Link href={SOCIAL_SIGN_IN_HREF}>Sign in</Link>
  ) : !isPosts && viewerPhase === "resolved" ? (
    <Link href="/social">Post</Link>
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

  return (
    <>
      <main className="socialPage" id="main-content">
        <Screen
          as="section"
          kicker={surfaceName}
          title="Good times, shared."
          titleId="social-title"
          primary={primary}
          secondary={secondary}
        >
        <div className="socialLayout">
          <div className="socialMain">
            {showPostsControls ? <PostsControls state={initialState} /> : null}


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
          ) : viewerPhase === "unresolved" ? (
            <section className="socialBoundary" role="status" aria-busy="true">
              <h2>{socialLoadingLabel(friendsLaunchEnabled)}</h2>
              <SocialViewerState
                phase="unresolved"
                loadingLabel={socialLoadingLabel(friendsLaunchEnabled)}
                inviteMessage={socialInviteMessage(friendsLaunchEnabled)}
              />
            </section>
          ) : viewerPhase === "signed-out" ? (
            <>
              <SocialAccessBoundary
                state="sign_in_required"
                friendsLaunchEnabled={friendsLaunchEnabled}
                doorAbove
              />
              {/* The packs are public and already listed, so a stranger meeting
                  the door can see who is already here rather than one sentence
                  in an empty page. Still ONE live copy: the rail drops its
                  signed-in copy while this one is up, so the two render paths
                  cannot appear together or carry conflicting follow results. */}
              {packsBesideTheDoor ? <StarterPacks readOnly /> : null}
            </>
          ) : access === "checking" ? (
            <section className="socialBoundary" role="status" aria-busy="true">
              <h2>Checking {surfaceName} access…</h2>
            </section>
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
            <section
              className="socialFeed"
              aria-label={`${surfaceName} posts`}
              aria-busy={feedStatus === "loading" || loadingMore}
            >
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
                    : feedStatus === "error"
                      ? `${surfaceName} posts are unavailable right now.`
                      : `${posts.length} ${surfaceName} posts loaded.`}
              </p>
              {feedStatus === "loading" ? (
                <div className="socialSkeletons" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </div>
              ) : feedStatus === "error" ? (
                <div className="socialFeedError" role="alert">
                  <EmptyState
                    title={`${surfaceName} posts are unavailable right now.`}
                    action={
                      <button
                        type="button"
                        onClick={() => setFeedAttempt((value) => value + 1)}
                      >
                        Retry
                      </button>
                    }
                  />
                </div>
              ) : posts.length === 0 ? (
                <div className="socialFeedEmpty" role="status">
                  <EmptyState
                    title={initialState.feed === "following" ? "Your people, your next good night." : "Be the first to share a moment."}
                    action={initialState.feed === "following"
                      ? <Link href="/social">Discover moments</Link>
                      : <Link href="/social?tab=discover">Find somewhere to go</Link>}
                  />
                  {/* The search-and-invite surface is the rail's, once. */}
                  <PeopleDirectory myHandle={viewerHandle} />
                </div>
              ) : (
                <SocialFeedPosts key={`${accountRevision}:${feedHref}`} posts={posts} draftScope={draftScope}
                  onEdited={(updated) => updated
                    ? setPosts((current) => chronological(current.map((item) => item.id === updated.id ? updated : item)))
                    : setFeedAttempt((value) => value + 1)} />
              )}
              {feedStatus === "ready" && nextCursor ? (
                <button
                  type="button"
                  className="socialButton socialLoadMore"
                  disabled={loadingMore}
                  onClick={() => void loadMore()}
                >
                  {loadingMore ? "Loading…" : "Load more"}
                </button>
              ) : null}
            </section>
          )}

          </div>
          <aside className="socialControlRail" aria-label={`${surfaceName} views`}>
            {showViewerCards ? <SocialTagInbox /> : null}
            {showViewerCards ? <SocialOutbox draftScope={draftScope} submittedPost={submittedPost} onPostChanged={(updated) => {
              if (updated) setSubmittedPost(updated);
              setFeedAttempt((value) => value + 1);
            }} /> : null}
            <nav className="socialSwitcher" aria-label={`${surfaceName} view`}>
              <Link href="/social" aria-current={isPosts ? "page" : undefined}>
                Posts
              </Link>
              <Link
                href="/social?tab=discover"
                aria-current={!isPosts ? "page" : undefined}
              >
                Pubs &amp; pints
              </Link>
            </nav>
            {/* Crews render their own neutral identity state before the
                verified gate answers. Protected crew data still stays behind
                that gate. */}
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
            {friendsLaunchEnabled && isPosts && !packsBesideTheDoor ? <StarterPacks compact /> : null}
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
            {friendsLaunchEnabled && isPosts ? <FindYourLot myHandle={viewerHandle} compact /> : null}
          </aside>

          {showPostsControls ? (
            <SocialContextRail status={visibleActivityStatus} items={visibleActivityItems} />
          ) : null}
        </div>
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
