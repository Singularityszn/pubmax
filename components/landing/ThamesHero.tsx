"use client";

// Full-bleed photographic hero field with interactive alcohol-shaped pubs.
// Each marker is a DrinkGlyph (our IP) in a distinct drink category shape/colour,
// labelled in plain language so all ages can tap without guessing icons.
// Deep-links into the preferred (or default) city map via cityAwareMapPath.

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useSyncExternalStore } from "react";
import { DrinkGlyph } from "@/components/drinks/DrinkGlyph";
import type { DrinkCategory } from "@/lib/drinks";
import { categoryLabel } from "@/lib/drinks";
import {
  readPreferredCity,
  subscribePreferredCity,
} from "@/lib/cityPreference";
import { cityAwareMapPath } from "@/lib/curatedCrawls";
import { warmMapRoute } from "@/lib/mapWarmup";

export type HeroPub = {
  id: string;
  category: DrinkCategory;
  /** Short place cue shown under the glyph (all-ages readability). */
  place: string;
  /** Optional price tag for atmosphere, illustrative only, never in the accessible name. */
  price: string;
  /**
   * Decorative rim colour, drawn from the real map price key (green/amber/
   * red, `mapPriceLegend.ts`: <=£5.50 green, up to £7 amber, over £7 red).
   * Styling only, carries no authority claim, unlike a live pin band.
   */
  band: "green" | "amber" | "red";
  /** Percent positions inside the photo plane. */
  left: string;
  top: string;
  /** Map query params (drink filter / style). City comes from preference. */
  query: Record<string, string>;
};

const HERO_PUBS: HeroPub[] = [
  {
    id: "dove",
    category: "beer",
    place: "The Dove",
    price: "£4.20",
    band: "green",
    left: "14%",
    top: "26%",
    query: { drink: "beer", style: "cheapest" },
  },
  {
    id: "mayflower",
    category: "gin",
    place: "Mayflower",
    price: "£5.10",
    band: "green",
    left: "36%",
    top: "64%",
    query: { drink: "gin", style: "balanced" },
  },
  {
    id: "cheese",
    category: "whisky",
    place: "Cheshire Cheese",
    price: "£4.60",
    band: "green",
    left: "68%",
    top: "28%",
    query: { drink: "whisky", style: "heritage" },
  },
  {
    id: "prospect",
    category: "wine",
    place: "Prospect of Whitby",
    price: "£5.40",
    band: "green",
    left: "82%",
    top: "68%",
    query: { drink: "wine", style: "dateNight" },
  },
  {
    id: "spritz",
    category: "cocktail",
    place: "Soho spritz",
    price: "£7.50",
    band: "red",
    left: "52%",
    top: "16%",
    query: { drink: "cocktail", cocktails: "1" },
  },
  {
    id: "rum",
    category: "rum",
    place: "Dockside rum",
    price: "£5.80",
    band: "amber",
    left: "18%",
    top: "78%",
    query: { drink: "rum", style: "balanced" },
  },
];

function heroPubHref(
  query: Record<string, string>,
  preferredCity: ReturnType<typeof readPreferredCity>,
): string {
  return cityAwareMapPath(preferredCity, new URLSearchParams(query));
}

export default function ThamesHero() {
  const router = useRouter();
  const preferredCity = useSyncExternalStore(
    subscribePreferredCity,
    readPreferredCity,
    () => null,
  );
  const warmMap = useCallback(() => warmMapRoute(router), [router]);
  const mapWarmProps = {
    onPointerDown: warmMap,
    onPointerEnter: warmMap,
    onTouchStart: warmMap,
    onFocus: warmMap,
  };
  return (
    <div className="thamesHeroPhoto" role="region" aria-label="London pubs as drink shapes. Tap one to open the map">
      <Image
        className="thamesHeroImg"
        src="/landing/hero-night.jpg"
        alt=""
        fill
        priority
        sizes="(max-width: 920px) 100vw, 560px"
        quality={78}
      />
      <div className="thamesHeroScrim" aria-hidden="true" />
      {/* Warm basemap wash: decoration only, no live MapLibre and no map
          screenshot. Grounds the photo plane toward map truth. */}
      <div className="thamesHeroMapWash" aria-hidden="true" />
      <ul className="thamesHeroPins">
        {HERO_PUBS.map((pub, i) => {
          const href = heroPubHref(pub.query, preferredCity);
          return (
            <li
              key={pub.id}
              className="thamesHeroPin"
              style={{
                left: pub.left,
                top: pub.top,
                ["--pin-i" as string]: i,
              }}
            >
              <Link
                href={href}
                className="thamesHeroPinLink"
                aria-label={`${categoryLabel(pub.category)} at ${pub.place}. Open on the map`}
                {...mapWarmProps}
              >
                <span className="thamesHeroPinGlyph" data-cat={pub.category} data-band={pub.band}>
                  <DrinkGlyph category={pub.category} size={36} />
                </span>
                <span className="thamesHeroPinMeta">
                  <span className="thamesHeroPinCat">{categoryLabel(pub.category)}</span>
                  <span className="thamesHeroPinPlace">{pub.place}</span>
                  <span className="thamesHeroPinPrice">{pub.price}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export { HERO_PUBS };
