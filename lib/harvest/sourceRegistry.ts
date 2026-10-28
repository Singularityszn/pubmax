// Which London sources the harvest may read, and the evidence for each answer.
//
// A SKIP IS A FINDING, NOT A GAP. Every source the harvest knows about is in
// this table whether it may be read or not, each carrying the rule that decided
// it and the day that rule was checked. The run report prints the skips beside
// the counts, so "we harvested nothing from Mitchells & Butlers" reads as a
// recorded decision with a reason rather than as coverage nobody noticed was
// missing. Registered-source fetchers take their URLs from this table.
// Separate venue own-site reads follow docs/data/SOURCE_LEDGER.md.
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
  | "pub-directory"
  // A quiz company's own list of the pubs where it runs a weekly quiz. It names
  // a pub, a weekday, a start time and an entry fee, and never a drink price.
  // Its own kind rather than `venue-events`, because the Context.dev lane reads
  // every first-party `venue-events` page through a model, and this list is
  // read as structured facts by one reader.
  | "quiz-directory"
  // A public body's or a commons' open-data API, read by a builder into its
  // own committed pack. Its permission is the publisher's open licence and API
  // terms rather than robots.txt, and it states facts about businesses it does
  // not own, so every row is a non-first-party exception. A builder never
  // types its URL: it asks `openDataSourceUrl` for one.
  | "open-data";

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
// The open-data APIs, last checked on this day on each builder's first networked
// run. Not every terms page could be read: each row's evidence says what was
// read live and what was not.
const OPEN_DATA_CHECKED_ON = "2026-10-17";
// The quiz directory, read against the live robots.txt, its page list and its
// footer on this day.
const QUIZ_CHECKED_ON = "2026-10-28";

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

  // --- quiz directory: a quiz company's own list of its weekly quizzes ------
  {
    id: "questionone-quiz-venues",
    label: "Question One",
    url: "https://questionone.com/wp-json/wp/v2/venues",
    kind: "quiz-directory",
    firstParty: true,
    access: {
      allowed: true,
      evidence:
        "Captain decision, 28 Oct 2026 (survey question Q2, option a), on the condition that robots and terms are checked first. Read live on 28 Oct 2026. robots.txt: HTTP 200, `User-agent: *` with `Disallow: /wp-admin/` and `Allow: /wp-admin/admin-ajax.php` only, and no Crawl-delay, so /venues/ and /wp-json/ are permitted. Terms: the site publishes no terms of use. The WordPress page list (/wp-json/wp/v2/pages) holds no terms page, /terms/, /terms-and-conditions/, /terms-of-use/ and /privacy-policy/ answer 404, the footer says only `© 2026 Question One. All rights reserved`, and the one terms link on the site is Google's reCAPTCHA notice on the contact form. Nothing read forbids automated reading.",
      checkedOn: QUIZ_CHECKED_ON,
    },
    notes:
      "Question One runs the quizzes it lists, so the list is first party for the quiz and not for the pub. This url is the JSON of the same directory that https://questionone.com/venues/ shows: on 28 Oct 2026 it held 128 venues in 2 pages of 100, 84 of them with a Greater London postcode. FACTS ONLY plus a link out: a row takes the weekday, the start time, the entry fee, the postcode and the map point, and links to the venue's own page on questionone.com. The description text, the phone number and the images are never stored or shown. A non-weekly title (monthly, every other week) is dropped, never rolled forward weekly. Read by refreshQuestionOneQuiz in lib/whatsOnRefresh.server.ts on every What's-On cron run, and by scripts/whatson/quizRefresh.mjs for the bundled pack. Both read through scripts/whatson/questionOneDirectory.mjs.",
  },

  // --- open data: public APIs read by a builder into a committed pack ------
  {
    id: "fsa-fhrs-api",
    label: "Food Standards Agency - Food Hygiene Rating Scheme API",
    url: "https://api.ratings.food.gov.uk/",
    kind: "open-data",
    firstParty: false,
    nonFirstPartyException:
      "The FSA is the statutory publisher of the ratings its local authorities award, so its record IS the rating. Take the rating, its date and the authority for an FHRSID that an OSM pub names in its own fhrs:id tag; never a name match, never anything about the business beyond the rating.",
    access: {
      allowed: true,
      evidence:
        "Owner decision, 16 Oct 2026. Read live on 17 Oct 2026, before the first networked run of npm run build:fsa-hygiene. The FSA's terms and conditions (food.gov.uk/terms-and-conditions) put its content under the Open Government Licence v3.0 and make the use of food hygiene ratings information subject to the OGL; they remind users that showing an invalid or inaccurate rating may be an offence, so a user must show the current rating or the date the information was updated; and they reserve the FHRS imagery and the FSA logo, which may not be used without permission. The API's BestPractices page (api.ratings.food.gov.uk/Help/BestPractices) asks bulk readers for pages of 200 or fewer, because larger pages are rate-limited and answer HTTP 429; for flow control with a configurable sleep, because throttling limits change; recommends the nightly Open Data files for regular full downloads; and suggests running bulk reads between 01:00 and 06:00, though the same throttle applies all day. The API's FAQs say an over-rate client address gets HTTP 403 and concurrency limits answer HTTP 429, and that the FSA does not publish those limits.",
      checkedOn: OPEN_DATA_CHECKED_ON,
    },
    notes:
      "Read by scripts/build_fsa_hygiene_pack.mjs into public/data/fsa_hygiene/london.json: pages of 200 or fewer, one request a second by default (--delay-ms may slow it, never speed it up), the x-api-version: 2 header, and a 429 or 5xx retried a bounded number of times; a 403 stops the run and writes nothing. The pack shows the day it was read beside every rating, as the FSA terms ask. The live /api/hygiene route reads the same API per sheet, server-side.",
  },
  {
    id: "wikidata-query-service",
    label: "Wikidata Query Service (SPARQL)",
    url: "https://query.wikidata.org/sparql",
    kind: "open-data",
    firstParty: false,
    nonFirstPartyException:
      "Wikidata is a commons, not the pub. Take only the history statements (inception, heritage designation, named after, architect) of an item an OSM pub names in its own wikidata tag, at best or normal rank, only when the item is a pub and not a brand, each with its item link and read day.",
    access: {
      allowed: true,
      evidence:
        "Owner decision, 16 Oct 2026. Read live on 17 Oct 2026, before the first networked run of npm run build:wikidata-history. Wikidata:Data access says all of Wikidata's data is CC0 and asks clients to follow the User-Agent policy. The Wikidata Query Service user manual (mediawiki.org) sets a hard 60-second query deadline; allows one client (User-Agent plus IP) 60 seconds of processing time each 60 seconds, 30 error queries a minute and 5 parallel queries per IP; answers a client over those limits with HTTP 429 and a Retry-After header; may temporarily ban a client that keeps asking through 429s; and may block one that breaks the User-Agent policy. The Wikimedia Foundation User-Agent Policy asks scripts for a descriptive User-Agent with contact information (a website or an email address), and says generic or browser-copied agents may be blocked.",
      checkedOn: OPEN_DATA_CHECKED_ON,
    },
    notes:
      "Read by scripts/build_wikidata_history_pack.mjs into public/data/wikidata_history/london.json: batches of 100 items one second apart, a descriptive User-Agent naming a contact URL, and a 429 or 5xx retried a bounded number of times after the service's Retry-After, or after a doubling wait when it sends none.",
  },
  {
    id: "historic-england-nhle",
    label: "Historic England - National Heritage List for England (Listed Building points)",
    url: "https://services-eu1.arcgis.com/ZOdPfBS3aqqDYPUQ/ArcGIS/rest/services/National_Heritage_List_for_England_NHLE_v02_VIEW/FeatureServer/0/query",
    kind: "open-data",
    firstParty: false,
    nonFirstPartyException:
      "Historic England keeps the statutory List of buildings of special architectural or historic interest, so its record IS the listing. Take the list entry number, name, grade and list date of listed-building points inside the Greater London box, and keep one only where scripts/lib/heritageMatch.mjs matches it to a pub by name and place; never a description, an era or a construction date.",
    access: {
      allowed: true,
      evidence:
        "Registered 17 Oct 2026, when the builder's own hard-coded FeatureServer URL moved into this table. Read live on 17 Oct 2026: the layer's service metadata, whose copyright text reads \"© Crown Copyright 2026. Contains Ordnance Survey data © Crown copyright and database right 2026. Released under OGL.\", and its ArcGIS item (owner gis_historicengland), whose licence field names the Historic England Open Data Hub Terms and Conditions and whose data was last edited on 15 Oct 2026. NOT read live: that terms page on historicengland.org.uk, which answered every request from the building environment with a Cloudflare challenge (HTTP 403), and no earlier dated read of it is recorded in this tree. The Open Government Licence v3.0 credit in lib/dataCredits.ts stands on the service's own statement above.",
      checkedOn: OPEN_DATA_CHECKED_ON,
    },
    notes:
      "Read by scripts/build_heritage_listings.mjs into public/data/heritage_listings.json: one page of 1,000 points at a time (the layer allows 2,000), redirects refused, and a failed page stops the run and writes nothing.",
  },
];

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
