"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { groupVenuePrices, type Venue, type VenuePrice } from "@/lib/venues";
import { cheapestPints, type LeaderboardEntry } from "@/lib/leaderboard";
import LeaderboardTable from "@/components/discovery/LeaderboardTable";
import EditorialCard, { type EditorialCardData } from "@/components/discovery/EditorialCard";
import "./discover.css";

// Static editorial lanes. Real content, real links into the planner — the copy
// is nostalgic/cultural but each card is a genuine anchor into /map or /crawls.
const EDITORIAL: EditorialCardData[] = [
  {
    id: "golden-days",
    eyebrow: "Golden days",
    title: "The old guard, still standing",
    dek: "Victorian gin palaces, listed snugs, and the bar Dickens actually leaned on — a walk through the London that refuses to close.",
    href: "/map?style=heritage",
    cta: "Walk the heritage route",
  },
  {
    id: "coding-pint",
    eyebrow: "Coding pint",
    title: "A quiet table and a slow pint",
    dek: "Sockets, decent Wi-Fi, and a late-afternoon lull — the pubs that double as the best co-working room in the city.",
    href: "/map",
    cta: "Find a working pint",
  },
  {
    id: "then-vs-now",
    eyebrow: "Then vs now",
    title: "What a pint used to cost",
    dek: "The cheapest taps in town, ranked. Proof the good £4 pint isn't extinct — you just have to know where to walk.",
    href: "/crawls",
    cta: "Build a cheap crawl",
  },
  {
    id: "tonights-crawl",
    eyebrow: "Tonight",
    title: "Tonight's crawl, sorted",
    dek: "Pick a borough, set your price, and let the river do the routing. Every pin is a pint worth knowing about.",
    href: "/map",
    cta: "Plan tonight",
  },
];

export default function DiscoverPage() {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  // Fetch the public dataset and rank it. setState only fires in the async
  // handlers (never the effect body) — React 19 set-state-in-effect is an error.
  useEffect(() => {
    const controller = new AbortController();
    fetch("/data/pint_prices_app_dataset.json", { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((rows: VenuePrice[]) => {
        const venues: Venue[] = groupVenuePrices(Array.isArray(rows) ? rows : []);
        setEntries(cheapestPints(venues, 10));
        setStatus("ready");
      })
      .catch((err) => {
        if ((err as Error).name === "AbortError") return;
        setStatus("error");
      });
    return () => controller.abort();
  }, []);

  return (
    <div className="discoverPage">
      <nav className="siteNav" aria-label="Site navigation">
        <Link href="/">Home</Link>
        <Link href="/map">Map</Link>
        <Link href="/feed">Feed</Link>
        <Link href="/discover" aria-current="page">
          Discover
        </Link>
        <Link href="/crawls">Crawls</Link>
      </nav>

      <header className="discoverHead">
        <p className="discoverEyebrow">Discover</p>
        <h1 className="discoverTitle">There is a story behind every pint.</h1>
        <p className="discoverLede">
          Cheap-pint leaderboards, golden-days routes, and the corners worth
          walking to. PUBMAXXING is more than a map — it&rsquo;s a way back into
          London pub culture.
        </p>
      </header>

      <section className="discoverSection" aria-labelledby="cheap-title">
        <h2 id="cheap-title" className="discoverSectionTitle">
          Cheap Pint Leaderboard
        </h2>
        <p className="discoverSectionDek">
          The ten cheapest taps on the map right now.
        </p>
        {status === "loading" ? (
          <p className="discoverEmpty" role="status">
            Counting the cheapest pints…
          </p>
        ) : status === "error" ? (
          <p className="discoverEmpty" role="status">
            Couldn&rsquo;t load the leaderboard just now.{" "}
            <Link href="/map">Open the map</Link> instead.
          </p>
        ) : (
          <LeaderboardTable entries={entries} />
        )}
      </section>

      <section className="discoverSection" aria-labelledby="editorial-title">
        <h2 id="editorial-title" className="discoverSectionTitle">
          Ways to drink through the city
        </h2>
        <div className="editorialGrid">
          {EDITORIAL.map((card) => (
            <EditorialCard key={card.id} {...card} />
          ))}
        </div>
      </section>
    </div>
  );
}
