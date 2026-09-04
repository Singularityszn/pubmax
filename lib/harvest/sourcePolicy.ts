// Which London sources the harvest may read, and the evidence for each answer.
//
// A SKIP IS A FINDING, NOT A GAP. Every source the harvest knows about is in
// this table whether it may be read or not, each carrying the rule that decided
// it and the day that rule was checked. The run report prints the skips beside
// the counts, so "we harvested nothing from Mitchells & Butlers" reads as a
// recorded decision with a reason rather than as coverage nobody noticed was
// missing. A source that is not in this table is not harvested at all: the
// fetchers take their URLs from here, never from a caller.
//
// THE BAR IS PERMISSION, NOT REACHABILITY. `robots-unreadable` is a REFUSAL:
// several Mitchells & Butlers brands answer their own robots.txt with a
// challenge page, so no permission can be established, and a page we cannot ask
// about is a page we do not take. The same goes for a site whose robots.txt
// admits ordinary crawlers but names the headless-renderer class Firecrawl
// belongs to in a Disallow - the narrower rule is the one that binds.
//
// FIRST PARTY IS THE DEFAULT AND A LISTINGS SITE IS THE EXCEPTION, which is why
// every ticketing aggregator here is refused. That is continuous with
// docs/EVENT_SOURCES_RESEARCH_2026-07-18.md, which chose official APIs over
// scraping aggregators for the same reason. A non-first-party source that IS
// allowed states its own exception in `nonFirstPartyException`, naming what it
// may take, so the permission is as narrow as the decision that granted it.

/** Why a source is not read this run. */
export const HARVEST_SKIP_REASONS = [
  "robots-disallowed",
  "robots-unreadable",
  "terms-forbid-commercial-use",
  // PERMITTED, AND STILL EMPTY. A chain whose robots admit us but whose prices
  // live in its Order and Pay app publishes nothing a reader may take. That is
  // a fact about the SOURCE and not about our permission, so it needs its own
  // word: refusing it as `robots-disallowed` would libel a host that said yes,
  // and dropping it from the table would lose the finding entirely.
  "publishes-no-web-price",
  "no-firecrawl-key",
  "budget-exhausted",
  "not-scheduled-this-run",
] as const;
export type HarvestSkipReason = (typeof HARVEST_SKIP_REASONS)[number];

export type HarvestSourceKind =
  | "chain-deals"
  | "venue-events"
  | "pub-facts"
  // A chain's own published menu prices. Its own kind rather than a flavour of
  // `chain-deals`, because a DEAL is an offer with a day on it and a PRICE is
  // what a pint costs tonight, and only the second may reach a price surface.
  | "chain-menu-prices";

export type HarvestSourceAccess =
  | { allowed: true; evidence: string; checkedOn: string }
  | { allowed: false; reason: HarvestSkipReason; evidence: string; checkedOn: string };

export type HarvestSource = {
  id: string;
  /** Provenance label carried by every row this source produces. */
  label: string;
  /** Provenance URL, and the page the fetcher actually reads. */
  url: string;
  kind: HarvestSourceKind;
  /** True when the publisher owns the thing published (an operator, not a listings site). */
  firstParty: boolean;
  access: HarvestSourceAccess;
  /**
   * Why a publisher that does not own what it publishes is nonetheless read.
   * FIRST PARTY IS THE DEFAULT, so an allowed non-first-party source states its
   * own exception here - what it may take, and what it may not - or the fence
   * refuses it.
   */
  nonFirstPartyException?: string;
  /**
   * Seconds a polite reader waits between requests to this host, when the host
   * publishes a Crawl-delay. Absent means the host asked for none.
   */
  crawlDelaySeconds?: number;
  /**
   * The other hosts this chain publishes the SAME rendered menu on.
   *
   * A source row carries one url, and a chain publishes its estate across
   * several brand domains. Naming them here is what lets the rendered lane read
   * a Hungry Horse menu under the Greene King permission that actually covers
   * it, instead of treating each brand as an unargued host.
   */
  renderedMenuHosts?: readonly string[];
  /**
   * What a chain appends to a pub's own page to reach that pub's menu. Absent
   * means `/menu`, which is what every chain in this table uses today.
   */
  menuPathSuffix?: string;
  /** What this source is expected to yield, and what it plainly will not. */
  notes: string;
};

const CHECKED_ON = "2026-08-09";

/** The day the chain menu-price sources below were re-read, live. */
const PRICE_CHECKED_ON = "2026-09-03";

/**
 * The day a chain's menu was re-read WITH A BROWSER.
 *
 * Kept apart from PRICE_CHECKED_ON because the two answer different questions.
 * A document read says what the served HTML states; a rendered read says what
 * the page states to a reader. Greene King answered "nothing" to the first and
 * "102 prices" to the second on consecutive days, so a verdict has to carry
 * which question it answered.
 */
const RENDER_CHECKED_ON = "2026-09-04";

export const HARVEST_SOURCES: readonly HarvestSource[] = [
  // --- chain deals: first-party operator offers pages ----------------------
  {
    id: "wetherspoon-food-drink",
    label: "J D Wetherspoon - Food & drink",
    url: "https://www.jdwetherspoon.com/food-drink/",
    kind: "chain-deals",
    firstParty: true,
    access: {
      allowed: true,
      evidence: "robots.txt: `User-agent: *` with an empty `Disallow:` (allow all), plus `Crawl-delay: 10`.",
      checkedOn: CHECKED_ON,
    },
    crawlDelaySeconds: 10,
    notes:
      "Publishes its weekly club days under a `## Club deals` heading, each stating its own day and window. This is the page the hand-seeded club table was transcribed from; harvesting it means a club that changes is picked up rather than re-typed.",
  },
  {
    id: "greene-king-deals",
    label: "Greene King - Deals",
    url: "https://www.greeneking.co.uk/deals",
    kind: "chain-deals",
    firstParty: true,
    access: {
      allowed: true,
      evidence:
        "robots.txt disallows only infrastructure paths (/bin/, /media/, /sitecore/, booking query strings); /deals is not among them.",
      checkedOn: CHECKED_ON,
    },
    notes:
      "States day-scoped offers, but most name a SISTER BRAND (Flaming Grill, Hungry Horse, Farmhouse Inns) rather than a Greene King pub. A row may only reach the venues of the brand its own copy names, so a Greene King pub earns nothing from a Hungry Horse deal.",
  },
  {
    id: "fullers-whats-on",
    label: "Fuller's - What's on",
    url: "https://www.fullers.co.uk/event-finder",
    kind: "chain-deals",
    firstParty: true,
    access: {
      allowed: true,
      evidence: "robots.txt disallows /sitecore/, /homepage/ and three internal paths only.",
      checkedOn: CHECKED_ON,
    },
    notes:
      "Checked 2026-08-09: the event finder renders its results in the browser, so the served document lists no event, and the programme pages behind it (for example Laughs On Tap) give a season rather than a date. Expect zero rows until Fuller's publishes dates in the document.",
  },
  {
    id: "youngs-offers",
    label: "Young's - On Tap",
    url: "https://www.youngs.co.uk/on-tap-app",
    kind: "chain-deals",
    firstParty: true,
    access: {
      allowed: true,
      evidence: "robots.txt: `User-agent: *` with an empty `Disallow:` (allow all).",
      checkedOn: CHECKED_ON,
    },
    notes:
      "Checked 2026-08-09: Young's publishes app rewards rather than a recurring deal day, and names no day or window. Expect zero rows; its per-pub pages are useful for stated opening hours instead.",
  },
  {
    id: "mitchells-butlers-brands",
    label: "Mitchells & Butlers pub brands",
    url: "https://www.mbplc.com/",
    kind: "chain-deals",
    firstParty: true,
    access: {
      allowed: false,
      reason: "robots-unreadable",
      evidence:
        "Nicholson's, All Bar One, O'Neill's, Castle, Ember Inns, Sizzling Pubs, Toby Carvery and Browns all answer /robots.txt with a challenge page rather than a rules file, so no permission can be read. The two estate sites that do answer (harvester.co.uk, millerandcarter.co.uk) carry `User-agent: CloudflareBrowserRenderingCrawler / Disallow: /`, which is the headless-renderer class this harvest uses.",
      checkedOn: CHECKED_ON,
    },
    notes:
      "Refused on permission, not on reachability. Revisit if the estate publishes a readable robots.txt that admits a rendering crawler, or if Mitchells & Butlers offers a feed.",
  },

  // --- chain menu PRICES: permission, and then the separate question of
  // whether anything is published ------------------------------------------
  //
  // These rows exist because price sources had no entry in this table at all,
  // and that gap let the two governance tables disagree in production:
  // data/price_sources.json marked Nicholson's permissible while the estate
  // entry below refused it, and 1,914 Nicholson's rows shipped on the refused
  // side of that contradiction. A price source is now fenced exactly like every
  // other source, and the narrower rule binds.
  //
  // PERMISSION AND SUPPLY ARE TWO QUESTIONS. Both chains below said YES on
  // 2026-09-03 and both publish no price a reader can take, which is why
  // `publishes-no-web-price` exists as its own answer.
  {
    id: "greene-king-menu-prices",
    label: "Greene King - pub menus",
    url: "https://www.greeneking.co.uk/pubs",
    kind: "chain-menu-prices",
    firstParty: true,
    access: {
      allowed: true,
      evidence:
        "robots.txt re-read 2026-09-03 and again 2026-09-04: HTTP 200, `User-agent: *` disallowing infrastructure paths only (/bin/, /media/, /sitecore/, /js/, /css/ and the booking query strings), with the single blanket Disallow aimed at Screaming Frog. The pub and menu paths are permitted. The 2026-09-03 refusal was `publishes-no-web-price`, on the served document alone: /pubs/greater-london/sherlock-holmes/menu answered 200 with 150 KB and not one figure. That finding was about the DOCUMENT and not about the SITE. Read the same permitted URL with a browser on 2026-09-04 and it states 102 prices, so the refusal is withdrawn and the rendered lane reads it.",
      checkedOn: RENDER_CHECKED_ON,
    },
    renderedMenuHosts: [
      "greeneking-pubs.co.uk",
      "hungryhorse.co.uk",
      "chefandbrewer.com",
      "farmhouseinns.co.uk",
      "flaminggrill.co.uk",
    ],
    notes:
      "Permitted, and it publishes prices in the browser rather than in the document, which is why scripts/harvest/uk-prices/render.mjs exists. THREE THINGS WERE MEASURED HERE ON 2026-09-04 and the first two correct what this note said before. (1) THERE IS NO DRAUGHT TAB. This note previously said the draught list sat behind an interaction we did not perform. It does not: 20 pub menus were read with a browser, 8 that had already priced and 12 that had not, and the whole section vocabulary across them is food (Small Plates, Burgers, Grills, Pub Classics, Sides) plus Wine, Fizz and Cocktails. Not one draught, beer, lager, ale or cider section exists. Greene King publishes no beer price on the web, which is the same finding as the 1,538 Greene King rows already in public/data/drink_price_updates being 863 wines and 675 cocktails with no beer among them. Pressing a Drinks tab was tried and dropped: the one apparent gain did not reproduce. (2) THE PAGE WAS NOT BEING RENDERED AT ALL, and that, rather than any tab, is why the first rendered run priced only 115 of 1,121. The renderer decides for itself whether to open a browser, and for this estate it kept choosing not to: a Chef & Brewer menu page answered three times out of three with 538 characters saying `Content is loading...`, and the same URL with rendering forced states 58. The lane now forces it, asks an unfinished page again, and takes a page that says it is still loading at its word. (3) FOUR OF THE SIX BRAND HOSTS STATE NO DRINK PRICE. Over the whole estate only greeneking.co.uk and greeneking-pubs.co.uk price a drink; hungryhorse.co.uk, chefandbrewer.com, farmhouseinns.co.uk and flaminggrill.co.uk publish a FOOD menu at that path and keep their drinks in marketing copy, checked page by page and again by hand on a Hungry Horse cocktails page that runs to five thousand characters of prose and no figure. They stay in the table, because a brand that is read and states nothing is a finding with a count, and dropping them would lose it.",
  },
  {
    id: "wetherspoon-menu-prices",
    label: "J D Wetherspoon - pub menus",
    url: "https://www.jdwetherspoon.com/pub-menus-sitemap.xml",
    kind: "chain-menu-prices",
    firstParty: true,
    access: {
      allowed: false,
      reason: "publishes-no-web-price",
      evidence:
        "robots.txt re-read 2026-09-03: HTTP 200, `User-agent: *` with an empty `Disallow:` (allow all) plus `Crawl-delay: 10`. The sitemap index publishes a pub-menus sitemap listing 828 per-pub menu pages, every one of them permitted. The refusal is NOT about permission: the menu page states its own answer in its own copy, `Download our app - See pricing and effortlessly order food and drinks to your table`. The page offers a PDF table menu and allergen information; the prices are in the app.",
      checkedOn: PRICE_CHECKED_ON,
    },
    crawlDelaySeconds: 10,
    notes:
      "828 permitted pub-menu pages and no price on any of them. Revisit if the PDF table menu starts carrying prices, or if Wetherspoon publishes a price feed. Reading the app would need an agreement, not a crawler.",
  },
  {
    id: "mitchells-butlers-menu-prices",
    label: "Mitchells & Butlers pub menus (Nicholson's and estate)",
    url: "https://www.nicholsonspubs.co.uk/",
    kind: "chain-menu-prices",
    firstParty: true,
    access: {
      allowed: false,
      reason: "robots-unreadable",
      evidence:
        "robots.txt re-read 2026-09-03, as the brief required: https://www.nicholsonspubs.co.uk/robots.txt answers HTTP 403 with a Cloudflare `Attention Required!` challenge page, not a rules file. No permission can be read, so the estate STAYS REFUSED, unchanged from the 2026-08-09 verdict. This is the entry that settles the contradiction with data/price_sources.json.",
      checkedOn: PRICE_CHECKED_ON,
    },
    notes:
      "The one chain in the tree that DOES publish per-drink prices on the web, and the one we may not read. That asymmetry is the whole argument for asking Mitchells & Butlers for permission or a feed: it is the single largest lever on price coverage. Until then no Nicholson's page is read and no Nicholson's row may seed an estimate basis.",
  },

  // --- events: the one permitted listings reader, then the refused ---------
  {
    id: "fullers-event-finder-events",
    label: "Fuller's",
    url: "https://www.fullers.co.uk/event-finder",
    kind: "venue-events",
    firstParty: true,
    access: {
      allowed: true,
      evidence: "robots.txt disallows /sitecore/, /homepage/ and three internal paths only.",
      checkedOn: CHECKED_ON,
    },
    notes:
      "The operator's own event finder. Checked 2026-08-09: results render in the browser, so a markdown read may yield zero dated rows until Fuller's publishes dates in the document. Context.dev events lane reads this page; the chain-deals lane reads the same URL separately.",
  },
  {
    id: "common-social-posts",
    label: "common",
    url: "https://www.common-social.com/sitemap.xml",
    kind: "venue-events",
    firstParty: false,
    access: {
      allowed: true,
      evidence:
        "robots.txt: `User-agent: *` with no Disallow covering /post/, and it names the sitemap itself. Checked 2026-08-16. No commercial-use bar is stated, and the reader takes no page the sitemap does not list.",
      checkedOn: "2026-08-16",
    },
    nonFirstPartyException:
      "Captain 2026-08-16, and the exception is narrow: FACTS ONLY plus a link out. Place and date come from the og:description prefix, the description text itself is never stored or rendered, and every card links back to the post. Nothing here is a price lane.",
    crawlDelaySeconds: 1,
    notes:
      "Read by scripts/whatson/commonRefresh.mjs, which is bound to this entry's own URL and delay. FACTS ONLY plus a link out: it reads og:title and the og:description PREFIX (`<place> · <date>`) and nothing else, so the description text and the names inside it are never stored or rendered. One request per second, a UA naming PUBMAXX and the public contact, and a per-run fetch cap. Common publishes no clock time, so a row states a date and says so.",
  },
  {
    id: "skiddle-listings",
    label: "Skiddle",
    url: "https://www.skiddle.com/whats-on/London/",
    kind: "venue-events",
    firstParty: false,
    access: {
      allowed: false,
      reason: "terms-forbid-commercial-use",
      evidence:
        "Skiddle's own terms make the events data non-commercial without written approval from dev@skiddle.com; PUBMAXX is commercial. robots.txt would permit the listing path, but the narrower rule binds. Recorded the same way in docs/EVENT_SOURCES_RESEARCH_2026-07-18.md.",
      checkedOn: CHECKED_ON,
    },
    notes:
      "The best pub-scale London coverage of the aggregators, and the one worth asking for. Written approval plus SKIDDLE_API_KEY switches on the official API path in scripts/whatson/eventsRefresh.mjs; it does not switch on scraping.",
  },
  {
    id: "dice-listings",
    label: "DICE",
    url: "https://dice.fm/browse/london",
    kind: "venue-events",
    firstParty: false,
    access: {
      allowed: false,
      reason: "robots-disallowed",
      evidence:
        "robots.txt names `User-agent: CloudflareBrowserRenderingCrawler / Disallow: /` alongside the AI crawlers, and sets `Content-Signal: ai-train=no,use=reference`. The generic `Allow: /` does not survive the narrower rule.",
      checkedOn: CHECKED_ON,
    },
    notes: "No public discovery API either, so there is no permitted path to this inventory today.",
  },
  {
    id: "wegottickets-listings",
    label: "WeGotTickets",
    url: "https://www.wegottickets.com/searchresults/all/London",
    kind: "venue-events",
    firstParty: false,
    access: {
      allowed: false,
      reason: "robots-disallowed",
      evidence:
        "robots.txt permits the search page but disallows /af/, which is where every event on it links. An event we may not open is an event we may not date, price or attribute.",
      checkedOn: CHECKED_ON,
    },
    notes:
      "Checked 2026-08-09: the London search page is a national promo shelf in any case (its cards were North Shields and Northampton events), so the permitted half carries no London listing worth taking.",
  },
];

const BY_ID = new Map(HARVEST_SOURCES.map((source) => [source.id, source]));

export function harvestSource(id: string): HarvestSource | undefined {
  return BY_ID.get(id);
}

export function isHarvestSourceAllowed(source: HarvestSource): boolean {
  return source.access.allowed;
}

export function harvestSourcesOfKind(kind: HarvestSourceKind): HarvestSource[] {
  return HARVEST_SOURCES.filter((source) => source.kind === kind);
}

/** The sources of a kind this run may actually read. */
export function allowedHarvestSources(kind: HarvestSourceKind): HarvestSource[] {
  return harvestSourcesOfKind(kind).filter(isHarvestSourceAllowed);
}

/**
 * Allowed venue-events pages the Context.dev events lane may read.
 *
 * FIRST PARTY IS THE BAR, and it is the semantic property rather than a proxy
 * for it: an extract call hands a whole page to a model and takes back whatever
 * it says, so it cannot honour the narrow `nonFirstPartyException` an allowed
 * listings source carries ("facts only, from the og:description prefix" is a
 * promise no extraction keeps). A URL suffix stood in for this and would have
 * admitted the next allowed non-first-party page that did not happen to end
 * `.xml`.
 */
export function contextDevEventSources(): HarvestSource[] {
  return allowedHarvestSources("venue-events").filter((source) => source.firstParty);
}

/**
 * The skip reasons that mean WE MAY NOT READ THIS HOST, as opposed to the ones
 * that mean we read it and there was nothing there, or we did not get to it
 * this run.
 *
 * The distinction is load-bearing for `REFUSED_HOSTS` below. Greene King and
 * Wetherspoon both gave permission and both publish no price, so their
 * menu-price rows are refused for `publishes-no-web-price`. Folding that into a
 * permission refusal would bar their own pub pages from every other lane, which
 * would be a false statement about hosts that said yes.
 */
const PERMISSION_REFUSALS: ReadonlySet<HarvestSkipReason> = new Set([
  "robots-disallowed",
  "robots-unreadable",
  "terms-forbid-commercial-use",
]);

/** True when a source is refused because we may not read it, not because it was empty. */
export function isRefusedOnPermission(source: HarvestSource): boolean {
  return !source.access.allowed && PERMISSION_REFUSALS.has(source.access.reason);
}

/**
 * The BRAND hosts of an estate this table refuses, named one by one.
 *
 * A source row carries ONE url, so the Mitchells & Butlers rows above put
 * `mbplc.com` and `nicholsonspubs.co.uk` beyond reach and said nothing about
 * `vintageinn.co.uk`. That gap is not theoretical: the UK-wide crawl found 160
 * pubs pointing at Vintage Inns, 144 at Ember Inns, 47 at Sizzling Pubs and 14
 * at O'Neill's, and every one of those hosts would have been asked as though it
 * were an independent pub's own site. Each answers /robots.txt with a 403
 * challenge, so each was refused live and nothing was taken - but a refusal we
 * happen to re-derive on every run is not the same as a refusal we recorded.
 *
 * Re-read live on 2026-09-04 through the UK price crawl: vintageinn.co.uk,
 * emberinns.co.uk, sizzlingpubs.co.uk and oneills.co.uk each answered
 * /robots.txt with HTTP 403, unchanged from the 2026-08-09 estate verdict.
 */
export const REFUSED_ESTATE_HOSTS: readonly string[] = [
  "allbarone.co.uk",
  "browns-restaurants.co.uk",
  "emberinns.co.uk",
  "harvester.co.uk",
  "millerandcarter.co.uk",
  "oneills.co.uk",
  "sizzlingpubs.co.uk",
  "tobycarvery.co.uk",
  "vintageinn.co.uk",
];

/**
 * A venue's own site is first-party by definition, so it needs no table row -
 * but it still has to be a real http(s) origin we can attribute, and it may
 * never be one of the hosts we may not read, wearing a venue's name.
 */
const REFUSED_HOSTS = new Set([
  ...HARVEST_SOURCES.filter(isRefusedOnPermission).map((source) => {
    try {
      return new URL(source.url).hostname.replace(/^www\./, "");
    } catch {
      return source.url;
    }
  }),
  ...REFUSED_ESTATE_HOSTS,
]);

export function isHarvestableOperatorUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.trim().length === 0) return false;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  return !REFUSED_HOSTS.has(url.hostname.replace(/^www\./, ""));
}

/**
 * Hosts this table has ALREADY recorded a permission for, with evidence and a
 * day it was checked.
 *
 * This is what lets the Context.dev wrapper tell a page we have argued about
 * from an arbitrary URL. A host in here answered yes on a recorded date, so a
 * read of it needs no second question; every other host has to be asked live
 * before a credit is spent. The set is deliberately narrow: only rows whose
 * `access.allowed` is true, so a row refused on permission and a row refused
 * for `publishes-no-web-price` alike fall to the live check rather than
 * inheriting a permission the table never granted them.
 */
const PERMITTED_SOURCE_HOSTS: ReadonlySet<string> = new Set(
  HARVEST_SOURCES.filter(isHarvestSourceAllowed).flatMap((source) => {
    try {
      return [new URL(source.url).hostname.replace(/^www\./, "")];
    } catch {
      return [];
    }
  }),
);

/**
 * True when this table already holds a recorded permission for the URL's host.
 *
 * False is not a refusal. It means "nobody has written this host's answer
 * down", which is a reason to ask robots live, and `isHarvestableOperatorUrl`
 * stays the separate question of whether the host is one we may not read at
 * all.
 */
export function hasRecordedHarvestPermission(value: unknown): boolean {
  if (typeof value !== "string" || value.trim().length === 0) return false;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  return PERMITTED_SOURCE_HOSTS.has(url.hostname.replace(/^www\./, ""));
}
