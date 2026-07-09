"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, Copy, MapPin, Flag, Users } from "lucide-react";
import { Suspense, useMemo, useState } from "react";

import { normalizeHandle } from "@/lib/profiles";
import type { RoundState } from "@/lib/rounds";

import { decodeCrawlStory, totalGbp, type CrawlStory } from "@/lib/crawlStory";
import { curatedCrawls, type CuratedCrawl } from "@/lib/curatedCrawls";
import { landmarks } from "@/lib/landmarks";
import { bandById } from "@/lib/storyBands";
import { routePacks, getRoutePack } from "@/lib/routePacks";
import SiteNav from "@/components/nav/SiteNav";
import "./crawls.css";

// The landmark a crawl starts at (story 27) — "starts at Big Ben"-style chip.
// Undefined when the crawl carries no startLandmarkId, or it points at an id
// that isn't a real landmark (defensive: never crash the crawls page over a
// stale reference).
function startLandmarkName(crawl: CuratedCrawl): string | undefined {
  if (!crawl.startLandmarkId) return undefined;
  return landmarks.find((lm) => lm.id === crawl.startLandmarkId)?.name;
}

function formatGbp(value: number): string {
  return `£${value.toFixed(2)}`;
}

// Turn a camelCase CrawlStyle ("writerTrail") into a human badge label
// ("Writer Trail"). Single-word styles ("heritage") just get capitalised.
function styleLabel(style: string): string {
  return style
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (char) => char.toUpperCase());
}

// Reproduce a curated crawl on the map — same share-URL shape as planCrawlHref,
// but the ids come straight off the pinned curated entry (no story to unpack).
function curatedCrawlHref(crawl: CuratedCrawl): string {
  const params = new URLSearchParams();
  params.set("mode", "build");
  params.set("pubs", crawl.venueIds.join(","));
  // Wave F2: open the Place story corridor alongside the mapped stops.
  if (crawl.placeStoryBandId) params.set("band", crawl.placeStoryBandId);
  return `/map?${params.toString()}`;
}

// Reproduce a crawl on the map from a story's stop ids, matching the existing
// share-URL format read by seedCrawlState (mode=build&pubs=id1,id2). Stops that
// carry no venueId (e.g. a hand-authored story) just aren't planned back.
function planCrawlHref(story: CrawlStory): string {
  const ids = story.stops.map((stop) => stop.venueId).filter(Boolean);
  if (ids.length === 0) return "/map";
  const params = new URLSearchParams();
  params.set("mode", "build");
  params.set("pubs", ids.join(","));
  return `/map?${params.toString()}`;
}

function CrawlsPageInner() {
  // useSearchParams so client navigations between ?pack= links re-filter the
  // curated grid (a mount-only window.location read would stick on the first pack).
  const searchParams = useSearchParams();
  const activePackId = searchParams.get("pack");
  const activePack = activePackId ? getRoutePack(activePackId) : undefined;
  const activePackCrawlIds = activePack ? new Set(activePack.crawlIds) : null;
  const visibleCrawls = activePackCrawlIds
    ? curatedCrawls.filter((crawl) => activePackCrawlIds.has(crawl.id))
    : curatedCrawls;

  // Read ?s= from the live search params so client navigations stay in sync.
  // decode never throws, so a garbage param falls through to the empty state.
  const story = useMemo<CrawlStory | null>(
    () => decodeCrawlStory(searchParams.get("s")),
    [searchParams],
  );

  const [copied, setCopied] = useState(false);
  async function copyShareLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard denied (permissions / insecure origin) — no-op, no crash.
    }
  }

  return (
    <main className="crawlsShell">
      <SiteNav active="crawls" />

      {story ? (
        <CrawlPoster story={story} copied={copied} onCopy={copyShareLink} />
      ) : (
        <section className="crawlEmpty" aria-labelledby="crawlsHeading">
          <p className="crawlEyebrow">Crawls worth walking</p>
          <h1 id="crawlsHeading">Every pint has a story.</h1>
          <p className="crawlEmptyBody">
            A Crawl Story is a shareable poster of a London pub crawl — the stops, the prices,
            the vibe. Here are a few routes worth the walk, handed down from the old hands who
            drank them first. Pick one, or start your own on the map.
          </p>

          <div className="routePacks" aria-labelledby="routePacksHeading">
            <p className="crawlEyebrow" id="routePacksHeading">
              Route packs
            </p>
            <ul className="routePackList">
              {routePacks.map((pack) => {
                const href = `/crawls?pack=${encodeURIComponent(pack.id)}`;
                const isActive = activePackId === pack.id;
                return (
                  <li key={pack.id}>
                    <Link
                      href={href}
                      className={isActive ? "routePackLink isActive" : "routePackLink"}
                      aria-label={`Show ${pack.title} pack routes`}
                      aria-current={isActive ? "true" : undefined}
                    >
                      <span className="routePackTitle">{pack.title}</span>
                      <span className="routePackBlurb">{pack.blurb}</span>
                      <span className="routePackMeta">
                        {pack.crawlIds.length} route{pack.crawlIds.length === 1 ? "" : "s"}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
            {activePack ? (
              <p className="routePackActiveNote">
                Showing {activePack.title} routes.{" "}
                <Link href="/crawls">Show all crawls</Link>
              </p>
            ) : null}
          </div>

          <ul className="curatedGrid" aria-label="Curated crawls worth walking">
            {visibleCrawls.map((crawl) => {
              const originName = startLandmarkName(crawl);
              const placeStory = crawl.placeStoryBandId
                ? bandById(crawl.placeStoryBandId)
                : undefined;
              return (
                <li key={crawl.id} id={crawl.id} className="curatedCard">
                  <span className="curatedBadge">{styleLabel(crawl.crawlStyle)}</span>
                  <h2 className="curatedName">{crawl.name}</h2>
                  <p className="curatedBlurb">{crawl.blurb}</p>
                  {originName ? (
                    <span className="curatedOriginChip">
                      <Flag size={12} aria-hidden="true" /> Starts at {originName}
                    </span>
                  ) : null}
                  {placeStory ? (
                    <span className="curatedOriginChip curatedPlaceStoryChip">
                      Place story · {placeStory.title}
                    </span>
                  ) : null}
                  <p className="curatedMeta">
                    {crawl.venueIds.length} stop{crawl.venueIds.length === 1 ? "" : "s"}
                  </p>
                  <Link
                    href={curatedCrawlHref(crawl)}
                    className="curatedLink"
                    aria-label={`Plan the ${crawl.name} crawl on the map`}
                  >
                    Plan this crawl →
                  </Link>
                </li>
              );
            })}
          </ul>

          <RoundStarter />

          <p className="crawlEmptyBody crawlOwnLead">
            Or build your own — pick the pubs, pass the round on.
          </p>
          <Link href="/map" className="crawlPrimaryBtn">
            <MapPin size={16} aria-hidden="true" /> Build your own crawl on the map
          </Link>
        </section>
      )}
    </main>
  );
}

// Start a Round: the group-crawl entry point (GH #26). A small additive card that
// mints a Round and drops you onto its live page. Identity is the self-asserted
// handle (localStorage `pubmax_handle`, shared with the rest of the social layer);
// we ask for it inline when the device doesn't have one yet.
function RoundStarter(): React.JSX.Element {
  const router = useRouter();
  const [handle, setHandle] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    try {
      return normalizeHandle(window.localStorage.getItem("pubmax_handle") ?? "");
    } catch {
      return "";
    }
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start(event: React.FormEvent) {
    event.preventDefault();
    const clean = normalizeHandle(handle);
    if (!clean) {
      setError("Pick a handle to start a Round.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      window.localStorage.setItem("pubmax_handle", clean);
    } catch {
      // storage disabled — the Round still starts, handle just isn't remembered
    }
    try {
      const res = await fetch("/api/rounds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ handle: clean }),
      });
      const data = (await res.json()) as RoundState | { error: string };
      if (res.ok) {
        router.push(`/rounds/${(data as RoundState).round.code}`);
      } else {
        setError((data as { error: string }).error ?? "Could not start the Round.");
        setBusy(false);
      }
    } catch {
      setError("Could not start the Round. Try again.");
      setBusy(false);
    }
  }

  return (
    <form className="roundStarter" onSubmit={start}>
      <span className="roundStarterBadge">
        <Users size={14} aria-hidden="true" /> The Round · group crawl
      </span>
      <h2 className="roundStarterTitle">Start a Round</h2>
      <p className="roundStarterBlurb">
        A group crawl that builds itself. Friends join by a short code; as everyone drops pints,
        the route grows itself, stop by stop.
      </p>
      <div className="roundStarterRow">
        <input
          type="text"
          value={handle}
          onChange={(e) => setHandle(e.target.value)}
          placeholder="your handle"
          aria-label="Your handle"
          autoComplete="off"
          maxLength={30}
        />
        <button type="submit" className="crawlPrimaryBtn" disabled={busy}>
          <Users size={16} aria-hidden="true" /> {busy ? "Starting…" : "Start a Round"}
        </button>
      </div>
      {error ? (
        <p className="roundStarterError" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}

function CrawlPoster({
  story,
  copied,
  onCopy,
}: {
  story: CrawlStory;
  copied: boolean;
  onCopy: () => void;
}) {
  const total = totalGbp(story);
  const pricedStops = story.stops.filter((stop) => typeof stop.priceGbp === "number").length;

  return (
    <article className="crawlPoster">
      <header className="crawlPosterHead">
        <p className="crawlEyebrow">A London crawl</p>
        <h1>{story.title || "An untitled crawl"}</h1>
        {story.caption ? <p className="crawlCaption">{story.caption}</p> : null}
        {story.vibeTags.length ? (
          <ul className="crawlTags" aria-label="Crawl vibe tags">
            {story.vibeTags.map((tag) => (
              <li key={tag} className="crawlTag">
                {tag}
              </li>
            ))}
          </ul>
        ) : null}
      </header>

      <ol className="crawlStops">
        {story.stops.map((stop, index) => (
          <li key={`${stop.venueId || stop.name}-${index}`} className="crawlStop">
            <span className="crawlStopNumber" aria-hidden="true">
              {index + 1}
            </span>
            <div className="crawlStopBody">
              <strong>{stop.name}</strong>
              {stop.note ? <p className="crawlStopNote">{stop.note}</p> : null}
            </div>
            <span className="crawlStopPrice">
              {typeof stop.priceGbp === "number" ? formatGbp(stop.priceGbp) : "—"}
            </span>
          </li>
        ))}
      </ol>

      <div className="crawlReceipt" role="group" aria-label="Crawl total">
        <span>
          Round total
          <small>
            {pricedStops} of {story.stops.length} stop{story.stops.length === 1 ? "" : "s"} priced
          </small>
        </span>
        <strong>{formatGbp(total)}</strong>
      </div>

      <div className="crawlActions">
        <Link href={planCrawlHref(story)} className="crawlPrimaryBtn">
          <MapPin size={16} aria-hidden="true" /> Plan this crawl
        </Link>
        <button type="button" className="crawlSecondaryBtn" onClick={onCopy}>
          {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
          {/* aria-live announces the "Copied!" confirmation to screen readers
              without needing a separate status region — the button's own
              accessible name updates and is polite (non-interrupting). */}
          <span aria-live="polite">{copied ? "Copied!" : "Copy share link"}</span>
        </button>
      </div>

      <p className="crawlFootnote">Every pint has a story.</p>
    </article>
  );
}

export default function CrawlsPage() {
  // Suspense boundary required by Next.js when a client page uses useSearchParams
  // during static prerender — without it, /crawls fails the production build.
  return (
    <Suspense fallback={<main className="crawlsShell" aria-busy="true" />}>
      <CrawlsPageInner />
    </Suspense>
  );
}
