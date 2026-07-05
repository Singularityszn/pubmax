"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import FeedCard from "@/components/feed/FeedCard";
import FeedFilters from "@/components/feed/FeedFilters";
import {
  applyFeedFilter,
  normalizePintDrop,
  paginate,
  type FeedFilter,
  type FeedItem,
  type PintDropDTO,
} from "@/lib/feed";
import "./feed.css";

const PAGE_SIZE = 12;

type LoadState = "loading" | "ready" | "error";

export default function FeedPage() {
  // Raw normalized items from the API (the full fetched set); filtering and
  // pagination are derived client-side from this. Fetch happens in an effect,
  // but setState only fires inside the async resolution / catch — never in the
  // effect body (react-hooks/set-state-in-effect).
  const [items, setItems] = useState<FeedItem[]>([]);
  const [status, setStatus] = useState<LoadState>("loading");
  const [filter, setFilter] = useState<FeedFilter>("tonight");
  // How many pages the user has revealed. "Load more" bumps this; changing the
  // filter resets it to 1. Cursor pagination is still the engine (below) — this
  // counter just says how many cursor-steps to walk from the top.
  const [pagesLoaded, setPagesLoaded] = useState(1);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/pint-drops", { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Feed request failed: ${res.status}`);
        const data = (await res.json()) as { drops?: PintDropDTO[] };
        return Array.isArray(data.drops) ? data.drops.map(normalizePintDrop) : [];
      })
      .then((normalized) => {
        setItems(normalized);
        setStatus("ready");
      })
      .catch((err: unknown) => {
        // Abort is expected on unmount — not an error surface.
        if (err instanceof DOMException && err.name === "AbortError") return;
        // Any real failure degrades to the empty state, never a crash.
        setStatus("error");
      });
    return () => controller.abort();
  }, []);

  // "Load more" is cumulative: walk `paginate` from the top, chaining each
  // step's nextCursor into the next call, for `pagesLoaded` pages. Cursor
  // pagination stays the engine (each step advances by the last item's
  // createdAt|id, never an offset); `nextCursor` being non-null after the last
  // revealed page is what shows the Load-more button.
  const filtered = useMemo(() => applyFeedFilter(items, filter), [items, filter]);
  const { visible, nextCursor } = useMemo(() => {
    const acc: FeedItem[] = [];
    let pageCursor: string | null = null;
    for (let p = 0; p < pagesLoaded; p += 1) {
      const step = paginate(filtered, pageCursor, PAGE_SIZE);
      acc.push(...step.items);
      pageCursor = step.nextCursor;
      if (!pageCursor) break; // reached the end before pagesLoaded — stop.
    }
    return { visible: acc, nextCursor: pageCursor };
  }, [filtered, pagesLoaded]);

  function onFilterChange(next: FeedFilter) {
    setFilter(next);
    setPagesLoaded(1);
  }

  const isEmpty = status === "error" || (status === "ready" && filtered.length === 0);

  return (
    <main className="feedShell">
      <nav className="feedNav" aria-label="Site navigation">
        <Link href="/">Home</Link>
        <Link href="/map">Map</Link>
        <Link href="/feed" aria-current="page">
          Feed
        </Link>
        <Link href="/crawls">Crawls</Link>
      </nav>

      <header className="feedHeader">
        <p className="feedEyebrow">InstaPint</p>
        <h1 className="feedTitle">The Pint Feed</h1>
        <p className="feedLede">
          Every pint logged in London tonight — prices, selfies, and the stories
          handed down over the bar.
        </p>
      </header>

      <FeedFilters active={filter} onChange={onFilterChange} />

      {status === "loading" ? (
        <div className="feedList" aria-hidden="true">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="feedCard feedCardSkeleton">
              <div className="feedSkelHead">
                <span className="feedSkelAvatar" />
                <span className="feedSkelLine feedSkelLineShort" />
              </div>
              <div className="feedSkelPhoto" />
              <div className="feedSkelLine" />
              <div className="feedSkelLine feedSkelLineShort" />
            </div>
          ))}
        </div>
      ) : isEmpty ? (
        <section className="feedEmpty">
          <p className="feedEmptyEyebrow">Quiet at the bar</p>
          <h2>No pints logged yet tonight.</h2>
          <p className="feedEmptyBody">
            Be the first to drop one — snap your pint, log the price, pass down a
            story. The feed fills up as London drinks.
          </p>
          <Link href="/map" className="feedEmptyCta">
            Find a pub and drop a pint
          </Link>
        </section>
      ) : (
        <>
          <div className="feedList">
            {visible.map((item) => (
              <FeedCard key={item.id} item={item} />
            ))}
          </div>
          {nextCursor ? (
            <div className="feedLoadMore">
              <button
                type="button"
                className="feedLoadMoreBtn"
                onClick={() => setPagesLoaded((n) => n + 1)}
              >
                Load more pints
              </button>
            </div>
          ) : (
            <p className="feedEnd">You&rsquo;ve reached the bottom of the barrel.</p>
          )}
        </>
      )}
    </main>
  );
}
