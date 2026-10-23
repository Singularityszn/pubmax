import { categoryColor } from "@/lib/categoryColors";
import { priceBand, priceBandAreaForVenue } from "@/lib/priceBand";
import { DAY_MS } from "@/lib/dayMs";
import { formatPrice } from "@/lib/venues";
import PriceBadge from "@/components/PriceBadge";
import {
  formatAbv,
  groupDrinksByCategory,
  isDemoDrinkProvenance,
  type Drink,
  type DrinkCategory,
  type DrinkProvenance,
} from "@/lib/drinks";
import { firstHttp } from "@/lib/httpUrl";
import {
  PINT_DATASET_PRESENTATION_BUDGET_DAYS,
  SNAPSHOT_CAPTION_PREFIX,
} from "@/lib/dataFreshness";
import { DrinkGlyph } from "./DrinkGlyph";
import DrinkRowMain from "./DrinkRowMain";

import "./drinkMenu.css";


const OBSERVATION_DAY = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Europe/London",
});

// The caption beside a row's price, and WHICH question it answers depends on
// the lane the row came from. The lane is read EXPLICITLY, never as the else of
// a dataset check: everything that is not the bundled dataset is not therefore
// a closed snapshot, and a fall-through put "Snapshot from" on a drinker's live
// Pint Drop, which is the opposite claim.
//
// A dataset row and a Pint Drop row are both re-collectable observations, so
// their caption is a currency claim measured against the price-authority
// window: "Seen" inside it, "Last seen" past it.
//
// A drink-price-update row is not. That lane is a STATIC SNAPSHOT (captain
// ruling 2026-09-05: its only permitted source publishes no per-drink web
// prices, so nothing may lawfully advance the file), so there is no window to
// be inside or outside of and "Last seen" would be a staleness warning about a
// lane that is doing exactly what it is meant to. It takes the same words the
// freshness spine and the pint bundle's own caption use (SNAPSHOT_CAPTION_PREFIX,
// lib/dataFreshness.ts), so a drinker, a page caption and the audit cannot drift
// into three vocabularies. The date is the whole claim either way.
const SNAPSHOT_CAPTION_LANES: ReadonlySet<string> = new Set(["drink-price-update"]);

/**
 * The window a row's caption is measured against, or null where the row is a
 * declared snapshot lane and there is no window to measure.
 */
function drinkMenuObservationBudgetDays(
  provenance: DrinkProvenance,
): number | null {
  if (provenance.lane && SNAPSHOT_CAPTION_LANES.has(provenance.lane)) return null;
  return PINT_DATASET_PRESENTATION_BUDGET_DAYS;
}

function drinkMenuObservationMeta(
  observedAt: string | null,
  freshnessBudgetDays: number | null,
  now: number = Date.now(),
): { label: string; formattedDate: string; dateTime: string } | null {
  if (!observedAt) return null;
  const observedAtMs = Date.parse(observedAt);
  if (!Number.isFinite(observedAtMs)) return null;
  const formattedDate = OBSERVATION_DAY.format(new Date(observedAtMs));
  if (freshnessBudgetDays === null) {
    return { label: SNAPSHOT_CAPTION_PREFIX, formattedDate, dateTime: observedAt };
  }
  const stale = now - observedAtMs > freshnessBudgetDays * DAY_MS;
  return { label: stale ? "Last seen" : "Seen", formattedDate, dateTime: observedAt };
}

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
// "Demo"; an unattributed dataset price says its publisher was not recorded;
// anything else shows its source so a new permissible source (Wikidata, a chain
// site) is never silently relabelled.
function provenanceLabel(prov: DrinkProvenance): string {
  if (isDemoDrinkProvenance(prov)) return "Demo";
  if (isUnattributedPrice(prov)) return "Publisher not recorded";
  return prov.source;
}

function isUnattributedPrice(prov: DrinkProvenance): boolean {
  return prov.source === "app-dataset" && !firstHttp(prov.sourceUrl);
}

function ProvChip({ prov }: { prov: DrinkProvenance }) {
  const label = provenanceLabel(prov);
  const kind = isDemoDrinkProvenance(prov) ? "demo" : "sourced";
  const className = `drinkProvChip ${kind}`;
  const title = `${label} · ${prov.licence}`;
  const sourceUrl = firstHttp(prov.sourceUrl);
  return sourceUrl ? (
    <a
      className={className}
      title={title}
      href={sourceUrl}
      target="_blank"
      rel="noopener noreferrer"
    >
      {label}
    </a>
  ) : (
    <span
      className={className}
      title={title}
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
  const observation = isDemoDrinkProvenance(drink.provenance)
    ? null
    : drinkMenuObservationMeta(
        drink.provenance.observedAt,
        drinkMenuObservationBudgetDays(drink.provenance),
      );
  return (
    <li className="drinkRow">
      {/* The drink itself, its community score and the detail a drinker opens
          by tapping it (E3). Stateful, so it is the menu's one client island
          and this file stays server-composable. */}
      <DrinkRowMain drink={drink} meta={meta} venueId={venueId} />
      <div className="drinkRowSide">
        <PriceBadge
          variant="neutral"
          className="drinkPrice"
          band={drink.category === "beer" ? priceBand(drink.priceGbp, priceBandAreaForVenue(venueId)) : null}
        >
          {formatPrice(drink.priceGbp)}
        </PriceBadge>
        <ProvChip prov={drink.provenance} />
        {observation ? (
          <span className="drinkObservationAge">
            {observation.label}{" "}
            <time dateTime={observation.dateTime}>
              {observation.formattedDate}
            </time>
          </span>
        ) : null}
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
};

export default function DrinkMenu({
  drinks,
  venueName,
  venueId,
  categoryFilter,
  onBack,
  backLabel = "Menus",
}: DrinkMenuProps) {
  const groups = groupDrinksByCategory(drinks).filter((group) =>
    categoryFilter ? group.category === categoryFilter : true,
  );
  const hasUnattributedPrice = groups.some((group) =>
    group.drinks.some((drink) => isUnattributedPrice(drink.provenance)),
  );

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
          drinks beyond the pint list. Prices you see are community-updated,
          not a live feed.
        </p>
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
      {groups.map((group) => (
        <CategorySection
          key={group.category}
          category={group.category}
          label={group.label}
          drinks={group.drinks}
          venueId={venueId}
        />
      ))}
      {/* The footnote is about ATTRIBUTION and nothing else. It once trailed a
          demo disclaimer on every menu, so a real Pint Drop wore a sentence
          about seeded examples (#1427); demo rows are opt-in now
          (demoDrinksEnabled, lib/demoContent.ts) and each one still carries its
          own Demo chip, which is where that claim belongs. */}
      <p className="drinkMenuFootnote">
        {hasUnattributedPrice
          ? '"Publisher not recorded" means the price is on record but its publisher is not.'
          : "Publisher links open where the price record names one."}
      </p>
    </div>
  );
}
