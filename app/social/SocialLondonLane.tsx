"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import SocialPostCard from "@/components/social/SocialPostCard";
import EmptyState from "@/components/ui/empty-state";
import { discardBody } from "@/lib/responseBody";
import {
  parseSocialLondonLanePage,
  SOCIAL_LONDON_LANE_COPY,
  socialLondonLaneHref,
  type SocialLondonLanePage,
  type SocialLondonLanePost,
} from "@/lib/socialLondonLane";

type LoadState = "loading" | "ready" | "error";

const COPY = SOCIAL_LONDON_LANE_COPY;

/**
 * Ask for one page of the lane. It sends NO credentials: the lane is the same
 * for every reader, so nothing about this one rides the request.
 */
async function readLane(cursor: string | null, signal: AbortSignal): Promise<SocialLondonLanePage> {
  const response = await fetch(socialLondonLaneHref(cursor), {
    cache: "no-store",
    credentials: "omit",
    signal,
  });
  if (!response.ok) {
    discardBody(response);
    throw new Error("London lane unavailable");
  }
  const page = parseSocialLondonLanePage(await response.json());
  if (!page) throw new Error("London lane malformed");
  return page;
}

function aborted(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

/**
 * Keep a focused control BELOW the lane in view while the lane changes size.
 *
 * The lane takes the door slot's place once the session answers nobody, and
 * it grows twice more (skeletons, then posts or the empty line). A reader who
 * already tabbed or tapped into Find your lot under it would see that field
 * pushed down under the consent card or off the screen, because the browser
 * scrolls a control into view only when focus moves. "nearest" moves the page
 * only when the control left the view, and it honours the root's scroll
 * padding, which keeps the consent card's lane (e2e/ux-consent-chrome.spec.ts).
 */
function keepFocusBelowInView(lane: HTMLElement | null): void {
  if (!lane || typeof document === "undefined") return;
  const focused = document.activeElement;
  if (!(focused instanceof HTMLElement) || focused === document.body) return;
  if (lane.contains(focused)) return;
  if (!(lane.compareDocumentPosition(focused) & Node.DOCUMENT_POSITION_FOLLOWING)) return;
  focused.scrollIntoView?.({ block: "nearest" });
}

/**
 * THE LONDON LANE, AS A STRANGER READS IT (captain decision 7, 1 Nov 2026).
 *
 * Read-only: each card prints one quiet way to sign in where a reader's cheer
 * and comment row sits, and the page's one filled action stays the Screen's
 * door above. Nothing here posts, cheers, comments, saves or follows.
 */
export default function SocialLondonLane() {
  const [status, setStatus] = useState<LoadState>("loading");
  const [posts, setPosts] = useState<SocialLondonLanePost[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const requestId = useRef(0);
  const moreController = useRef<AbortController | null>(null);
  const laneRef = useRef<HTMLElement | null>(null);

  // On mount (the lane replaced the slot) and on every change of its height.
  useLayoutEffect(() => {
    keepFocusBelowInView(laneRef.current);
  }, [status, posts.length, nextCursor, loadingMore]);

  useEffect(() => {
    const id = ++requestId.current;
    const controller = new AbortController();
    moreController.current?.abort();
    void Promise.resolve().then(() => {
      if (requestId.current !== id) return;
      setStatus("loading");
      setPosts([]);
      setNextCursor(null);
      setLoadingMore(false);
    });
    readLane(null, controller.signal)
      .then((page) => {
        if (requestId.current !== id) return;
        setPosts(page.posts);
        setNextCursor(page.nextCursor);
        setStatus("ready");
      })
      .catch((error: unknown) => {
        if (aborted(error) || requestId.current !== id) return;
        setStatus("error");
      });
    return () => {
      controller.abort();
      moreController.current?.abort();
      moreController.current = null;
    };
  }, [attempt]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    const id = requestId.current;
    const controller = new AbortController();
    moreController.current?.abort();
    moreController.current = controller;
    setLoadingMore(true);
    try {
      const page = await readLane(nextCursor, controller.signal);
      if (requestId.current !== id) return;
      setPosts((current) => {
        const seen = new Set(current.map((post) => post.id));
        return [...current, ...page.posts.filter((post) => !seen.has(post.id))];
      });
      setNextCursor(page.nextCursor);
    } catch (error) {
      if (!aborted(error) && requestId.current === id) setStatus("error");
    } finally {
      if (moreController.current === controller) {
        moreController.current = null;
        setLoadingMore(false);
      }
    }
  }, [loadingMore, nextCursor]);

  return (
    <section
      ref={laneRef}
      className="socialFeed socialLondonLane"
      aria-labelledby="social-london-lane-title"
      aria-busy={status === "loading" || loadingMore}
    >
      <header className="socialFeedHeading">
        <h2 id="social-london-lane-title">{COPY.title}</h2>
        <p>{COPY.line}</p>
      </header>
      <p className="srOnly" role="status" aria-live="polite" aria-atomic="true">
        {status === "loading"
          ? "Loading London posts…"
          : loadingMore
            ? "Loading more London posts…"
            : status === "error"
              ? COPY.unavailable
              : `${posts.length} London posts loaded.`}
      </p>
      {status === "loading" ? (
        <div className="socialSkeletons" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      ) : status === "error" ? (
        <div className="socialFeedError" role="alert">
          <EmptyState
            title={COPY.unavailable}
            action={
              <button type="button" onClick={() => setAttempt((value) => value + 1)}>
                {COPY.retry}
              </button>
            }
          />
        </div>
      ) : posts.length === 0 ? (
        <div className="socialFeedEmpty" role="status">
          <EmptyState title={COPY.emptyTitle}>{COPY.emptyLine}</EmptyState>
        </div>
      ) : (
        <div className="socialPostList">
          {posts.map((post) => (
            <SocialPostCard key={post.id} post={post} signedOut />
          ))}
        </div>
      )}
      {status === "ready" && nextCursor ? (
        <button
          type="button"
          className="socialLondonMore"
          disabled={loadingMore}
          onClick={() => void loadMore()}
        >
          {loadingMore ? COPY.loadingMore : COPY.more}
        </button>
      ) : null}
    </section>
  );
}
