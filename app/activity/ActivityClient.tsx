"use client";

import type { Route } from "next";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import EmptyState from "@/components/ui/empty-state";
import { Chip } from "@/components/ui/chip";
import Screen from "@/components/ui/screen";
import { useAuth } from "@/components/auth/AuthProvider";
import { useViewerSession } from "@/components/auth/useViewerSession";
import SignInButton from "@/components/auth/SignInButton";
import SiteNav from "@/components/nav/SiteNav";
import SampleSkeleton from "@/components/ui/sample-skeleton";
import { useIsSample } from "@/components/ui/sample-skeleton-context";
import NextBadgeChips from "@/components/profile/NextBadgeChips";
import { profilePath } from "@/lib/appLink";
import { authedActionFetch } from "@/lib/authedFetch";
import {
  markMapFixesSeen,
  mapFixOutcomeHref,
  mapFixOutcomeLine,
  readMapFixOutcomes,
  readMapFixSeenAt,
  type MapFixOutcome,
} from "@/lib/mapFixOutcomes";
import type { NotificationDTO, NotificationKind } from "@/lib/notifications";
import { discardBody } from "@/lib/responseBody";
import { normalizeHandle } from "@/lib/profiles";
import { relativeTime } from "@/lib/relativeTime";
import { socialBoundaryCopy } from "@/lib/socialLaunch";
import { useSocialFriendsLaunch } from "@/lib/useSocialFriendsLaunch";

import "./activity.css";

// The kind filters offered in the desktop rail, in a stable order. Labels are
// nouns for the event class (the list rows carry the verb copy). Kept in lockstep
// with NotificationKind; a filter only renders when the loaded feed has that kind.
const KIND_FILTERS: ReadonlyArray<{ kind: NotificationKind; label: string }> = [
  { kind: "follow", label: "Follows" },
  { kind: "reaction", label: "Cheers" },
  { kind: "comment", label: "Comments" },
  { kind: "crawl_save", label: "Saves" },
  { kind: "crew_join_request", label: "Join requests" },
  { kind: "crew_join_accepted", label: "Let in" },
];

function verb(kind: NotificationKind): string {
  switch (kind) {
    case "follow":
      return "started following you";
    case "reaction":
      return "reacted to your Pint Drop";
    case "comment":
      return "commented on your Pint Drop";
    case "crawl_save":
      return "saved your crawl";
    case "crew_join_request":
      return "asked to join your crawl";
    case "crew_join_accepted":
      return "let you into their crawl";
    default:
      return "did something";
  }
}

// The subject link for a notification, or null when there's nothing to link to.
// follow → the actor's profile; reaction/comment → the drop on the map; crawl_save
// → the crawl story permalink; the two crew kinds → the crew page.
function subjectHref(n: NotificationDTO): Route | null {
  switch (n.kind) {
    case "follow":
      return profilePath(n.actorHandle);
    case "reaction":
    case "comment":
      return n.subjectRef ? `/map?drop=${encodeURIComponent(n.subjectRef)}` : null;
    case "crawl_save":
      return n.subjectRef ? (`/crawls/${encodeURIComponent(n.subjectRef)}` as Route) : null;
    case "crew_join_request":
    case "crew_join_accepted":
      return n.subjectRef ? (`/social/crews/${encodeURIComponent(n.subjectRef)}` as Route) : null;
    default:
      return null;
  }
}

// Per-kind tallies drive which filters render and the rail summary.
function activityTallies(items: readonly NotificationDTO[]): {
  kindCounts: Record<string, number>;
  unreadCount: number;
} {
  const kindCounts = items.reduce<Record<string, number>>((acc, n) => {
    acc[n.kind] = (acc[n.kind] ?? 0) + 1;
    return acc;
  }, {});
  const unreadCount = items.reduce((n, item) => (item.read ? n : n + 1), 0);
  return { kindCounts, unreadCount };
}

// Six rows across the four kinds, for the wait while the real ones are read.
// SampleSkeleton paints them out, so they only lay the grid out: a neutral
// handle, no subject name, and a date far enough back that it prints the same
// on the server and in the browser.
const SAMPLE_KINDS: readonly NotificationKind[] = [
  "follow",
  "reaction",
  "comment",
  "crawl_save",
  "reaction",
  "follow",
];
const SAMPLE_NOTIFICATIONS: readonly NotificationDTO[] = SAMPLE_KINDS.map((kind, index) => ({
  id: `sample-${index}`,
  actorHandle: "handle",
  kind,
  subjectRef: "sample",
  createdAt: "1970-01-15T12:00:00.000Z",
  read: true,
}));

function ignoreSampleFilter(): void {}

type MapFixRead = { outcomes: MapFixOutcome[]; seenBefore: number | null };
const NO_MAP_FIXES: MapFixRead = { outcomes: [], seenBefore: null };

/** The reporter's accepted map fixes. What landed since their last visit reads in weight. */
function MapFixList({ outcomes, seenBefore }: MapFixRead): React.JSX.Element {
  return (
    <section className="activityFixes" aria-labelledby="activity-fixes-title">
      <h2 id="activity-fixes-title" className="activityFixesTitle">Your map fixes</h2>
      <ul className="activityList">
        {outcomes.map((outcome) => {
          const href = mapFixOutcomeHref(outcome);
          const unread = Date.parse(outcome.decidedAt) > (seenBefore ?? 0);
          return (
            <li key={outcome.id} className={unread ? "activityItem activityFixItem isUnread" : "activityItem activityFixItem"}>
              <span>
                <span className="activityVerb">{mapFixOutcomeLine(outcome)}</span>
                <span className="activityTime"> · {relativeTime(outcome.decidedAt)}</span>
              </span>
              {href ? (
                <Link href={href} className="activityLink">
                  View
                </Link>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * The ready grid: the desktop rail (kind filters and a quick tally, hidden
 * below 1024px, so the phone layout stays the single list it always was) and
 * the list. The wait draws this same body from sample rows.
 */
function ActivityGridBody({
  total,
  kindCounts,
  unreadCount,
  visibleItems,
  kindFilter,
  onKindFilter,
  lead,
}: {
  lead?: React.ReactNode;
  total: number;
  kindCounts: Record<string, number>;
  unreadCount: number;
  visibleItems: readonly NotificationDTO[];
  kindFilter: NotificationKind | "all";
  onKindFilter: (kind: NotificationKind | "all") => void;
}): React.JSX.Element {
  // Sample rows never ask the server for their sample pages.
  const prefetch = useIsSample() ? false : undefined;
  return (
    <>
      <aside className="activityRail" aria-label="Filter activity">
        <div className="activityFilters" role="group" aria-label="Filter by kind">
          <Chip
            aria-pressed={kindFilter === "all"}
            onClick={() => onKindFilter("all")}
          >
            All
          </Chip>
          {KIND_FILTERS.filter((f) => (kindCounts[f.kind] ?? 0) > 0).map((f) => (
            <Chip
              key={f.kind}
              aria-pressed={kindFilter === f.kind}
              onClick={() => onKindFilter(f.kind)}
            >
              {f.label} ({kindCounts[f.kind]})
            </Chip>
          ))}
        </div>
        <dl className="activitySummary">
          <div className="activitySummaryRow">
            <dt>Total</dt>
            <dd>{total}</dd>
          </div>
          <div className="activitySummaryRow">
            <dt>Unread</dt>
            <dd>{unreadCount}</dd>
          </div>
        </dl>
      </aside>

      {lead}
      <ul className="activityList">
        {visibleItems.map((n) => {
          const href = subjectHref(n);
          return (
            <li key={n.id} className={n.read ? "activityItem" : "activityItem isUnread"}>
              <Link
                href={`/u/${encodeURIComponent(n.actorHandle)}`}
                prefetch={prefetch}
                className="activityActor"
              >
                @{n.actorHandle}
              </Link>{" "}
              <span className="activityVerb">{verb(n.kind)}</span>
              {n.subjectLabel ? (
                <span className="activitySubject">: {n.subjectLabel}</span>
              ) : null}
              <span className="activityTime"> · {relativeTime(n.createdAt)}</span>
              {href ? (
                <Link href={href} prefetch={prefetch} className="activityLink">
                  View
                </Link>
              ) : null}
            </li>
          );
        })}
      </ul>
    </>
  );
}

export default function ActivityClient(): React.JSX.Element {
  const { accountRevision, handle: authHandle, identityResolved, user } = useAuth();
  const userId = user?.id ?? null;
  const viewerSession = useViewerSession();
  const identityReadyForSurface = identityResolved && !viewerSession.unresolved;
  const socialFriendsLaunchEnabled = useSocialFriendsLaunch();
  const [handle, setHandle] = useState("");
  const [handleReady, setHandleReady] = useState(false);
  const [items, setItems] = useState<NotificationDTO[]>([]);
  const [mapFixes, setMapFixes] = useState<MapFixRead>(NO_MAP_FIXES);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  // Desktop-only kind filter. Defaults to "all", and the control that changes it
  // is CSS-hidden below 1024px, so the mobile render is always the full list —
  // unchanged from before this rail existed.
  const [kindFilter, setKindFilter] = useState<NotificationKind | "all">("all");
  const requestControllerRef = useRef<AbortController | null>(null);
  const accountRevisionRef = useRef(accountRevision);
  const [itemsRevision, setItemsRevision] = useState(accountRevision);

  useEffect(() => {
    accountRevisionRef.current = accountRevision;
  }, [accountRevision]);

  useEffect(() => {
    requestControllerRef.current?.abort();
    if (!socialFriendsLaunchEnabled) {
      void Promise.resolve().then(() => {
        setHandle("");
        setHandleReady(true);
        setItemsRevision(accountRevision);
        setItems([]);
        setMapFixes(NO_MAP_FIXES);
        setFailed(false);
        setLoading(false);
      });
      return;
    }
    let active = true;
    void Promise.resolve().then(() => {
      if (!active) return;
      setHandle(
        identityReadyForSurface && viewerSession.signedIn
          ? normalizeHandle(authHandle ?? "")
          : "",
      );
      setHandleReady(identityReadyForSurface);
      setItemsRevision(accountRevision);
      setItems([]);
      setMapFixes(NO_MAP_FIXES);
      setFailed(false);
    });
    return () => {
      active = false;
    };
  }, [
    accountRevision,
    authHandle,
    identityReadyForSurface,
    socialFriendsLaunchEnabled,
    viewerSession.signedIn,
  ]);

  const load = useCallback(async () => {
    if (!socialFriendsLaunchEnabled) {
      setLoading(false);
      return;
    }
    if (!handleReady) return;
    const h =
      identityReadyForSurface && viewerSession.signedIn
        ? normalizeHandle(authHandle ?? "")
        : "";
    if (!h) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setFailed(false);
    const requestRevision = accountRevision;
    const controller = new AbortController();
    requestControllerRef.current?.abort();
    requestControllerRef.current = controller;
    try {
      const res = await authedActionFetch(`/api/notifications?handle=${encodeURIComponent(h)}`, {
        signal: controller.signal,
      }, { requiresIdentity: true });
      if (accountRevisionRef.current !== requestRevision) return;
      if (!res.ok) {
        discardBody(res);
        setFailed(true);
        return;
      }
      const body = (await res.json()) as { notifications?: NotificationDTO[]; mapFixes?: unknown };
      if (accountRevisionRef.current !== requestRevision) return;
      setItems(Array.isArray(body.notifications) ? body.notifications : []);
      const outcomes = readMapFixOutcomes(body.mapFixes);
      setMapFixes({ outcomes, seenBefore: userId ? readMapFixSeenAt(userId) : null });
      if (userId) markMapFixesSeen(userId, outcomes);
      void authedActionFetch("/api/notifications", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ handle: h }),
        signal: controller.signal,
      }, { requiresIdentity: true }).catch(() => {});
    } catch {
      if (controller.signal.aborted || accountRevisionRef.current !== requestRevision) return;
      setFailed(true);
    } finally {
      if (accountRevisionRef.current === requestRevision) setLoading(false);
    }
  }, [
    accountRevision,
    handleReady,
    authHandle,
    identityReadyForSurface,
    socialFriendsLaunchEnabled,
    userId,
    viewerSession.signedIn,
  ]);

  useEffect(() => {
    // Defer through a promise callback so setState (inside load) never runs
    // synchronously in the effect body (react-hooks/set-state-in-effect).
    void Promise.resolve().then(() => load());
  }, [load]);

  // Per-kind tallies drive which filters render and the rail summary; both are
  // derived from the already-loaded feed (no extra fetch). The visible list is
  // the full feed unless a desktop filter narrows it.
  const accountItems = itemsRevision === accountRevision ? items : [];
  const accountMapFixes = itemsRevision === accountRevision ? mapFixes : NO_MAP_FIXES;
  const mapFixList =
    accountMapFixes.outcomes.length > 0 ? <MapFixList {...accountMapFixes} /> : null;
  const { kindCounts, unreadCount } = activityTallies(accountItems);
  const visibleItems =
    kindFilter === "all" ? accountItems : accountItems.filter((n) => n.kind === kindFilter);
  const visibleHandle = itemsRevision === accountRevision ? handle : "";

  return (
    // The nav lives OUTSIDE the 640px-capped <main id="main"> (same shape as the other
    // pages' full-width shells) — nesting it inside the narrow column wrapped
    // the link row into three overlapping lines on desktop.
    <div className="activityShell">
      <SiteNav />

      <Screen
        as="main"
        id="main"
        className="activity"
        kicker="Your people"
        title="Activity"
        titleId="activity-title"
        lede="Who followed you, cheered a pint, left a comment, or saved your crawl."
        primary={<Link href="/map">Open the map</Link>}
        secondary={<Link href="/social">Find your lot</Link>}
      >
        {/* Quest chips (IDEAS B2-lite): "next badge" progress for the claimed
            handle. Renders nothing without a handle, so the signed-out empty
            state below stays exactly as it is. */}
        {handleReady && visibleHandle.trim() ? <NextBadgeChips handle={visibleHandle} /> : null}

        {!socialFriendsLaunchEnabled ? (
          <EmptyState title="Social preview">{socialBoundaryCopy("preview", false)}</EmptyState>
        ) : viewerSession.unresolved || !handleReady || loading ? (
          // The wait is the ready grid itself, drawn from sample rows and
          // painted out (components/ui/sample-skeleton.tsx): a plain list on
          // phones, rail and two-up timeline from 1024px, at the size the
          // answer will take.
          // The grid sits INSIDE the region: below 1024px .activityGrid is
          // `display: contents`, which draws no box, so on the region itself
          // it would drop the 600 ms hold and the pulse.
          <SampleSkeleton label="Loading your activity">
            <div className="activityGrid">
              <ActivityGridBody
                total={SAMPLE_NOTIFICATIONS.length}
                {...activityTallies(SAMPLE_NOTIFICATIONS)}
                visibleItems={SAMPLE_NOTIFICATIONS}
                kindFilter="all"
                onKindFilter={ignoreSampleFilter}
              />
            </div>
          </SampleSkeleton>
        ) : !visibleHandle.trim() ? (
          <EmptyState title="This corner is yours. Claim it." action={<SignInButton />}>
            Sign in and choose a handle to see follows, cheers, comments and
            crawl saves here.
          </EmptyState>
        ) : failed ? (
          <div role="alert">
            <EmptyState
              title="Couldn't load your activity."
              action={
                <button type="button" onClick={() => void load()}>
                  Try again
                </button>
              }
            />
          </div>
        ) : items.length === 0 && mapFixList ? (
          mapFixList
        ) : items.length === 0 ? (
          // No way onward of its own: the head's quiet "Find your lot" already
          // goes to /social, and a second door to the same place is noise.
          <EmptyState title="Nothing's landed yet.">
            When someone follows you, cheers a Pint Drop, leaves a comment or
            saves one of your crawls, it turns up here. Go give them a reason
            to.
          </EmptyState>
        ) : (
          <div className="activityGrid">
            <ActivityGridBody
              lead={mapFixList}
              total={items.length}
              kindCounts={kindCounts}
              unreadCount={unreadCount}
              visibleItems={visibleItems}
              kindFilter={kindFilter}
              onKindFilter={setKindFilter}
            />
          </div>
        )}
      </Screen>
    </div>
  );
}
