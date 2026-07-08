"use client";

// Full-bleed photographic hero field with interactive alcohol-shaped pubs.
// Each marker is a DrinkGlyph (our IP) in a distinct drink category shape/colour,
// labelled in plain language so all ages can tap without guessing icons.
// Deep-links into /map?drink=<category> (and heritage for whisky) via crawlUrl.

import Image from "next/image";
import Link from "next/link";
import { DrinkGlyph } from "@/components/drinks/DrinkGlyph";
import type { DrinkCategory } from "@/lib/drinks";
import { categoryLabel } from "@/lib/drinks";
import { warmMapIntent } from "@/lib/mapWarmup";

export type HeroPub = {
  id: string;
  category: DrinkCategory;
  /** Short place cue shown under the glyph (all-ages readability). */
  place: string;
  /** Optional price tag for atmosphere — illustrative only. */
  price: string;
  /** Percent positions inside the photo plane. */
  left: string;
  top: string;
  /** Map deep-link (drink filter / style). */
  href: string;
};

const HERO_PUBS: HeroPub[] = [
  {
    id: "dove",
    category: "beer",
    place: "The Dove",
    price: "£4.20",
    left: "12%",
    top: "28%",
    href: "/map?drink=beer&style=cheapest",
  },
  {
    id: "mayflower",
    category: "gin",
    place: "Mayflower",
    price: "£5.10",
    left: "38%",
    top: "58%",
    href: "/map?drink=gin&style=balanced",
  },
  {
    id: "cheese",
    category: "whisky",
    place: "Cheshire Cheese",
    price: "£4.60",
    left: "62%",
    top: "32%",
    href: "/map?drink=whisky&style=heritage",
  },
  {
    id: "prospect",
    category: "wine",
    place: "Prospect of Whitby",
    price: "£5.40",
    left: "78%",
    top: "62%",
    href: "/map?drink=wine&style=dateNight",
  },
  {
    id: "spritz",
    category: "cocktail",
    place: "Soho spritz",
    price: "£7.50",
    left: "48%",
    top: "18%",
    href: "/map?drink=cocktail&cocktails=1",
  },
  {
    id: "rum",
    category: "rum",
    place: "Dockside rum",
    price: "£5.80",
    left: "22%",
    top: "72%",
    href: "/map?drink=rum&style=balanced",
  },
];

const mapWarmProps = {
  onPointerEnter: warmMapIntent,
  onTouchStart: warmMapIntent,
  onFocus: warmMapIntent,
};

export default function ThamesHero() {
  return (
    <div className="thamesHeroPhoto" role="region" aria-label="London pubs as drink shapes — tap one to open the map">
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
      <p className="thamesHeroHint">Tap a drink shape to open that kind of night</p>
      <ul className="thamesHeroPins">
        {HERO_PUBS.map((pub, i) => (
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
              href={pub.href}
              className="thamesHeroPinLink"
              aria-label={`${categoryLabel(pub.category)} at ${pub.place}, about ${pub.price} — open on the map`}
              {...mapWarmProps}
            >
              <span className="thamesHeroPinGlyph" data-cat={pub.category}>
                <DrinkGlyph category={pub.category} size={36} />
              </span>
              <span className="thamesHeroPinMeta">
                <span className="thamesHeroPinCat">{categoryLabel(pub.category)}</span>
                <span className="thamesHeroPinPlace">{pub.place}</span>
                <span className="thamesHeroPinPrice">{pub.price}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export { HERO_PUBS };
