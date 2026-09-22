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
  | "chain-menu-prices"
  // A chain's own list of the pubs it runs today. It names pubs, places and
  // opening hours and never a price, which is why it is not a flavour of
  // `chain-menu-prices`.
  | "pub-directory";

type HarvestSourceAccess =
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
// The events aggregators, re-read against the live robots.txt on this day.
const EVENTS_CHECKED_ON = "2026-09-07";
// The Wetherspoon pub directory, re-read against the live robots.txt and read in
// full on this day.
const DIRECTORY_CHECKED_ON = "2026-09-14";

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
        "robots.txt re-read live 2026-09-22: https://www.nicholsonspubs.co.uk/robots.txt answers HTTP 403 with a Cloudflare challenge page, not a rules file. No permission can be read, so the estate remains refused.",
      checkedOn: "2026-09-22",
    },
    notes:
      "The one chain in the tree that DOES publish per-drink prices on the web, and the one we may not read through the general fence. That asymmetry is the whole argument for asking Mitchells & Butlers for permission or a feed: it is the single largest lever on price coverage. Until then no Nicholson's page is read through `isHarvestableOperatorUrl` alone.",
  },
  {
    id: "youngs-menu-prices",
    label: "Young's - pub menus",
    url: "https://www.youngs.co.uk/our-pubs",
    kind: "chain-menu-prices",
    firstParty: true,
    access: {
      allowed: true,
      evidence:
        "robots.txt re-read 2026-09-22: HTTP 200, Yoast `User-agent: *` with empty Disallow and sitemap_index. Per-pub microsites are still checked against their own live robots response before each request.",
      checkedOn: "2026-09-22",
    },
    notes:
      "Per-pub WordPress microsites; soft drinks when a page states £ beside the drink name.",
  },
  {
    id: "stonegate-menu-prices",
    label: "Stonegate - pub menus (Slug and Lettuce and estate)",
    url: "https://www.slugandlettuce.co.uk/sitemap.xml",
    kind: "chain-menu-prices",
    firstParty: true,
    access: {
      allowed: true,
      evidence:
        "robots.txt re-read 2026-09-22: HTTP 200, `User-agent: *` `Allow: /` with `Disallow: /home` only. Menu paths are still checked against their own live robots response before each request.",
      checkedOn: "2026-09-22",
    },
    notes: "Slug and Lettuce /menus paths; prices only when printed on the page.",
  },
  {
    id: "brewdog-menu-prices",
    label: "BrewDog - bar menus",
    url: "https://brewdog.com/uk/brewdog-bars",
    kind: "chain-menu-prices",
    firstParty: true,
    access: {
      allowed: true,
      evidence:
        "robots.txt re-read 2026-09-22: Shopify disallow list for checkout/cart only; bar pages permitted. Each bar-page request is still checked against its live robots response.",
      checkedOn: "2026-09-22",
    },
    notes: "Bar menu lane only; shop SKUs are out of scope.",
  },

  // --- pub directories: which pubs a chain runs today -----------------------
  {
    id: "wetherspoon-pub-directory",
    label: "J D Wetherspoon - pub directory",
    url: "https://www.jdwetherspoon.com/wp-json/wp/v2/pubs",
    kind: "pub-directory",
    firstParty: true,
    access: {
      allowed: true,
      evidence:
        "robots.txt re-read 2026-09-14: HTTP 200, `User-agent: *` with an empty `Disallow:` (allow all) plus `Crawl-delay: 10`, and /wp-json/ is not disallowed. The same day the endpoint answered a direct read with `x-wp-total: 827` over 9 pages of 100 and `cf-cache-status: EXPIRED`, so the Cloudflare-cached answer of about 10 pubs that once made the refresh go through Firecrawl no longer stands, and the read needs no key.",
      checkedOn: DIRECTORY_CHECKED_ON,
    },
    crawlDelaySeconds: 10,
    notes:
      "Read by scripts/fetch_wetherspoons_pubs.mjs, which takes this entry's URL and delay and also reads the facilities, region and pub-status taxonomies beside it on the same API. The directory lists the pubs the chain runs TODAY: a pub the chain has sold leaves it, while its pub-histories page stays on the site. The Millers Well (E6 2JX) and The Coronet (N7 6PA), both sold in 2023, are listed in pub-histories-sitemap.xml and absent here. It publishes no price; see `wetherspoon-menu-prices`.",
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
        "Skiddle's own terms make the events data non-commercial without written approval from dev@skiddle.com; PUBMAXX is commercial. Re-read 2026-09-07: robots.txt disallows /orders/, /members/, /basket/ and friends and would permit the listing path, but the narrower terms rule binds. Recorded the same way in docs/EVENT_SOURCES_RESEARCH_2026-07-18.md.",
      checkedOn: EVENTS_CHECKED_ON,
    },
    notes:
      "The best pub-scale London coverage of the aggregators, and the one worth asking for. SCRAPING IS REFUSED AND THE OFFICIAL API IS THE PERMITTED PATH: lib/events/skiddle.ts is that adapter, it runs at request time on /api/out, and it stays shut behind SKIDDLE_API_KEY plus the brand-asset fence in lib/whatson/eventNormalise.mjs. Written approval plus the key switch on the API; nothing switches on scraping.",
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
        "robots.txt names `User-agent: CloudflareBrowserRenderingCrawler / Disallow: /` alongside the AI crawlers, and sets `Content-Signal: ai-train=no,use=reference`. The generic `Allow: /` does not survive the narrower rule. Re-read 2026-09-07: unchanged, both rules still stand.",
      checkedOn: EVENTS_CHECKED_ON,
    },
    notes:
      "No public discovery API either, so there is no permitted path to this inventory today. Asked for again on 2026-09-07 for the /out listings lane and refused again: no DICE adapter is built, and this entry IS the record of that answer.",
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

/** Drink overlay rows follow the same permission fence as every other harvest. */
export function isHarvestableDrinkUpdateUrl(value: unknown): boolean {
  if (typeof value !== "string" || !value.trim()) return false;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  if (url.username || url.password || namesOurOwnNetwork(url.hostname)) return false;
  return isHarvestableOperatorUrl(url.href);
}

/**
 * A chain menu transport is bound to one recorded publisher and its explicitly
 * associated first-party pub sites. Callers pass associated hosts only after
 * joining them to the publisher's curated venue records.
 */
export function isHarvestableChainMenuUrl(
  value: unknown,
  sourceId: string,
  associatedHosts: readonly string[] = [],
): boolean {
  const source = HARVEST_SOURCES.find(
    (row) => row.id === sourceId && row.kind === "chain-menu-prices",
  );
  if (!source?.access.allowed || !isHarvestableDrinkUpdateUrl(value)) return false;

  let url: URL;
  try {
    url = new URL(String(value).trim());
  } catch {
    return false;
  }
  if (url.port && !((url.protocol === "http:" && url.port === "80") || (url.protocol === "https:" && url.port === "443"))) {
    return false;
  }

  const normalizeHost = (host: string) => host.toLowerCase().replace(/^www\./, "");
  const sourceHosts = [source.url, ...(source.renderedMenuHosts ?? [])]
    .map((entry) => {
      try {
        return normalizeHost(new URL(entry).hostname);
      } catch {
        return "";
      }
    })
    .filter(Boolean);
  const allowedHosts = new Set([
    ...sourceHosts,
    ...associatedHosts.map(normalizeHost),
  ]);
  return allowedHosts.has(normalizeHost(url.hostname));
}

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

/**
 * Hostname shapes that name THIS MACHINE or the network it sits on rather than
 * a pub's website.
 *
 * A menu URL is not something we typed: it arrives from
 * `harvest_venue_overlays.menu_url`, from a pub's OSM `website` tag, or from a
 * link on a page we crawled. So it is caller-influenced input reaching a
 * server-side fetch, and a loopback, link-local or private address there asks
 * our own infrastructure a question in the name of a pub. The cloud metadata
 * address (169.254.169.254) is the sharpest case and the reason this is a
 * REFUSAL rather than an ordinary miss.
 *
 * THE FAMILY IS DECIDED FIRST, and an address is read as an ADDRESS rather than
 * as a prefix. Reading the hostname as a string admitted the metadata address
 * in the one spelling a crafted value would use - the WHATWG parser normalises
 * `http://[::ffff:169.254.169.254]/` to `[::ffff:a9fe:a9fe]`, which is neither
 * `::1` nor dotted-quad shaped - and it refused every real pub whose name began
 * `fc` or `fd`, because a unique-local test written as `startsWith` was applied
 * to ordinary domains.
 *
 * This predicate does not resolve names. Direct harvest transports also resolve
 * every address, reject a mixed/private answer set, and pin the socket to one
 * admitted answer so the connection cannot perform a second, rebound lookup.
 */
function namesOurOwnNetwork(hostname: string): boolean {
  const bracketed = hostname.startsWith("[") && hostname.endsWith("]");
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host.endsWith(".local") || host.endsWith(".internal")) return true;
  // A colon is never part of a DNS name, so anything holding one is an IPv6
  // literal and is judged as one - including a literal we cannot parse, which
  // fails closed rather than walking through the dotted-quad regex below.
  if (bracketed || host.includes(":")) return namesOurOwnIpv6Network(host);
  return namesOurOwnIpv4Address(host);
}

/** The v4 rules, over a dotted quad. */
function namesOurOwnIpv4Address(host: string): boolean {
  const octets = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!octets) return false;
  const parts = octets.slice(1).map(Number);
  if (parts.some((part) => part > 255)) return true;
  return !isPublicHarvestAddress(host);
}

/**
 * Whether a numeric address is globally routable and safe to pin a harvested
 * request to. DNS answers are judged here after resolution; names are not, and
 * remain governed by `isHarvestableOperatorUrl`'s operator policy.
 */
export function isPublicHarvestAddress(value: string): boolean {
  const host = value.replace(/^\[|\]$/g, "").toLowerCase();
  if (host.includes(":")) {
    const hextets = parseIpv6Hextets(host);
    if (!hextets) return false;
    const first = hextets[0] ?? 0;
    const mappedPrefix = hextets.slice(0, 5).every((part) => part === 0);
    if (mappedPrefix && hextets[5] === 0) return false; // deprecated IPv4-compatible form
    const embedded = embeddedIpv4Octets(hextets);
    if (embedded) {
      // Mapped and well-known NAT64 addresses carry a real v4 destination.
      // 6to4 is deprecated and ambiguous as an outbound route, so fail closed.
      if (first === 0x2002) return false;
      const [a = 0, b = 0, c = 0, d = 0] = embedded;
      return isPublicIpv4Octets(a, b, c, d);
    }
    // Global unicast is 2000::/3. Exclude IANA special-purpose allocations,
    // transition networks and the documentation prefix inside that range.
    if (first < 0x2000 || first > 0x3fff) return false;
    if (first === 0x2001) {
      const second = hextets[1] ?? 0;
      if (second <= 0x01ff) return false; // 2001::/23 special-purpose block
      if (second === 0x0db8) return false; // 2001:db8::/32 documentation
    }
    if (first === 0x3fff && (hextets[1] ?? 0) <= 0x0fff) return false; // 3fff::/20 docs
    return true;
  }

  const octets = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!octets) return false;
  const parts = octets.slice(1).map(Number);
  if (parts.some((part) => part > 255)) return false;
  return isPublicIpv4Octets(parts[0]!, parts[1]!, parts[2]!, parts[3]!);
}

function isPublicIpv4Octets(first: number, second: number, third: number, fourth: number): boolean {
  if (first === 0 || first === 10 || first === 127) return false;
  if (first === 100 && second >= 64 && second <= 127) return false; // 100.64.0.0/10
  if (first === 169 && second === 254) return false;
  if (first === 172 && second >= 16 && second <= 31) return false;
  if (first === 192 && second === 168) return false;
  if (first === 192 && second === 0 && third === 0) return false;
  if (first === 192 && second === 0 && third === 2) return false;
  if (first === 192 && second === 88 && third === 99) return false;
  if (first === 198 && (second === 18 || second === 19)) return false;
  if (first === 198 && second === 51 && third === 100) return false;
  if (first === 203 && second === 0 && third === 113) return false;
  if (first >= 224) return false; // multicast, reserved and broadcast
  return [first, second, third, fourth].every((part) => Number.isInteger(part) && part >= 0 && part <= 255);
}

/**
 * The eight hextets of an IPv6 literal, or null when the text is not one.
 *
 * Handles the spellings a URL can carry: zero compression (`::`), a trailing
 * embedded dotted quad (`::ffff:169.254.169.254`), and a zone id (`%eth0`),
 * which names an interface of THIS machine and is stripped before the address
 * is read.
 */
function parseIpv6Hextets(value: string): number[] | null {
  let text = value.split("%")[0] ?? "";
  if (!text || !text.includes(":")) return null;

  // A trailing dotted quad is rewritten as the two hextets it IS, so there is
  // one parser rather than two shapes of one.
  const lastColon = text.lastIndexOf(":");
  const tail = text.slice(lastColon + 1);
  if (tail.includes(".")) {
    const octets = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(tail);
    if (!octets) return null;
    const parts = octets.slice(1).map(Number);
    if (parts.some((part) => part > 255)) return null;
    const [a = 0, b = 0, c = 0, d = 0] = parts;
    const high = ((a << 8) | b).toString(16);
    const low = ((c << 8) | d).toString(16);
    text = `${text.slice(0, lastColon + 1)}${high}:${low}`;
  }

  const halves = text.split("::");
  if (halves.length > 2) return null;

  const readGroups = (part: string): number[] | null => {
    if (!part) return [];
    const groups: number[] = [];
    for (const group of part.split(":")) {
      if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
      groups.push(Number.parseInt(group, 16));
    }
    return groups;
  };

  const left = readGroups(halves[0] ?? "");
  const right = halves.length === 2 ? readGroups(halves[1] ?? "") : [];
  if (left === null || right === null) return null;

  if (halves.length === 2) {
    const zeros = 8 - left.length - right.length;
    if (zeros < 1) return null;
    return [...left, ...Array<number>(zeros).fill(0), ...right];
  }
  return left.length === 8 ? left : null;
}

/** The v4 address an IPv6 literal EMBEDS, as `[first, second]`, or null. */
function embeddedIpv4Octets(hextets: number[]): number[] | null {
  const at = (index: number): number => hextets[index] ?? 0;
  const fromPair = (high: number, low: number): number[] => [
    (high >> 8) & 0xff,
    high & 0xff,
    (low >> 8) & 0xff,
    low & 0xff,
  ];
  const leadingZero = at(0) === 0 && at(1) === 0 && at(2) === 0 && at(3) === 0 && at(4) === 0;
  // ::ffff:a.b.c.d (mapped) and ::a.b.c.d (deprecated compatible).
  if (leadingZero && (at(5) === 0xffff || at(5) === 0)) return fromPair(at(6), at(7));
  // 64:ff9b::/96, the well-known NAT64 prefix, which a gateway translates back
  // to the v4 address it embeds.
  if (at(0) === 0x0064 && at(1) === 0xff9b && at(2) === 0 && at(3) === 0
    && at(4) === 0 && at(5) === 0) return fromPair(at(6), at(7));
  // 2002::/16, 6to4, which embeds the v4 address in the next two hextets.
  if (at(0) === 0x2002) return fromPair(at(1), at(2));
  return null;
}

/** The v6 rules, by first-hextet RANGE rather than by string prefix. */
function namesOurOwnIpv6Network(host: string): boolean {
  const hextets = parseIpv6Hextets(host);
  if (!hextets) return true;
  return !isPublicHarvestAddress(host);
}

/**
 * True when the hostname IS a refused host or sits UNDER one.
 *
 * A refusal is about an operator, not about one string: `tobycarvery.co.uk`
 * and `menu.tobycarvery.co.uk` are the same estate answering the same way, so
 * refusing only the exact spelling would let every refused estate back in
 * through a subdomain while the table still claimed to hold it out.
 */
function underRefusedHost(hostname: string): boolean {
  const host = hostname.replace(/^www\./, "");
  if (REFUSED_HOSTS.has(host)) return true;
  for (const refused of REFUSED_HOSTS) {
    if (host.endsWith(`.${refused}`)) return true;
  }
  return false;
}

/**
 * What a crawl lane may do with the page a redirect chain LANDED on.
 *
 * `redirect: "follow"` means the host, not us, chooses the last hop, so the
 * permission we asked about is not necessarily the permission we spent. Both
 * price lanes carried the landed URL already and read it with nothing; this is
 * the rule they read it with, in one place, so the two cannot drift.
 *
 * `refused` means the chain left the allow-list and the page is not ours to
 * read. `redirected` means it stayed inside and the row's provenance should
 * name where the words actually were, not where we knocked.
 */
export type HarvestRedirectLanding =
  | { outcome: "same"; url: string }
  | { outcome: "redirected"; url: string }
  | { outcome: "refused"; url: string };

export function harvestRedirectLanding(
  askedUrl: string,
  landedUrl: string | null | undefined,
  policy: HarvestUrlPolicy = "operator",
): HarvestRedirectLanding {
  const landed = typeof landedUrl === "string" && landedUrl.trim() ? landedUrl.trim() : askedUrl;
  if (!isHarvestablePageUrl(landed, policy)) return { outcome: "refused", url: landed };
  return { outcome: landed === askedUrl ? "same" : "redirected", url: landed };
}

/** URL policy classes used by the shared direct-page transport. */
export type HarvestUrlPolicy = "operator" | "drink-update";

/** Keep URL policy decisions in this module; the transport only enforces them. */
export function isHarvestablePageUrl(value: unknown, policy: HarvestUrlPolicy = "operator"): value is string {
  return policy === "drink-update" ? isHarvestableDrinkUpdateUrl(value) : isHarvestableOperatorUrl(value);
}

export function isHarvestableOperatorUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.trim().length === 0) return false;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  // Credentials in a URL are sent to whatever the URL names, so a harvested one
  // is somebody else's secret heading for somebody else's host.
  if (url.username || url.password) return false;
  if (namesOurOwnNetwork(url.hostname)) return false;
  return !underRefusedHost(url.hostname);
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
