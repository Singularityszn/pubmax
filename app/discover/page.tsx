"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { groupVenuePrices, type Venue, type VenuePrice } from "@/lib/venues";
import {
  cheapestPints,
  cheapestTonight,
  type LeaderboardEntry,
  type TonightDrop,
  type TonightEntry,
} from "@/lib/leaderboard";
import { computeThenVsNow, type ThenVsNowItem } from "@/lib/thenVsNow";
import LeaderboardTable from "@/components/discovery/LeaderboardTable";
import TonightBoard from "@/components/discovery/TonightBoard";
import EditorialCard, { type EditorialCardData } from "@/components/discovery/EditorialCard";
import ThenVsNowCard from "@/components/discovery/ThenVsNowCard";
import SiteNav from "@/components/nav/SiteNav";
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

// Narrow the public /api/pint-drops payload to the drop shape our compute
// helpers read. The returned TonightDrop carries {venueId, priceGbp, createdAt}
// (all computeThenVsNow needs) PLUS the optional {handle, venueName} the tonight
// board shows — the same list feeds both sections (one fetch, two computes).
// Defensive: any malformed body yields an empty list so the sections simply
// don't render (never crashes the page).
function pickDrops(raw: unknown): TonightDrop[] {
  if (!raw || typeof raw !== "object") return [];
  const list = (raw as { drops?: unknown }).drops;
  if (!Array.isArray(list)) return [];
  const out: TonightDrop[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const d = item as Record<string, unknown>;
    if (typeof d.venueId !== "string" || !d.venueId) continue;
    out.push({
      venueId: d.venueId,
      priceGbp:
        typeof d.priceGbp === "number" && Number.isFinite(d.priceGbp) ? d.priceGbp : null,
      createdAt: typeof d.createdAt === "string" ? d.createdAt : "",
      handle: typeof d.handle === "string" && d.handle.trim() ? d.handle : undefined,
      venueName:
        typeof d.venueName === "string" && d.venueName.trim() ? d.venueName : undefined,
    });
  }
  return out;
}

export default function DiscoverPage() {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  // "Then vs Now" is best-effort and independent of the leaderboard: it needs
  // BOTH the dataset (for baseline prices + names) and the community drops. If
  // either fetch fails we just leave this empty and show a friendly note — the
  // rest of the page is unaffected.
  const [thenVsNow, setThenVsNow] = useState<ThenVsNowItem[]>([]);
  // "Cheapest pints logged tonight" (PRD §5.1): the live hook. Computed from the
  // SAME community drops as Then vs Now (one fetch, two computes) — the cheapest
  // priced drops in the trailing 24h. Empty until the drops land; if the drops
  // fetch fails it simply stays empty and the board shows its friendly note.
  const [tonight, setTonight] = useState<TonightEntry[]>([]);

  // Fetch the public dataset and rank it. setState only fires in the async
  // handlers (never the effect body) — React 19 set-state-in-effect is an error.
  useEffect(() => {
    const controller = new AbortController();
    fetch("/data/pint_prices_app_dataset.json", { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then(async (rows: VenuePrice[]) => {
        const venues: Venue[] = groupVenuePrices(Array.isArray(rows) ? rows : []);
        setEntries(cheapestPints(venues, 10));
        setStatus("ready");

        // Best-effort community "now" prices. Wrapped so a failed/aborted drops
        // fetch never rejects the dataset chain — worst case the section stays
        // empty and shows its friendly note.
        try {
          const res = await fetch("/api/pint-drops", { signal: controller.signal });
          if (!res.ok) return;
          const body = await res.json();
          const drops = pickDrops(body);
          // Same drops, two computes: the live "tonight" board (last 24h,
          // cheapest-first) and the "then vs now" baseline comparison.
          setTonight(cheapestTonight(drops, { limit: 10 }));
          setThenVsNow(computeThenVsNow(venues, drops, 8));
        } catch (err) {
          if ((err as Error).name === "AbortError") return;
          // Swallow: no community "now" prices → empty section, friendly note.
        }
      })
      .catch((err) => {
        if ((err as Error).name === "AbortError") return;
        setStatus("error");
      });
    return () => controller.abort();
  }, []);

  return (
    <main className="discoverPage">
      <SiteNav active="discover" />

      <header className="discoverHead">
        <p className="discoverEyebrow">Discover</p>
        <h1 className="discoverTitle">There is a story behind every pint.</h1>
        <p className="discoverLede">
          Cheap-pint leaderboards, golden-days routes, and the corners worth
          walking to. PUBMAXXING is more than a map — it&rsquo;s a way back into
          London pub culture.
        </p>
      </header>

      <section className="discoverSection" aria-labelledby="tonight-title">
        <h2 id="tonight-title" className="discoverSectionTitle">
          Cheapest Pints Tonight
        </h2>
        <p className="discoverSectionDek">
          Live from the community — the cheapest pints logged in the last 24
          hours, cheapest first. Community-reported, not gospel.
        </p>
        <TonightBoard entries={tonight} />
      </section>

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

      <section className="discoverSection" aria-labelledby="thenVsNow-title">
        <h2 id="thenVsNow-title" className="discoverSectionTitle">
          Then vs Now
        </h2>
        <p className="discoverSectionDek">
          Today&rsquo;s community-reported pint against the baseline price on
          record — the biggest movers first. Community numbers, not gospel.
        </p>
        {thenVsNow.length === 0 ? (
          <p className="discoverEmpty" role="status">
            Not enough community prices yet to compare.{" "}
            <Link href="/map">Log a pint on the map</Link> to help fill this in.
          </p>
        ) : (
          <div className="tvnGrid">
            {thenVsNow.map((item) => (
              <ThenVsNowCard key={item.venueId} item={item} />
            ))}
          </div>
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
    </main>
  );
}
