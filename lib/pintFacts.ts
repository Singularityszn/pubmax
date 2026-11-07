import { comparableVenuePint, selectedComparableVenuePint, selectedVenuePintEvidence, type ComparablePintVenue } from "@/lib/comparableVenuePint";
import { isComparablePintServing, pintObservationTime } from "@/lib/comparablePint.mjs";
import { isNonPublicVenueName } from "@/lib/venueKindFilters";
import { venuePriceEvidence, type VenuePriceEvidence } from "@/lib/venuePriceEvidence";
// The pure, React-free core supplies borough fact blocks, FAQs and share images.
//
// Provenance contract (PRD non-negotiable): every number here is DERIVED from
// the pint-price dataset the page already loads — average, minimum, maximum and
// counts over the per-pub cheapest tracked pint. Nothing is invented. When the
// data can't support an honest answer (no priced pub in the area) the stat is
// null and the caller renders nothing / skips the question — never a fabricated
// figure and never the word "live" (freshness is a dated observation window).
//
// The average uses each pub's selected minimum except an explicit non-pint.
// Legacy unknown evidence stays in that population and is counted openly.
// Named extremes retain the stricter comparable-pint qualification.

import { formatObservedDate } from "@/lib/dataFreshnessFormat";
import { formatPrice } from "@/lib/venues";

// Both full Venue and SlimVenue records satisfy this input shape.
export type PricedPubLike = ComparablePintVenue & {
  name: string;
  cheapestPrice: number | null;
};

export type PintFactStats = {
  /** Display name of the area (borough or city). */
  name: string;
  /** URL slug (borough slug or city id) — carried for link building. */
  slug: string;
  /** Numeric selected minima without an explicit non-pint serving contradiction. */
  pubCount: number;
  /** All pubs mapped in the area, priced or not. */
  totalPubCount: number;
  /** Mean of the per-pub cheapest tracked pints, GBP. null when none priced. */
  averageGbp: number | null;
  /** Cheapest tracked pint in the area, GBP. null when none priced. */
  minGbp: number | null;
  /** Pub with the cheapest tracked pint. null when none priced. */
  minPubName: string | null;
  /** When that cheapest pint was last read at its source. null when it records no read. */
  minObservedAt: string | null;
  minEvidence: VenuePriceEvidence | null;
  /** Dearest tracked cheapest-pint in the area, GBP. null when none priced. */
  maxGbp: number | null;
  /** Pub with the dearest tracked cheapest-pint. null when none priced. */
  maxPubName: string | null;
  /** When that dearest cheapest-pint was last read at its source. null when it records no read. */
  maxObservedAt: string | null;
  maxEvidence: VenuePriceEvidence | null;
  /** The earliest and latest reads among the priced pubs' cheapest pints; null when none records a read. */
  oldestObservedAt: string | null;
  newestObservedAt: string | null;
  /** Priced pubs whose cheapest pint records no read. */
  undatedCount: number;
  /** Prices in the average whose own selected row names a publisher. */
  publisherCount: number;
};

// Round a mean to pence for display/serialisation. Kept separate so tests can
// assert the exact rounded figure the page renders.
function roundPence(value: number): number {
  return Math.round(value * 100) / 100;
}

// Compute the fact-block statistics for an area from its pubs. Pure and
// deterministic: min/max ties break on pub name (A–Z) so the same fixture
// always yields the same cheapest/dearest pub. Pubs with no numeric price are
// counted in totalPubCount but never move the average, min or max.
export function pintFactStats(
  pubs: PricedPubLike[],
  name: string,
  slug: string,
): PintFactStats {
  const priced = pubs
    .filter((pub) => typeof pub.cheapestPrice === "number")
    .map((pub) => {
      const selected = selectedComparableVenuePint(pub, null, false) ?? selectedVenuePintEvidence(pub);
      const read = pintObservationTime(selected.priceObservedAt);
      return {
        venue: pub,
        name: pub.name,
        price: pub.cheapestPrice as number,
        serving: isComparablePintServing({
          measure: "measure" in selected ? selected.measure : undefined,
          cheapestPint: "cheapestPint" in selected ? selected.cheapestPint : undefined,
        }),
        observedAt: read === null ? null : new Date(read).toISOString(),
        publisher: Boolean(selected.priceSource?.trim()),
        comparable: !isNonPublicVenueName(pub.name) && comparableVenuePint(pub, null, false) !== null,
      };
    })
    .filter((pub) => pub.serving);

  const base: PintFactStats = {
    name,
    slug,
    pubCount: priced.length,
    totalPubCount: pubs.length,
    averageGbp: null,
    minGbp: null,
    minPubName: null,
    minObservedAt: null,
    minEvidence: null,
    maxGbp: null,
    maxPubName: null,
    maxObservedAt: null,
    maxEvidence: null,
    oldestObservedAt: null,
    newestObservedAt: null,
    undatedCount: 0,
    publisherCount: 0,
  };
  if (priced.length === 0) return base;

  let min: (typeof priced)[number] | null = null;
  let max: (typeof priced)[number] | null = null;
  let sum = 0;
  let oldest: string | null = null;
  let newest: string | null = null;
  let undated = 0;
  for (const pub of priced) {
    sum += pub.price;
    if (!pub.observedAt) undated += 1;
    else {
      if (oldest === null || pub.observedAt < oldest) oldest = pub.observedAt;
      if (newest === null || pub.observedAt > newest) newest = pub.observedAt;
    }
    if (pub.comparable && (
      min === null || pub.price < min.price ||
      (pub.price === min.price && pub.name.localeCompare(min.name) < 0)
    )) {
      min = pub;
    }
    if (pub.comparable && (
      max === null || pub.price > max.price ||
      (pub.price === max.price && pub.name.localeCompare(max.name) < 0)
    )) {
      max = pub;
    }
  }

  const minEvidence = min ? venuePriceEvidence(min.venue, min.price, false) : null;
  const maxEvidence = max ? venuePriceEvidence(max.venue, max.price, false) : null;
  return {
    ...base,
    averageGbp: roundPence(sum / priced.length),
    minGbp: min?.price ?? null,
    minPubName: min?.name ?? null,
    minObservedAt: minEvidence?.observedAt ?? null,
    minEvidence,
    maxGbp: max?.price ?? null,
    maxPubName: max?.name ?? null,
    maxObservedAt: maxEvidence?.observedAt ?? null,
    maxEvidence,
    oldestObservedAt: oldest,
    newestObservedAt: newest,
    undatedCount: undated,
    publisherCount: priced.filter((pub) => pub.publisher).length,
  };
}

export function factCoverageSentence(stats: PintFactStats): string {
  const dated = stats.pubCount - stats.undatedCount;
  return `${stats.publisherCount} of ${stats.pubCount} ${plural(stats.pubCount, "price")} ${stats.publisherCount === 1 ? "names" : "name"} a publisher. ${dated} of ${stats.pubCount} ${dated === 1 ? "records" : "record"} a full read day.`;
}

// The average is dated by the reads of the prices it averages, never by the day
// the pub list was last refreshed: a re-collection does not re-read every row,
// so "As of October" over prices read in July claims a month they were not read.
function averageSentence(stats: PintFactStats): string {
  const { name } = stats;
  const figure = `the average pint in ${name} costs ${formatPrice(stats.averageGbp)} across ${stats.pubCount} tracked ${plural(stats.pubCount, "pub")}.`;
  let sentence: string;
  if (stats.oldestObservedAt && stats.newestObservedAt) {
    const from = formatObservedDate(new Date(stats.oldestObservedAt));
    const to = formatObservedDate(new Date(stats.newestObservedAt));
    sentence = from === to ? `From prices read on ${to}, ${figure}` : `From prices read between ${from} and ${to}, ${figure}`;
  } else {
    sentence = `T${figure.slice(1)}`;
  }
  if (stats.undatedCount === 0) return `${sentence} ${factCoverageSentence(stats)}`;
  if (stats.undatedCount === stats.pubCount) {
    return `${sentence} ${stats.pubCount === 1 ? "That price records" : "Those prices record"} no read date. ${factCoverageSentence(stats)}`;
  }
  return `${sentence} ${stats.undatedCount} of those prices ${stats.undatedCount === 1 ? "records" : "record"} no read date. ${factCoverageSentence(stats)}`;
}

export function extremeDescription(evidence: VenuePriceEvidence | null): string {
  const drink = evidence?.drinkLabel ?? "Pint name unavailable";
  const serving = evidence?.servingSize ?? "Serving size not recorded";
  const publisher = evidence?.publisher?.label ? `Listed by ${evidence.publisher.label}` : "Publisher not recorded";
  const day = evidence?.observedOn
    ? `collected on ${formatObservedDate(new Date(`${evidence.observedOn}T12:00:00Z`))}`
    : "Read date unavailable";
  return `${drink} (${serving}). ${publisher}, ${day}.`;
}

/** True when the area has at least one priced pub — the block/FAQ can render. */
export function hasFactData(stats: PintFactStats): boolean {
  return stats.pubCount > 0 && stats.averageGbp !== null;
}

// The extractable fact-block prose, as discrete sentences so the caller can
// render each as its own <p> (better for AI extraction than one wall of text).
// Empty array when there's no priced data — caller renders nothing.
export function factBlockSentences(
  stats: PintFactStats,
  opts: { monthYear: string; observedDate: string },
): string[] {
  if (!hasFactData(stats)) return [];
  const { name } = stats;
  const min = formatPrice(stats.minGbp);
  const sentences: string[] = [
    averageSentence(stats),
    ...(stats.minGbp !== null && stats.minPubName
      ? [`The cheapest tracked pint is ${min} at ${stats.minPubName}. ${extremeDescription(stats.minEvidence)}`]
      : []),
  ];
  // Range only reads honestly when min and max actually differ.
  if (
    stats.maxGbp !== null &&
    stats.minGbp !== null &&
    stats.maxGbp > stats.minGbp
  ) {
    sentences.push(
      `Tracked cheapest pints in ${name} range from ${min} to ${formatPrice(
        stats.maxGbp,
      )}. From ${stats.minPubName}: ${extremeDescription(stats.minEvidence)} To ${stats.maxPubName}: ${extremeDescription(stats.maxEvidence)}`,
    );
  }
  sentences.push(
    `Prices last collected ${opts.observedDate} for PUBMAXX's tracked pint dataset, refreshed by community Pint Drops. Never a live feed.`,
  );
  return sentences;
}

export type FaqItem = { question: string; answer: string };

// 3–5 data-answerable FAQ questions for an area, each answered strictly from the
// stats. A question is SKIPPED whenever its answer data is missing, so a borough
// with no priced pub yields no FAQ (rather than an empty or invented answer).
export function faqItems(
  stats: PintFactStats,
  opts: { monthYear: string; year: string },
): FaqItem[] {
  const items: FaqItem[] = [];
  const { name } = stats;

  if (stats.minGbp !== null && stats.minPubName) {
    items.push({
      question: `What is the cheapest pint in ${name}?`,
      answer: `The cheapest tracked pint in ${name} is ${formatPrice(
        stats.minGbp,
      )} at ${stats.minPubName}. ${extremeDescription(stats.minEvidence)}`,
    });
  }

  if (stats.averageGbp !== null) {
    items.push({
      question: `How much is a pint in ${name} in ${opts.year}?`,
      answer: averageSentence(stats),
    });
  }

  if (stats.pubCount > 0) {
    items.push({
      question: `How many pubs does ${name} have on PUBMAXX?`,
      answer: `PUBMAXX tracks a cheapest pint at ${stats.pubCount} ${plural(
        stats.pubCount,
        "pub",
      )} in ${name}${
        stats.totalPubCount > stats.pubCount
          ? ` (of ${stats.totalPubCount} mapped in the area)`
          : ""
      }.`,
    });
  }

  if (
    stats.maxGbp !== null &&
    stats.minGbp !== null &&
    stats.maxGbp > stats.minGbp
  ) {
    items.push({
      question: `What's the price range for a pint in ${name}?`,
      answer: `Tracked cheapest pints in ${name} range from ${formatPrice(
        stats.minGbp,
      )} to ${formatPrice(stats.maxGbp)}. From ${stats.minPubName}: ${extremeDescription(stats.minEvidence)} To ${stats.maxPubName}: ${extremeDescription(stats.maxEvidence)}`,
    });
  }

  return items;
}

// Build a schema.org FAQPage graph node from FAQ items. Returns null when there
// are no items so the caller omits the block entirely (no empty FAQPage).
export function faqPageJsonLd(items: FaqItem[]): Record<string, unknown> | null {
  if (items.length === 0) return null;
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: { "@type": "Answer", text: item.answer },
    })),
  };
}

function plural(count: number, word: string): string {
  return count === 1 ? word : `${word}s`;
}
