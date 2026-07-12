"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

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
import CityRivalryTable from "@/components/discovery/CityRivalryTable";
import TonightBoard from "@/components/discovery/TonightBoard";
import EditorialCard, { type EditorialCardData } from "@/components/discovery/EditorialCard";
import TonightNearbyLane from "@/components/discovery/TonightNearbyLane";
import DealsTonightLane from "@/components/discovery/DealsTonightLane";
import GardenTonightCard from "@/components/discovery/GardenTonightCard";
import ThenVsNowCard from "@/components/discovery/ThenVsNowCard";
import SiteNav from "@/components/nav/SiteNav";
import TopRatedPubs from "@/components/ratings/TopRatedPubs";
import { CategoryShowcase } from "@/components/drinks/CategoryShowcase";
import { brandsForCategory } from "@/lib/drinkBrands";
import type { DrinkCategory } from "@/lib/drinks";
import { KNOWN_CUISINE_TAGS } from "@/lib/cuisineTags";
import type { CityRivalryEntry } from "@/lib/cityRivalry";
import { runDiscoverAnalysisLoad, scheduleDiscoverAnalysisLoad } from "@/lib/discoverLazy";
import { DEFAULT_CITY_ID, type CityId } from "@/lib/cities";
import {
  readPreferredCity,
  subscribePreferredCity,
  preferredCityMapHref,
} from "@/lib/cityPreference";
import {
  cityAwareMapPath,
  curatedCrawlById,
  curatedCrawlMapHref,
} from "@/lib/curatedCrawls";
import { getRoutePack, routePackPrimaryCrawl } from "@/lib/routePacks";
import "./discover.css";

/** Discover Hungry chips → map with food filter + cuisine hint in the query. */
function hungryCuisineHref(tag: string, cityId: CityId): string {
  const params = new URLSearchParams({ food: "1", q: tag });
  return cityAwareMapPath(cityId, params);
}

/** Cuisine chips shown on Discover — a short, scannable subset. */
const DISCOVER_CUISINE_CHIPS = [
  "roast",
  "gastropub",
  "burger",
  "pizza",
  "tapas",
  "pie",
  "thai",
  "italian",
] as const satisfies ReadonlyArray<(typeof KNOWN_CUISINE_TAGS)[number]>;

/** Brand jump chips — beer + wine only (honest coverage on the map). */
const JUMP_BY_BRAND_CATEGORIES = ["beer", "wine"] as const satisfies ReadonlyArray<DrinkCategory>;

// "Explore by drink" → /map deep-link. decodeCrawl (lib/crawlUrl) maps these:
//   cocktail → requireCocktails + drinkCategory
//   wine / spirits / beer → drinkCategory (+ optional brand)
// low-no uses LOW_NO params below (requireNonAlcoholic + mocktail alt).
function exploreHref(
  category: DrinkCategory,
  cityId: CityId,
  brandId?: string,
): string {
  const params = new URLSearchParams({ drink: category });
  if (category === "cocktail") params.set("cocktails", "1");
  if (brandId) params.set("brand", brandId);
  return cityAwareMapPath(cityId, params);
}

function hungryHref(cityId: CityId): string {
  return cityAwareMapPath(cityId, new URLSearchParams({ food: "1" }));
}

function lowNoHref(cityId: CityId): string {
  return cityAwareMapPath(
    cityId,
    new URLSearchParams({ drink: "low-no", low: "1", alt: "mocktail" }),
  );
}

/** Map-first crawl href, or city map if the curated id is missing. */
function crawlMapHref(crawlId: string, cityId: CityId): string {
  const crawl = curatedCrawlById(crawlId);
  return crawl
    ? curatedCrawlMapHref(crawl, cityId)
    : cityAwareMapPath(cityId);
}

/** Map-first pack lead crawl, or city map if the pack is empty. */
function packMapHref(packId: string, cityId: CityId): string {
  const pack = getRoutePack(packId);
  if (!pack) return cityAwareMapPath(cityId);
  const primary = routePackPrimaryCrawl(pack);
  return primary
    ? curatedCrawlMapHref(primary, cityId)
    : cityAwareMapPath(cityId);
}

// Static editorial lanes. Each CTA opens /map with a real crawl polyline
// (curatedCrawlMapHref / routePackMapHref) — not a bare filter or list page.
// These crawls are London editorial (Soho / Barbican / packs). Always omit an
// explicit preferredCity so venue-derived city wins — never ship Victorian Soho
// onto `/map/manchester` just because the viewer last chose Manchester.
function buildEditorial(): EditorialCardData[] {
  return [
    {
      id: "golden-days",
      eyebrow: "Golden days",
      title: "The old guard, still standing",
      dek: "Victorian gin palaces, listed snugs, and the bar Dickens actually leaned on — a walk through the London that refuses to close.",
      href: crawlMapHref("victorian-soho", DEFAULT_CITY_ID),
      cta: "Walk the heritage route",
    },
    {
      id: "coding-pint",
      eyebrow: "Coding pint",
      title: "A quiet table and a slow pint",
      dek: "Sockets, decent Wi-Fi, and a late-afternoon lull — the pubs that double as the best co-working room in the city.",
      href: crawlMapHref("barbican-coding-pint", DEFAULT_CITY_ID),
      cta: "Find a working pint",
    },
    {
      id: "then-vs-now",
      eyebrow: "Then vs now",
      title: "What a pint used to cost",
      dek: "The cheapest taps in town, ranked. Proof the good £4 pint isn't extinct — you just have to know where to walk.",
      href: packMapHref("cheap-chaos", DEFAULT_CITY_ID),
      cta: "Build a cheap crawl",
    },
    {
      id: "tonights-crawl",
      eyebrow: "Tonight",
      title: "Tonight's crawl, sorted",
      dek: "Pick a borough, set your price, and let the river do the routing. Every pin is a pint worth knowing about.",
      href: packMapHref("late-train", DEFAULT_CITY_ID),
      cta: "Plan tonight",
    },
  ];
}

/** Exported for unit tests — Discover editorial CTAs must stay map-first. */
export const DISCOVER_EDITORIAL = buildEditorial();

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

type DiscoverPageClientProps = {
  rivalry: CityRivalryEntry[];
};

export default function DiscoverPageClient({ rivalry }: DiscoverPageClientProps) {
  const preferredCity = useSyncExternalStore(
    subscribePreferredCity,
    () => readPreferredCity() ?? DEFAULT_CITY_ID,
    () => DEFAULT_CITY_ID, // SSR snapshot
  );
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
  const analysisRef = useRef<HTMLElement | null>(null);
  const revealRootRef = useRef<HTMLElement | null>(null);

  // Editorial stays London-authored; drink/food chips still follow preferred city.
  const editorial = buildEditorial();
  const hungryMapHref = hungryHref(preferredCity);
  const lowNoMapHref = lowNoHref(preferredCity);
  const openMapHref = preferredCityMapHref();
  const logPintHref = preferredCityMapHref(new URLSearchParams({ log: "1" }));

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

  // Scroll entrance for the leaderboard / tonight / then-vs-now / editorial
  // cards (see [data-reveal] in discover.css): each of those rows/cards only
  // exists in the DOM once its section's fetch resolves (or, for editorial,
  // at mount), so this re-scans whenever that state changes and hands any
  // newly-mounted [data-reveal] element to a one-shot IntersectionObserver.
  // Reduced-motion users never see the opacity:0 starting state at all (that
  // rule lives behind a no-preference query), so this is purely additive.
  useEffect(() => {
    const root = revealRootRef.current;
    if (!root) return;
    const targets = root.querySelectorAll<HTMLElement>(
      "[data-reveal]:not(.is-revealed)",
    );
    if (targets.length === 0) return;
    if (typeof IntersectionObserver === "undefined") {
      targets.forEach((el) => el.classList.add("is-revealed"));
      return;
    }
    const observer = new IntersectionObserver(
      (observedEntries) => {
        for (const observed of observedEntries) {
          if (observed.isIntersecting) {
            observed.target.classList.add("is-revealed");
            observer.unobserve(observed.target);
          }
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" },
    );
    targets.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [entries, tonight, thenVsNow]);

  return (
    <main className="discoverPage" ref={revealRootRef}>
      <SiteNav active="discover" />

      <header className="discoverHead">
        <p className="discoverEyebrow">Pint stories</p>
        <h1 className="discoverTitle">There is a story behind every pint.</h1>
        <p className="discoverLede">
          Pick your poison, your nectar, or your 0.0. PUBMAXXING follows every
          kind of round — beer, wine, gin, vodka, rum, cocktails, shots, and the
          soft drinks that keep the night moving.
        </p>
        {/* Hub rule (docs/MOBILE_FLOW_SPEC.md §1): Feed and Crawls have no tab
            of their own on mobile, so this page is their hub — every surface
            reachable in ≤2 taps from a tab. */}
        <nav className="discoverHubRow" aria-label="More stories">
          <Link href="/feed" className="discoverHubLink">
            Tonight&apos;s pint stories →
          </Link>
          <Link href="/crawls" className="discoverHubLink">
            Crawl stories →
          </Link>
        </nav>
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
          hrefFor={(category) => exploreHref(category, preferredCity)}
          cardHint="Open on map"
          className="discoverExplore"
          extraItemsPosition="start"
          extraItems={
            <li
              className="catShowcase__item discoverLowNoItem"
              style={{ ["--cat" as string]: "var(--pint)" } as React.CSSProperties}
            >
              <Link
                className="catShowcase__link discoverLowNoLink"
                href={lowNoMapHref}
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
                  <span className="catShowcase__hint">Open on map</span>
                </span>
              </Link>
            </li>
          }
        />

        <div
          className="discoverBrandPanel"
          aria-labelledby="discover-brand-title"
        >
          <div className="discoverBrandHead">
            <h3 id="discover-brand-title" className="discoverBrandTitle">
              Jump by brand
            </h3>
          </div>
          <p className="discoverBrandDek">
            Open a drink family on the map, or jump by brand — beer and wine
            have the best coverage today.
          </p>
          <ul className="discoverBrandChips">
            {JUMP_BY_BRAND_CATEGORIES.flatMap((category) =>
              brandsForCategory(category).map((brand) => (
                <li key={`${category}-${brand.id}`}>
                  <Link
                    className="discoverBrandChip"
                    href={exploreHref(category, preferredCity, brand.id)}
                  >
                    {brand.label}
                  </Link>
                </li>
              )),
            )}
          </ul>
        </div>
      </section>

      <section className="discoverSection" aria-labelledby="hungry-title">
        <h2 id="hungry-title" className="discoverSectionTitle">
          Hungry?
        </h2>
        <p className="discoverSectionDek">
          Pubs that serve food — light cuisine tags only, not full menus. Open
          the map already filtered, or jump to a plate style.
        </p>
        <div className="discoverHungryRow">
          <Link className="discoverHungryCta" href={hungryMapHref}>
            Show pubs that serve food
          </Link>
          <ul className="discoverCuisineChips" aria-label="Cuisine filters">
            {DISCOVER_CUISINE_CHIPS.map((tag) => (
              <li key={tag}>
                <Link
                  className="discoverCuisineChip"
                  href={hungryCuisineHref(tag, preferredCity)}
                >
                  {tag}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="discoverSection" aria-labelledby="rivalry-title">
        <h2 id="rivalry-title" className="discoverSectionTitle">
          UK city energy
        </h2>
        <p className="discoverSectionDek">
          Cult rivalry without fake price catalogues — cities ranked by demo
          Pint Drops, curated crawl packs, and venue coverage. Open a map and
          add to the score.
        </p>
        <p className="discoverSectionNote">
          Demo seeds only where they exist — no invented organics.
        </p>
        <CityRivalryTable entries={rivalry} />
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
          <>
            <span className="srOnly" role="status">
              Loading tonight&rsquo;s prices…
            </span>
            <div className="discoverSkelList" aria-hidden="true">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="discoverSkelRow">
                  <span className="discoverSkelRank" />
                  <span className="discoverSkelLine" />
                  <span className="discoverSkelPrice" />
                </div>
              ))}
            </div>
          </>
        ) : status === "error" ? (
          <p className="discoverEmpty" role="status">
            Couldn&rsquo;t load tonight&rsquo;s prices just now.{" "}
            <Link href={openMapHref}>Open the map</Link>{" "}
            instead.
          </p>
        ) : (
          <TonightBoard entries={tonight} />
        )}
      </section>

      <TonightNearbyLane />

      <DealsTonightLane />

      <GardenTonightCard />

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
          Dataset cheapest-on-record taps — not a live tonight feed. Open a pub
          for sourced or community freshness.
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
            <Link href={openMapHref}>Open the map</Link>{" "}
            instead.
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
            <Link href={openMapHref}>Open the map</Link>{" "}
            instead.
          </p>
        ) : thenVsNow.length === 0 ? (
          <p className="discoverEmpty" role="status">
            Not enough community prices yet to compare.{" "}
            <Link href={logPintHref}>
              Log a pint on the map
            </Link>{" "}
            to help fill this in.
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
          {editorial.map((card) => (
            <EditorialCard key={card.id} {...card} />
          ))}
        </div>
      </section>
    </main>
  );
}
