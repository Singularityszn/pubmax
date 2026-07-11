import { ExternalLink } from "lucide-react";

import { categoryColor } from "@/lib/categoryColors";
import { formatPrice } from "@/lib/venues";
import DrinkRatingRow from "@/components/ratings/DrinkRatingRow";
import PriceBadge from "@/components/PriceBadge";
import {
  formatAbv,
  groupDrinksByCategory,
  type Drink,
  type DrinkCategory,
  type DrinkProvenance,
} from "@/lib/drinks";
import { DrinkGlyph } from "./DrinkGlyph";

import "./drinkMenu.css";

// The venue Menu (PRD E1): a venue's drinks grouped by category, each section
// carrying its own colour token (lib/categoryColors.ts — E5 owns the canonical
// palette) and a per-drink row: name, producer/style/abv, a stable numeric
// price badge, and a provenance chip so a seeded demo pour is always visibly
// distinct from a real price.
//
// Server-composable: it takes `drinks` as a prop (the caller runs
// venueDrinkMenu(venueId, venue.prices) — no client fetch), so it drops into a
// server OR client component. Purely presentational. When a venue has nothing
// beyond its pint rows, an honest EmptyState renders instead of a bare frame.

// Honest source labels for the provenance chip. A seeded demo menu reads
// "Demo"; a first-party dataset price reads "On record"; anything else shows
// its raw source so a new permissible source (Wikidata, a chain site) is never
// silently relabelled.
function provenanceLabel(prov: DrinkProvenance): string {
  if (isDemoProvenance(prov)) return "Demo";
  if (prov.source === "app-dataset") return "On record";
  return prov.source;
}

// Extract the unique set of attributable source labels from a drinks array —
// i.e. sources that are neither the internal baseline ("app-dataset") nor a
// seeded demo fixture. These are the labels to surface in the attribution
// footer so users can see that Firecrawl / chain-site scraping contributed.
function attributableSources(drinks: Drink[]): string[] {
  const seen = new Set<string>();
  for (const d of drinks) {
    const { source } = d.provenance;
    if (source !== "app-dataset" && !isDemoProvenance(d.provenance)) {
      seen.add(source);
    }
  }
  return Array.from(seen);
}

function isDemoProvenance(prov: DrinkProvenance): boolean {
  return prov.source === "seed" || prov.source.toLowerCase().includes("demo");
}

function ProvChip({ prov }: { prov: DrinkProvenance }) {
  const label = provenanceLabel(prov);
  const kind = isDemoProvenance(prov) ? "demo" : "sourced";
  return (
    <span
      className={`drinkProvChip ${kind}`}
      title={`${prov.source} · ${prov.licence}`}
    >
      {label}
    </span>
  );
}

// The one-line descriptor under a drink name: producer, style, abv, region —
// only the parts that exist (never a fabricated blank). Serving size trails.
function drinkMeta(drink: Drink): string {
  const parts: string[] = [];
  if (drink.producer) parts.push(drink.producer);
  if (drink.style) parts.push(drink.style);
  if (drink.region) parts.push(drink.region);
  const abv = formatAbv(drink.abv);
  if (abv) parts.push(abv);
  return parts.join(" · ");
}

function DrinkRow({ drink, venueId }: { drink: Drink; venueId?: string }) {
  const meta = drinkMeta(drink);
  return (
    <li className="drinkRow">
      <div className="drinkRowMain">
        <span className="drinkName">{drink.name}</span>
        {meta ? <span className="drinkMeta">{meta}</span> : null}
        {drink.servingSize ? (
          <span className="drinkServing">{drink.servingSize}</span>
        ) : null}
        {drink.alcoholType === "low-no" ? (
          <span className="drinkLowNoChip">Low/no</span>
        ) : null}
        {/* Star rating (E3): the viewer's half-star vote + the community score
            once past the 10-vote floor. Keyed by the stable drink id (see
            migration 0020's drink_ref note); the whole menu's summaries arrive
            in ONE batched GET. Stars inherit the section's category accent via
            var(--cat-accent). */}
        <DrinkRatingRow
          drinkRef={drink.id}
          drinkName={drink.name}
          venueId={venueId}
          accent="var(--cat-accent)"
        />
      </div>
      <div className="drinkRowSide">
        <PriceBadge variant="neutral" className="drinkPrice">
          {formatPrice(drink.priceGbp)}
        </PriceBadge>
        <ProvChip prov={drink.provenance} />
      </div>
    </li>
  );
}

function CategorySection({
  category,
  label,
  drinks,
  venueId,
}: {
  category: DrinkCategory;
  label: string;
  drinks: Drink[];
  venueId?: string;
}) {
  // Theme-aware category token (var(--cat-*), E5) — resolves to the right
  // light/dark/Legacy value via the cascade, so the menu's section colour tracks
  // the theme instead of freezing the light-mode hex. drinkMenu.css owns HOW the
  // accent is used (rule, dot, tint, header wash); this only supplies the value.
  const accent = categoryColor(category);
  return (
    <section
      className="drinkCategory"
      style={{ ["--cat-accent" as string]: accent }}
      aria-labelledby={`drink-cat-${category}`}
    >
      <h4 className="drinkCategoryTitle" id={`drink-cat-${category}`}>
        {/* Colour-driven category glyph — the family's mark leading its section,
            richer than the bare dot. Decorative: the visible label carries the
            meaning (never colour/icon alone). */}
        <span className="drinkCategoryGlyph" aria-hidden="true">
          <DrinkGlyph category={category} size={20} inheritColor />
        </span>
        {label}
      </h4>
      <ul className="drinkList">
        {drinks.map((drink) => (
          <DrinkRow key={drink.id} drink={drink} venueId={venueId} />
        ))}
      </ul>
    </section>
  );
}

export type DrinkMenuProps = {
  drinks: Drink[];
  /** Venue name, for the honest empty-state copy. */
  venueName?: string;
  /** Venue id (E3): recorded alongside drink ratings when known. Optional —
      a drink's rating key is its own stable id, so ratings work without it. */
  venueId?: string;
  /** When set, only this category's section is shown (Menu hub drill-in). */
  categoryFilter?: DrinkCategory;
  /** Optional back control for the Menu hub → deep-dive flow. */
  onBack?: () => void;
  backLabel?: string;
  /**
   * Official menu URL from the enrichment overlay (venue_menu_enrichment.json /
   * Firecrawl). When present a prominent "Official menu →" CTA is shown at the
   * top of the drinks view so the scraping work is visible to users.
   */
  menuUrl?: string;
};

export default function DrinkMenu({
  drinks,
  venueName,
  venueId,
  categoryFilter,
  onBack,
  backLabel = "Menus",
  menuUrl,
}: DrinkMenuProps) {
  const groups = groupDrinksByCategory(drinks).filter((group) =>
    categoryFilter ? group.category === categoryFilter : true,
  );
  // Collect unique sources that came from a real permissible scrape / chain
  // site (Firecrawl, official chain menu). These are never "app-dataset" or
  // a seeded demo — they're what we want to surface.
  const sources = attributableSources(drinks);

  if (groups.length === 0) {
    return (
      <div className="drinkMenu drinkMenuEmpty" role="status">
        {onBack ? (
          <button type="button" className="drinkMenuBack" onClick={onBack}>
            ← {backLabel}
          </button>
        ) : null}
        <p className="drinkMenuEmptyTitle">No menu on record yet</p>
        <p className="drinkMenuEmptyBody">
          {venueName ? `${venueName} hasn't` : "This pub hasn't"} logged any
          drinks beyond the pint list. Prices you see are community-updated —
          not a live feed.
        </p>
        {menuUrl ? (
          <a
            className="drinkMenuOfficialCta"
            href={menuUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            Official menu
            <ExternalLink size={13} aria-hidden="true" />
          </a>
        ) : null}
      </div>
    );
  }

  return (
    <div className="drinkMenu">
      {onBack ? (
        <button type="button" className="drinkMenuBack" onClick={onBack}>
          ← {backLabel}
        </button>
      ) : null}
      {/* Official menu CTA — shown whenever we have a curated chain URL so
          the Firecrawl / enrichment work is always visible to users in the
          drink-detail view, not just on the hub. */}
      {menuUrl ? (
        <a
          className="drinkMenuOfficialCta"
          href={menuUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="View the official menu (opens in new tab)"
        >
          Official menu
          <ExternalLink size={13} aria-hidden="true" />
        </a>
      ) : null}
      {groups.map((group) => (
        <CategorySection
          key={group.category}
          category={group.category}
          label={group.label}
          drinks={group.drinks}
          venueId={venueId}
        />
      ))}
      <p className="drinkMenuFootnote">
        {sources.length > 0 ? (
          <>
            Prices from: <strong>{sources.join(", ")}</strong>. Other prices are
            community-updated or on-record baselines — not a live feed.
          </>
        ) : (
          <>Every drink carries its source · Demo items are seeded examples, never a live price.</>
        )}
      </p>
    </div>
  );
}
