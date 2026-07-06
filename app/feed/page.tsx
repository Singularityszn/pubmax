"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import FeedCard from "@/components/feed/FeedCard";
import FeedFilters from "@/components/feed/FeedFilters";
import SignInButton from "@/components/auth/SignInButton";
import { getAnonId } from "@/lib/anonId";
import {
  applyFeedFilter,
  normalizePintDrop,
  paginate,
  type FeedFilter,
  type FeedItem,
  type PintDropDTO,
} from "@/lib/feed";
import { normalizeHandle } from "@/lib/profiles";
import {
  REACTION_KEYS,
  type ReactionKey,
  type ReactionSummary,
} from "@/lib/reactionsStore";
import "./feed.css";

const PAGE_SIZE = 12;

type LoadState = "loading" | "ready" | "error";

// A per-drop reaction summary map (counts + which the viewer used), keyed by
// drop id. Missing keys render as "no reactions yet" — the card treats absence
// and an empty summary identically.
type SummaryMap = Record<string, ReactionSummary>;

const EMPTY_SUMMARY: ReactionSummary = { counts: {}, mine: [] };

// ── Demo-seed local fallback ──────────────────────────────────────────────────
// Reactions on a persisted drop live in the durable backend. Demo/seed drops
// aren't in visit_reports, so the toggle route answers 404 (UnknownDropError);
// for those we keep a localStorage-only toggle so a sample card still feels
// alive and NEVER crashes. Once a drop id is known-local we skip the network for
// it entirely. The stored value is just the viewer's own `mine` list; counts for
// a local drop are derived from that (each of the viewer's reactions counts 1).
const LOCAL_PREFIX = "pubmax:feed:reactions:";

function readLocalMine(id: string): ReactionKey[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(LOCAL_PREFIX + id);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is ReactionKey =>
      (REACTION_KEYS as readonly string[]).includes(v as string),
    );
  } catch {
    return [];
  }
}

function writeLocalMine(id: string, mine: ReactionKey[]): void {
  try {
    window.localStorage.setItem(LOCAL_PREFIX + id, JSON.stringify(mine));
  } catch {
    // Storage full / denied — the in-memory toggle already updated this session.
  }
}

// A local drop's summary is derived purely from the viewer's own selections:
// each reaction they picked shows a count of 1 (there is no shared backend).
function localSummary(mine: ReactionKey[]): ReactionSummary {
  const counts: Partial<Record<ReactionKey, number>> = {};
  for (const key of mine) counts[key] = 1;
  return { counts, mine };
}

function toggleMine(mine: ReactionKey[], key: ReactionKey): ReactionKey[] {
  return mine.includes(key) ? mine.filter((k) => k !== key) : [...mine, key];
}

export default function FeedPage() {
  // Raw normalized items from the API (the full fetched set); filtering and
  // pagination are derived client-side from this. Fetch happens in an effect,
  // but setState only fires inside the async resolution / catch — never in the
  // effect body (react-hooks/set-state-in-effect).
  const [items, setItems] = useState<FeedItem[]>([]);
  const [status, setStatus] = useState<LoadState>("loading");
  const [filter, setFilter] = useState<FeedFilter>("latest");
  // How many pages the user has revealed. "Load more" bumps this; changing the
  // filter resets it to 1. Cursor pagination is still the engine (below) — this
  // counter just says how many cursor-steps to walk from the top.
  const [pagesLoaded, setPagesLoaded] = useState(1);

  // Durable reactions: one summary map for every drop the viewer has seen. The
  // batch-GET fills it for a freshly-revealed page; a toggle reconciles a single
  // entry from the POST response (or from the local fallback for demo seeds).
  const [summaries, setSummaries] = useState<SummaryMap>({});
  // Drop ids the backend rejected as unknown (demo seeds) — their toggles stay
  // local-only from then on, so we don't re-hit the network for a known 404.
  const localOnly = useRef<Set<string>>(new Set());
  // Which ids we've already asked the summary endpoint for, so revealing another
  // page only requests the newly-visible ids.
  const summarizedIds = useRef<Set<string>>(new Set());
  // The viewer's stable anon id, read once (lazy init, never in an effect).
  const [actorId] = useState<string>(() => getAnonId());

  // The viewer's own handle (localStorage `pubmax_handle`), read after mount so
  // the server render and hydration agree, and the normalized set of handles
  // they follow (fetched once from /api/profiles/<handle>/following). Together
  // they power the Friends lane: null handle or an empty set ⇒ the lane is empty
  // and the page shows a "follow people" prompt. `null` following = not yet
  // loaded (so we don't flash the empty state before the fetch resolves).
  const [myHandle, setMyHandle] = useState("");
  const [followingHandles, setFollowingHandles] = useState<Set<string> | null>(null);

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

  // Read the viewer's own handle after mount (the server can't know
  // localStorage). Done in an async step, not the synchronous effect body, so it
  // satisfies react-hooks/set-state-in-effect (mirrors the /u/[handle] page).
  useEffect(() => {
    let active = true;
    async function loadHandle() {
      try {
        const handle = normalizeHandle(window.localStorage.getItem("pubmax_handle") ?? "");
        if (active) setMyHandle(handle);
      } catch {
        // Storage disabled → stays anonymous; the Friends lane shows its prompt.
      }
    }
    void loadHandle();
    return () => {
      active = false;
    };
  }, []);

  // Fetch the handles the viewer follows once their handle is known. Best-effort
  // and fail-soft: any failure (or no handle) resolves to an empty set, so the
  // Friends lane falls through to its "follow people" state — never a crash.
  // setState only runs inside the async callback (never the effect body).
  useEffect(() => {
    const controller = new AbortController();
    async function loadFollowing() {
      // No handle (viewer anonymous): settle to a known-empty set so the Friends
      // lane renders its prompt rather than waiting on a fetch that never fires.
      // Done in this async step (not the sync effect body) per react-hooks rules.
      if (!myHandle) {
        setFollowingHandles(new Set());
        return;
      }
      try {
        const res = await fetch(`/api/profiles/${encodeURIComponent(myHandle)}/following`, {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as { following?: unknown };
        const list = Array.isArray(data.following) ? data.following : [];
        const set = new Set<string>();
        for (const h of list) {
          const norm = normalizeHandle(typeof h === "string" ? h : "");
          if (norm) set.add(norm);
        }
        setFollowingHandles(set);
      } catch (err) {
        if (controller.signal.aborted || (err instanceof Error && err.name === "AbortError")) {
          return; // expected on unmount / handle change — not an error to surface
        }
        // Fail-soft: an empty set drives the Friends lane's empty state.
        setFollowingHandles(new Set());
      }
    }
    void loadFollowing();
    return () => controller.abort();
  }, [myHandle]);

  // "Load more" is cumulative: walk `paginate` from the top, chaining each
  // step's nextCursor into the next call, for `pagesLoaded` pages. Cursor
  // pagination stays the engine (each step advances by the last item's
  // createdAt|id, never an offset); `nextCursor` being non-null after the last
  // revealed page is what shows the Load-more button.
  const filtered = useMemo(
    () =>
      applyFeedFilter(items, filter, {
        followingHandles: followingHandles ?? undefined,
      }),
    [items, filter, followingHandles],
  );
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

  // Batch-load reaction summaries for whatever is now on screen, in ONE request
  // for the newly-visible ids. Fires whenever the visible set grows (load more,
  // filter change). setState only runs inside the async callback (never the
  // effect body); AbortController cancels an in-flight batch on unmount/change.
  // Demo-seed local summaries are seeded from localStorage in the same pass.
  const visibleIds = useMemo(() => visible.map((i) => i.id), [visible]);
  useEffect(() => {
    const fresh = visibleIds.filter((id) => !summarizedIds.current.has(id));
    if (fresh.length === 0) return;
    // Mark requested up-front so a re-render mid-flight doesn't double-fetch.
    for (const id of fresh) summarizedIds.current.add(id);

    const controller = new AbortController();
    const query = `ids=${encodeURIComponent(fresh.join(","))}&actor=${encodeURIComponent(actorId)}`;
    fetch(`/api/pint-drops/reactions?${query}`, { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((data: { summaries?: SummaryMap }) => {
        const server = data.summaries ?? {};
        setSummaries((prev) => {
          const next = { ...prev };
          for (const id of fresh) {
            // A summary the backend didn't return is a demo seed → derive its
            // summary from any local-only reactions the viewer has stored.
            if (server[id]) next[id] = server[id];
            else next[id] = localSummary(readLocalMine(id));
          }
          return next;
        });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || (err instanceof Error && err.name === "AbortError")) {
          return; // expected on unmount / change — not an error to surface
        }
        // Reactions are best-effort: on failure fall back to any local state so
        // the cards still render their reaction row (never a crash). Let these
        // ids be re-requested on the next pass.
        for (const id of fresh) summarizedIds.current.delete(id);
        setSummaries((prev) => {
          const next = { ...prev };
          for (const id of fresh) if (!next[id]) next[id] = localSummary(readLocalMine(id));
          return next;
        });
      });
    return () => controller.abort();
  }, [visibleIds, actorId]);

  // Toggle one reaction on a drop. Optimistic: flip `mine` + adjust the count
  // immediately, then reconcile from the server's authoritative summary. A 404
  // (demo seed the backend doesn't know) drops this id into local-only mode and
  // persists the toggle to localStorage — so sample cards react without a crash.
  const toggleReaction = useCallback(
    async (dropId: string, reaction: ReactionKey) => {
      // Local-only (a known demo seed) — never hit the network again.
      if (localOnly.current.has(dropId)) {
        setSummaries((prev) => {
          const current = prev[dropId] ?? EMPTY_SUMMARY;
          const mine = toggleMine(current.mine, reaction);
          writeLocalMine(dropId, mine);
          return { ...prev, [dropId]: localSummary(mine) };
        });
        return;
      }

      // Optimistic flip against the current summary.
      let optimisticMine: ReactionKey[] = [];
      setSummaries((prev) => {
        const current = prev[dropId] ?? EMPTY_SUMMARY;
        const on = current.mine.includes(reaction);
        optimisticMine = toggleMine(current.mine, reaction);
        const counts = { ...current.counts };
        counts[reaction] = Math.max(0, (counts[reaction] ?? 0) + (on ? -1 : 1));
        if (counts[reaction] === 0) delete counts[reaction];
        return { ...prev, [dropId]: { counts, mine: optimisticMine } };
      });

      try {
        const res = await fetch("/api/pint-drops/reactions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: dropId, actor: actorId, reaction }),
        });
        if (res.status === 404) {
          // Unknown drop (demo seed): keep the optimistic toggle, persist it
          // locally, and mark the id local-only for future toggles.
          localOnly.current.add(dropId);
          writeLocalMine(dropId, optimisticMine);
          setSummaries((prev) => ({ ...prev, [dropId]: localSummary(optimisticMine) }));
          return;
        }
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as { summary?: ReactionSummary };
        // Reconcile from the source of truth (never trust the optimistic copy).
        if (data.summary) {
          setSummaries((prev) => ({ ...prev, [dropId]: data.summary as ReactionSummary }));
        }
      } catch {
        // Network/500 — best-effort. Revert the optimistic flip so counts stay
        // honest; a retry will re-toggle.
        setSummaries((prev) => {
          const current = prev[dropId] ?? EMPTY_SUMMARY;
          const on = current.mine.includes(reaction);
          const mine = toggleMine(current.mine, reaction);
          const counts = { ...current.counts };
          counts[reaction] = Math.max(0, (counts[reaction] ?? 0) + (on ? -1 : 1));
          if (counts[reaction] === 0) delete counts[reaction];
          return { ...prev, [dropId]: { counts, mine } };
        });
      }
    },
    [actorId],
  );

  function onFilterChange(next: FeedFilter) {
    setFilter(next);
    setPagesLoaded(1);
  }

  const isEmpty = status === "error" || (status === "ready" && filtered.length === 0);
  // The Friends lane is empty *because the viewer follows nobody* (or is
  // anonymous), not because the bar is quiet — show a follow-people prompt with a
  // route to /discover instead of the generic "no pints" copy. Guarded on the
  // following set having loaded, so we don't flash it before the fetch resolves.
  const friendsEmpty =
    filter === "friends" &&
    status === "ready" &&
    followingHandles !== null &&
    (followingHandles.size === 0 || filtered.length === 0);

  return (
    <main className="feedShell">
      <nav className="feedNav" aria-label="Site navigation">
        <Link href="/">Home</Link>
        <Link href="/map">Map</Link>
        <Link href="/feed" aria-current="page">
          Feed
        </Link>
        <Link href="/crawls">Crawls</Link>
        <span className="feedNavAuth">
          <SignInButton />
        </span>
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
      ) : friendsEmpty ? (
        <section className="feedEmpty">
          <p className="feedEmptyEyebrow">Your crew</p>
          <h2>Your Friends feed is empty.</h2>
          <p className="feedEmptyBody">
            Follow people to fill your Friends feed — every pint they drop lands
            here. Find drinkers to follow on the map or over on Discover.
          </p>
          <Link href="/discover" className="feedEmptyCta">
            Find people to follow
          </Link>
        </section>
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
              <FeedCard
                key={item.id}
                item={item}
                summary={summaries[item.id] ?? EMPTY_SUMMARY}
                onToggleReaction={toggleReaction}
              />
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
