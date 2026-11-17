"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import SocialPostCard from "@/components/social/SocialPostCard";
import EmptyState from "@/components/ui/empty-state";
import { authedActionFetch } from "@/lib/authedFetch";
import { discardBody } from "@/lib/responseBody";
import type { SocialPostDTO } from "@/lib/socialPosts";

import "@/app/social/social.css";

// A PERSON'S POSTS, ON THEIR PROFILE. The Social posts they wrote, read
// through `GET /api/social/posts?author=`, which owns the rule: public for any
// verified reader, friends for a mutual, everything for the owner, and a
// hidden-name post for the owner alone. This section sits beside "Moments"
// (the Pint Drop timeline) and does not replace it.
//
// It speaks only when it has something true to say. A reader Social does not
// admit (signed out, not yet 18-checked, Social closed) sees nothing here,
// because the boundary is /social's to explain, not a profile's.

type LoadState = "loading" | "ready" | "hidden" | "error";

type PostPage = { posts: SocialPostDTO[]; nextCursor: string | null };

function readPage(value: unknown): PostPage | null {
  if (!value || typeof value !== "object") return null;
  const page = value as { posts?: unknown; nextCursor?: unknown };
  if (!Array.isArray(page.posts)) return null;
  const nextCursor = typeof page.nextCursor === "string" ? page.nextCursor : null;
  return { posts: page.posts as SocialPostDTO[], nextCursor };
}

function authorHref(handle: string, cursor: string | null): string {
  const params = new URLSearchParams({ author: handle, limit: "20" });
  if (cursor) params.set("cursor", cursor);
  return `/api/social/posts?${params.toString()}`;
}

export default function ProfilePostsSection({
  authorHandle,
  isOwn,
}: {
  authorHandle: string;
  isOwn: boolean;
}) {
  const { user, accountRevision } = useAuth();
  const [state, setState] = useState<LoadState>("loading");
  const [posts, setPosts] = useState<SocialPostDTO[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const requestId = useRef(0);
  const signedIn = Boolean(user);

  const load = useCallback(async (cursor: string | null, signal: AbortSignal): Promise<PostPage | "hidden"> => {
    const response = await authedActionFetch(authorHref(authorHandle, cursor), {
      cache: "no-store",
      credentials: "same-origin",
      signal,
    }, { requiresIdentity: true });
    // 401 and 403 are Social's own door: not this section's to explain.
    if (response.status === 401 || response.status === 403 || response.status === 404) {
      discardBody(response);
      return "hidden";
    }
    if (!response.ok) {
      discardBody(response);
      throw new Error("Posts unavailable");
    }
    const page = readPage(await response.json());
    if (!page) throw new Error("Posts malformed");
    return page;
  }, [authorHandle]);

  useEffect(() => {
    if (!signedIn) return;
    const id = ++requestId.current;
    const controller = new AbortController();
    load(null, controller.signal)
      .then((page) => {
        if (requestId.current !== id) return;
        if (page === "hidden") {
          setState("hidden");
          return;
        }
        setPosts(page.posts);
        setNextCursor(page.nextCursor);
        setState("ready");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        if (requestId.current === id) setState("error");
      });
    return () => controller.abort();
  }, [accountRevision, attempt, load, signedIn]);

  const loadMore = useCallback(() => {
    if (!nextCursor || loadingMore) return;
    const id = requestId.current;
    setLoadingMore(true);
    const controller = new AbortController();
    load(nextCursor, controller.signal)
      .then((page) => {
        if (requestId.current !== id || page === "hidden") return;
        setPosts((current) => {
          const seen = new Set(current.map((post) => post.id));
          return [...current, ...page.posts.filter((post) => !seen.has(post.id))];
        });
        setNextCursor(page.nextCursor);
      })
      .catch(() => {
        if (requestId.current === id) setState("error");
      })
      .finally(() => setLoadingMore(false));
  }, [load, loadingMore, nextCursor]);

  if (!signedIn || state === "hidden") return null;

  return (
    <section id="posts" className="profilePosts" aria-labelledby="profile-posts-title" aria-busy={state === "loading" || loadingMore}>
      <h2 id="profile-posts-title">Posts</h2>
      {state === "loading" ? (
        <p role="status">Loading posts…</p>
      ) : state === "error" ? (
        <div role="alert">
          <EmptyState
            title="Posts are unavailable right now."
            action={
              <button type="button" onClick={() => { setState("loading"); setAttempt((value) => value + 1); }}>
                Retry
              </button>
            }
          />
        </div>
      ) : posts.length === 0 ? (
        <div role="status">
          <EmptyState
            title={isOwn ? "You haven't posted yet. Your first one lands here." : `No posts from @${authorHandle} yet.`}
          />
        </div>
      ) : (
        <div className="socialPostList">
          {posts.map((post) => (
            <SocialPostCard key={post.id} post={post} interactive />
          ))}
          {nextCursor ? (
            <button type="button" className="socialLoadMore" onClick={loadMore} disabled={loadingMore}>
              {loadingMore ? "Loading…" : "Show more posts"}
            </button>
          ) : null}
        </div>
      )}
    </section>
  );
}
