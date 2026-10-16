// "Where your £6 goes" - the tax inside a £6 pint, from public, dated rates.
//
// THREE rules.
//
// 1. EVERY COMPONENT IS A RATE WITH A SOURCE AND A DATE. The pennies are
//    computed here from the published rate, never typed, so a rate change is a
//    one-line edit and the sum cannot drift from its parts.
//
// 2. THE REST IS NOT SPLIT. What is left after VAT and duty pays for the beer,
//    the staff, the rent, the energy, the business rates and any profit. We
//    print it as one figure and never estimate what a given pub keeps, because
//    a margin nobody published would be a figure we made up.
//
// 3. TWO VIEWS, SIDE BY SIDE. The trade blames tax; many drinkers blame the
//    pub companies. Both are printed as what someone said, with the source and
//    the date, and neither is our verdict.
//
// The £6 is a round example from the r/ukpolitics thread title, not a price
// anybody observed, so it never reaches a price surface either.

import type { PricePulseSource } from "@/lib/pricePulse";

/** The example pint. A round figure, not an observation. */
export const EXAMPLE_PINT_GBP = 6;
/** How the example is said in prose: "£6", as people say it. */
export const EXAMPLE_PINT_LABEL = `£${EXAMPLE_PINT_GBP}`;
/** One imperial pint in litres. */
export const PINT_LITRES = 0.568261;
/** The example strength: a typical draught lager. */
export const EXAMPLE_ABV_PERCENT = 4.5;

export type ExplainerRate = {
  id: "vat" | "duty";
  label: string;
  rateNote: string;
  source: PricePulseSource;
  /** What the published date means for this source. */
  dateMeans: "published" | "in force from";
};

/** UK standard rate of VAT, 20 per cent, in force since 4 January 2011. */
const VAT_STANDARD_RATE = 0.2;
/** Draught beer, 3.5% to under 8.5% ABV, per litre of pure alcohol, from 1 February 2026. */
export const DRAUGHT_BEER_DUTY_PER_LITRE_ALCOHOL_GBP = 19.45;

export const EXPLAINER_RATES: readonly ExplainerRate[] = [
  {
    id: "vat",
    label: "VAT",
    rateNote: "20% standard rate, already inside the price on the bar",
    dateMeans: "in force from",
    source: {
      label: "GOV.UK, VAT rates",
      url: "https://www.gov.uk/vat-rates",
      publishedOn: "2011-01-04",
    },
  },
  {
    id: "duty",
    label: "Beer duty",
    rateNote: `£${DRAUGHT_BEER_DUTY_PER_LITRE_ALCOHOL_GBP.toFixed(2)} per litre of pure alcohol for draught beer from 3.5% to under 8.5%`,
    dateMeans: "in force from",
    source: {
      label: "GOV.UK, Alcohol Duty rates",
      url: "https://www.gov.uk/guidance/alcohol-duty-rates",
      publishedOn: "2026-02-01",
    },
  },
];

export type ExplainerSplit = {
  vatGbp: number;
  dutyGbp: number;
  restGbp: number;
};

/** Round to whole pence. */
function pence(gbp: number): number {
  return Math.round(gbp * 100) / 100;
}

/**
 * The split of a pint price into VAT, duty and the rest. VAT is the VAT
 * fraction of a VAT-inclusive price; duty is litres x strength x rate. The
 * rest is the remainder of the ROUNDED parts, so the three always sum to the
 * price a reader sees.
 */
export function splitPintPrice(
  priceGbp: number = EXAMPLE_PINT_GBP,
  abvPercent: number = EXAMPLE_ABV_PERCENT,
): ExplainerSplit {
  const vatGbp = pence((priceGbp * VAT_STANDARD_RATE) / (1 + VAT_STANDARD_RATE));
  const dutyGbp = pence(PINT_LITRES * (abvPercent / 100) * DRAUGHT_BEER_DUTY_PER_LITRE_ALCOHOL_GBP);
  const restGbp = pence(priceGbp - vatGbp - dutyGbp);
  return { vatGbp, dutyGbp, restGbp };
}

/** "£1.00" for a pound or more, "50p" under one. */
export function formatPintMoney(gbp: number): string {
  if (gbp < 1) return `${Math.round(gbp * 100)}p`;
  return `£${gbp.toFixed(2)}`;
}

export type ExplainerView = {
  id: "tax" | "tie";
  heading: string;
  points: readonly { said: string; source: PricePulseSource }[];
};

const BBPA_BUDGET_SOURCE: PricePulseSource = {
  label: "BBPA",
  url: "https://beerandpub.com/news-insights-research/news/government-must-cut-beer-duty-to-keep-pints-affordable-and-ensure-thousands-more-jobs-for-young-people",
  publishedOn: "2026-09-24",
};

const SIBA_DROP_THE_PINT_SOURCE: PricePulseSource = {
  label: "SIBA",
  url: "https://siba.co.uk/2026/10/08/drop-the-pint-day-will-see-venues-across-the-uk-offer-pints-at-lower-german-tax-rates",
  publishedOn: "2026-10-08",
};

const UKPOLITICS_SOURCE: PricePulseSource = {
  label: "r/ukpolitics",
  url: "https://www.reddit.com/r/ukpolitics/comments/1wy533t/where_does_6_for_a_pint_go_the_harsh_reality_of/",
  publishedOn: "2026-10-05",
};

export const EXPLAINER_VIEWS: readonly ExplainerView[] = [
  {
    id: "tax",
    heading: "The trade blames tax",
    points: [
      {
        said: "The BBPA says duty is up to 40% of the wholesale price of beer, and that after duty, staff costs and business rates a pub makes 12p a pint. It asks the Budget to freeze duty and raise the draught discount to 30%.",
        source: BBPA_BUDGET_SOURCE,
      },
      {
        said: "SIBA puts the headline duty on a pint at 55p in the UK and 5p in Germany.",
        source: SIBA_DROP_THE_PINT_SOURCE,
      },
    ],
  },
  {
    id: "tie",
    heading: "Many drinkers blame the pub companies",
    points: [
      {
        said: "Replies in r/ukpolitics said much of the money goes to the pub company that owns the building and sells the tenant its beer. One reply compared £6 or more at a nearby pub-company pub with about £5 at an independent.",
        source: UKPOLITICS_SOURCE,
      },
    ],
  },
];

/** The day these rates and views were last checked against their sources. */
export const EXPLAINER_REVIEWED_ON = "2026-10-16";

/** The UK Budget this explainer is timed for. */
export const BUDGET_DAY = "2026-10-28";
