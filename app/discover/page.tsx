"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

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
import TopRatedPubs from "@/components/ratings/TopRatedPubs";
import { CategoryShowcase } from "@/components/drinks/CategoryShowcase";
import {
  brandsForCategory,
  categoryHasBrandCoverage,
} from "@/lib/drinkBrands";
import { CATEGORY_META, type DrinkCategory } from "@/lib/drinks";
import { runDiscoverAnalysisLoad, scheduleDiscoverAnalysisLoad } from "@/lib/discoverLazy";
import "./discover.css";

// "Explore by drink" → /map deep-link. decodeCrawl (lib/crawlUrl) maps these:
//   cocktail → requireCocktails + drinkCategory
//   wine / spirits / beer → drinkCategory (+ optional brand)
// low-no uses LOW_NO_HREF below (requireNonAlcoholic + mocktail alt).
function exploreHref(category: DrinkCategory, brandId?: string): string {
  const params = new URLSearchParams({ drink: category });
  if (category === "cocktail") params.set("cocktails", "1");
  if (brandId) params.set("brand", brandId);
  return `/map?${params.toString()}`;
}

const LOW_NO_HREF = "/map?drink=low-no&low=1&alt=mocktail";

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
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">(
    "idle",
  );
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
  // venue id → name, for the "Top rated pubs this month" section (E3): the
  // ratings API returns venue ids; names come from the SAME dataset fetch the
  // leaderboard already makes (no second dataset read).
  const [venueNames, setVenueNames] = useState<Record<string, string>>({});
  const [activeDrink, setActiveDrink] = useState<DrinkCategory | null>(null);
  const analysisRef = useRef<HTMLElement | null>(null);
  const brandPanelRef = useRef<HTMLDivElement | null>(null);

  // Defer the 5.9MB public dataset until the data-heavy sections are near the
  // viewport. The route shell and drink categories can paint without competing
  // with the dataset download + grouping work on mobile.
  useEffect(() => {
    const controller = new AbortController();
    const startAnalysis = () => {
      void runDiscoverAnalysisLoad({
        signal: controller.signal,
        setStatus,
        loadDataset: async () => {
          const res = await fetch("/data/pint_prices_app_dataset.json", {
            signal: controller.signal,
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const rows = (await res.json()) as VenuePrice[];
          return groupVenuePrices(Array.isArray(rows) ? rows : []);
        },
        applyDataset: (venues: Venue[]) => {
          setEntries(cheapestPints(venues, 10));
          setVenueNames(
            Object.fromEntries(venues.map((venue) => [venue.id, venue.name])),
          );
        },
        loadDrops: async () => {
          const res = await fetch("/api/pint-drops", {
            signal: controller.signal,
          });
          if (!res.ok) return [];
          const body = await res.json();
          return pickDrops(body);
        },
        applyDrops: (venues: Venue[], drops: TonightDrop[]) => {
          // Same drops, two computes: the live "tonight" board (last 24h,
          // cheapest-first) and the "then vs now" baseline comparison.
          setTonight(cheapestTonight(drops, { limit: 10 }));
          setThenVsNow(computeThenVsNow(venues, drops, 8));
        },
        // Community "now" prices are best-effort: a non-abort failure still
        // leaves the rest of the page ready, with empty sections and friendly copy.
        onDropsError: () => {},
      });
    };

    const cancelScheduledLoad = scheduleDiscoverAnalysisLoad({
      target: analysisRef.current,
      start: startAnalysis,
    });

    return () => {
      cancelScheduledLoad();
      controller.abort();
    };
  }, []);

  useEffect(() => {
    if (!activeDrink || !brandPanelRef.current) return;
    brandPanelRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [activeDrink]);

  const activeBrands = activeDrink ? brandsForCategory(activeDrink) : [];
  const activeLabel = activeDrink ? CATEGORY_META[activeDrink].label : "";

  return (
    <main className="discoverPage">
      <SiteNav active="discover" />

      <header className="discoverHead">
        <p className="discoverEyebrow">Drinks</p>
        <h1 className="discoverTitle">There is a story behind every pint.</h1>
        <p className="discoverLede">
          Pick your poison, your nectar, or your 0.0. PUBMAXXING follows every
          kind of round — beer, wine, gin, vodka, rum, cocktails, shots, and the
          soft drinks that keep the night moving.
        </p>
      </header>

      <section className="discoverSection" aria-labelledby="explore-title">
        <h2 id="explore-title" className="discoverSectionTitle">
          Choose your drink
        </h2>
        <p className="discoverSectionDek">
          Every drink has a colour. Pick the family you want in hand — a cheap
          pint, a house red, a gin and tonic, or the low/no option for one more
          stop before the last train.
        </p>
        <CategoryShowcase
          title=""
          hrefFor={exploreHref}
          cardHint="Choose this"
          className="discoverExplore"
          extraItemsPosition="start"
          onCategoryActivate={setActiveDrink}
          activeCategory={activeDrink}
          extraItems={
            <li
              className="catShowcase__item discoverLowNoItem"
              style={{ ["--cat" as string]: "var(--pint)" } as React.CSSProperties}
            >
              <Link
                className="catShowcase__link discoverLowNoLink"
                href={LOW_NO_HREF}
                aria-label="Explore low and no alcohol drinks"
              >
                <span
                  className="catShowcase__swatch discoverLowNoBadge"
                  style={{ color: "var(--pint)" }}
                  aria-hidden="true"
                >
                  0.0
                </span>
                <span className="catShowcase__labelWrap">
                  <span className="catShowcase__label">Low / No</span>
                  <span className="catShowcase__hint">Choose this</span>
                </span>
              </Link>
            </li>
          }
        />

        {activeDrink ? (
          <div
            ref={brandPanelRef}
            className="discoverBrandPanel"
            aria-labelledby="discover-brand-title"
          >
            <div className="discoverBrandHead">
              <h3 id="discover-brand-title" className="discoverBrandTitle">
                {activeLabel} brands
              </h3>
              <Link className="discoverBrandAll" href={exploreHref(activeDrink)}>
                Any {activeLabel.toLowerCase()} on the map
              </Link>
            </div>
            {categoryHasBrandCoverage(activeDrink) ? (
              <>
                <p className="discoverBrandDek">
                  Jump straight to a label — coverage is still thin outside beer,
                  so some brands may show few pins until menus fill in.
                </p>
                <ul className="discoverBrandChips">
                  {activeBrands.map((brand) => (
                    <li key={brand.id}>
                      <Link
                        className="discoverBrandChip"
                        href={exploreHref(activeDrink, brand.id)}
                      >
                        {brand.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="discoverBrandEmpty" role="status">
                We don&rsquo;t have curated {activeLabel.toLowerCase()} brands yet —
                open the map for the whole category, or pick another drink family.
              </p>
            )}
          </div>
        ) : null}
      </section>

      <section
        ref={analysisRef}
        className="discoverSection"
        aria-labelledby="tonight-title"
      >
        <h2 id="tonight-title" className="discoverSectionTitle">
          Cheapest Pints Tonight
        </h2>
        <p className="discoverSectionDek">
          Live from the community — the cheapest pints logged in the last 24
          hours, cheapest first. Community-reported, not gospel.
        </p>
        {status === "idle" ? (
          <p className="discoverEmpty" role="status">
            Tonight&rsquo;s prices load as you reach the rankings.
          </p>
        ) : status === "loading" ? (
          <p className="discoverEmpty" role="status">
            Loading tonight&rsquo;s prices…
          </p>
        ) : status === "error" ? (
          <p className="discoverEmpty" role="status">
            Couldn&rsquo;t load tonight&rsquo;s prices just now.{" "}
            <Link href="/map">Open the map</Link> instead.
          </p>
        ) : (
          <TonightBoard entries={tonight} />
        )}
      </section>

      <section className="discoverSection" aria-labelledby="topRated-title">
        <h2 id="topRated-title" className="discoverSectionTitle">
          Top rated pubs this month
        </h2>
        <p className="discoverSectionDek">
          Ranked by the community&rsquo;s stars over the last thirty days. A pub
          needs ten ratings to make the list — honest scores, no seeded numbers.
        </p>
        {status === "idle" ? (
          <p className="discoverEmpty" role="status">
            Community ratings load with the rankings below.
          </p>
        ) : (
          <TopRatedPubs venueNames={venueNames} />
        )}
      </section>

      <section className="discoverSection" aria-labelledby="cheap-title">
        <h2 id="cheap-title" className="discoverSectionTitle">
          Cheap Pint Leaderboard
        </h2>
        <p className="discoverSectionDek">
          The ten cheapest taps on the map right now.
        </p>
        {status === "idle" ? (
          <p className="discoverEmpty" role="status">
            The cheap pint table loads when you reach the rankings.
          </p>
        ) : status === "loading" ? (
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
        <p className="discoverSectionNote">
          Then = dataset baseline. Now = latest community report.
        </p>
        {status === "idle" ? (
          <p className="discoverEmpty" role="status">
            Price comparisons load when you reach the rankings.
          </p>
        ) : status === "loading" ? (
          <p className="discoverEmpty" role="status">
            Comparing baseline prices…
          </p>
        ) : status === "error" ? (
          <p className="discoverEmpty" role="status">
            Couldn&rsquo;t load price comparisons just now.{" "}
            <Link href="/map">Open the map</Link> instead.
          </p>
        ) : thenVsNow.length === 0 ? (
          <p className="discoverEmpty" role="status">
            Not enough community prices yet to compare.{" "}
            <Link href="/map?log=1">Log a pint on the map</Link> to help fill this in.
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
