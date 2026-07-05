"use client";

import Link from "next/link";
import { Check, Copy, MapPin } from "lucide-react";
import { useMemo, useState } from "react";

import { decodeCrawlStory, totalGbp, type CrawlStory } from "@/lib/crawlStory";
import "./crawls.css";

function formatGbp(value: number): string {
  return `£${value.toFixed(2)}`;
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

export default function CrawlsPage() {
  // Read ?s= once, lazily, from the URL. Never on an effect (react-hooks rule);
  // decode never throws, so a garbage param falls through to the empty state.
  const story = useMemo<CrawlStory | null>(() => {
    if (typeof window === "undefined") return null;
    const param = new URLSearchParams(window.location.search).get("s");
    return decodeCrawlStory(param);
  }, []);

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
      <nav className="siteNav appNav" aria-label="Site navigation">
        <Link href="/">Home</Link>
        <Link href="/map">Map</Link>
        <Link href="/admin">Admin</Link>
      </nav>

      {story ? (
        <CrawlPoster story={story} copied={copied} onCopy={copyShareLink} />
      ) : (
        <section className="crawlEmpty">
          <p className="crawlEyebrow">Crawl Story</p>
          <h1>No crawl to show here yet.</h1>
          <p className="crawlEmptyBody">
            A Crawl Story is a shareable poster of a London pub crawl — the stops, the prices,
            the vibe. Build one on the map, hit <strong>Save as story</strong>, and share the
            link.
          </p>
          <Link href="/map" className="crawlPrimaryBtn">
            <MapPin size={16} aria-hidden="true" /> Build a crawl on the map
          </Link>
        </section>
      )}
    </main>
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
          {copied ? "Copied!" : "Copy share link"}
        </button>
      </div>

      <p className="crawlFootnote">Every pint has a story.</p>
    </article>
  );
}
