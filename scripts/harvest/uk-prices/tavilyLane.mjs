// Harvest rules: docs/UK_PRICE_HARVEST.md#lane-four-tavily-and-browserbase.
// A directory can state a pub's address, so discovery checks the site's name before address binding.

import { looksLikeChallengePage } from "../../../lib/harvest/robots.ts";
import { harvestRedirectLanding, isHarvestableOperatorUrl } from "../../../lib/harvest/sourcePolicy.ts";
import {
  cheapestPerCategory,
  isLikelyMenuUrl,
  menuLinkCandidates,
  pageMayPriceThisPub,
  pageStatesADrinksList,
  renderLooksEmpty,
  siteHarvestPriceKey,
} from "../../../lib/harvest/ukPriceCrawl.ts";
import { isChainHost } from "../../lib/chainPubClassifier.mjs";
import { TAVILY_EXTRACT_BATCH } from "../../lib/localRefreshProviders.mjs";
import { canonicalPostcode, contactLinkCandidates, hostOfUrl, NOT_A_PUBS_OWN_SITE, pageBindsPub } from "./exaSites.mjs";
import { THIRD_PARTY_SITE_HOSTS } from "./pubSites.mjs";

export const TAVILY_LANE_OUTCOMES = Object.freeze([
  "priced",
  "partial",
  "chain-delegated",
  "policy-refused-host",
  "redirect-refused",
  "refused-by-site",
  "blocked-by-challenge",
  "robots-disallowed",
  "robots-unreadable",
  "unreachable",
  "no-address-to-bind",
  "no-site-found",
  "site-unbound",
  "no-menu-page-found",
  "menu-states-no-price",
  "estate-page-names-no-pub",
  "budget-spent",
]);

export function tavilyOutcomeNeedsRetry(outcome) {
  return outcome === "budget-spent" || outcome === "partial";
}

/** A basic search is billed one credit. */
const SEARCH_CREDITS = 1;
/** A basic extraction is billed one credit per five pages read. */
const EXTRACT_CREDITS_PER_PAGE = 0.2;
const MENU_PAGES_PER_PUB = 3;
const READ_CREDITS_PER_PUB = (MENU_PAGES_PER_PUB + 2) * EXTRACT_CREDITS_PER_PAGE;

/** Directories Tavily is told not to return, so a search spends its results on pub sites. */
export const DISCOVERY_EXCLUDED_DOMAINS = Object.freeze([
  "beerintheevening.com",
  "camra.org.uk",
  "designmynight.com",
  "facebook.com",
  "instagram.com",
  "opentable.co.uk",
  "pubsgalore.co.uk",
  "restaurantguru.com",
  "squaremeal.co.uk",
  "tavily.com",
  "thefork.co.uk",
  "tripadvisor.co.uk",
  "tripadvisor.com",
  "untappd.com",
  "useyourlocal.com",
  "whatpub.com",
  "yell.com",
]);

export function permittedTavilySite(url) {
  if (!isHarvestableOperatorUrl(url)) return false;
  const host = hostOfUrl(url).replace(/\.$/, "");
  return !NOT_A_PUBS_OWN_SITE.test(host) && !THIRD_PARTY_SITE_HOSTS.test(host)
    && !DISCOVERY_EXCLUDED_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

export function siteLinksFromPage(page) {
  const refusal = page.reason ?? (!page.ok && [401, 403, 407, 429, 451].includes(page.status) ? "refused-by-site" : null);
  if (refusal) return { menu: [], contact: [], refusal };
  if (!page.ok) return { menu: [], contact: [] };
  if (page.pdf) return { menu: [], contact: [], pdf: true };
  if (looksLikeChallengePage(page.body)) return { menu: [], contact: [], refusal: "blocked-by-challenge" };
  return {
    menu: menuLinkCandidates(page.body, page.finalUrl, Infinity),
    contact: contactLinkCandidates(page.body, page.finalUrl, 1),
  };
}

const GENERIC_NAME_WORDS = new Set([
  "and", "arms", "bar", "club", "free", "hotel", "house", "inn", "kitchen", "lounge",
  "olde", "public", "rooms", "tap", "tavern", "the",
]);

function nameWords(name) {
  const words = String(name ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['’]/g, "")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const distinctive = words.filter((word) => word.length >= 4 && !GENERIC_NAME_WORDS.has(word));
  return distinctive.length
    ? distinctive
    : [words.filter((word) => word !== "the").join("")].filter((word) => word.length >= 4);
}

/**
 * The label a business registers: "thecrown" in thecrown.co.uk. A pub's name in
 * a subdomain of someone else's platform (crown.somedirectory.com) is not it.
 */
function registeredLabel(host) {
  const labels = String(host ?? "").toLowerCase().split(".").filter(Boolean);
  const secondLevel = labels.length >= 3 && /^(co|org|ltd|plc|me|net)$/.test(labels.at(-2)) && labels.at(-1) === "uk";
  return labels.at(secondLevel ? -3 : -2) ?? "";
}

/** Whether a host's registered name spells a distinctive word of the pub's name. */
function hostCarriesPubName(host, name) {
  const compact = registeredLabel(host).replace(/[^a-z0-9]/g, "");
  return nameWords(name).some((word) => compact.includes(word));
}

/** What a page must state for a searched-for site to be this pub's. */
function bindingForPub(pub) {
  const postcode = canonicalPostcode(pub?.postcode);
  const parts = String(pub?.address ?? "").split(",").map((part) => part.trim()).filter(Boolean);
  let streetAddress = null;
  if (/^\d+[a-z]?$/i.test(parts[0] ?? "") && parts[1] && !canonicalPostcode(parts[1])) {
    streetAddress = `${parts[0]} ${parts[1]}`;
  } else if (/^\d+[a-z]?\s+\S/i.test(parts[0] ?? "")) {
    streetAddress = parts[0];
  }
  return postcode || streetAddress ? { postcode, streetAddress } : null;
}

function discoveryQuery(pub) {
  return `"${String(pub.name).trim()}" ${canonicalPostcode(pub.postcode) ?? pub.address ?? ""} pub`.trim();
}

/**
 * The search result that may be this pub's own site, or why none may.
 * `stateOwner(host)` names the pub the snapshot states that host for, if any.
 */
export function discoveredSiteFor(pub, results, { stateOwner = () => null, claimedBy = () => null } = {}) {
  const considered = [];
  for (const result of results) {
    const host = hostOfUrl(result.url);
    if (!host) continue;
    considered.push(host);
    if (!permittedTavilySite(result.url) || isChainHost(host)) continue;
    const owner = stateOwner(host) ?? claimedBy(host);
    if (owner && owner !== pub.osmId) continue;
    if (!hostCarriesPubName(host, pub.name)) continue;
    const origin = new URL(result.url).origin;
    const seedUrls = results
      .map((other) => withoutNonContentParams(other.url))
      .filter((url) => hostOfUrl(url) === host && isLikelyMenuUrl(url, origin));
    return { host, siteUrl: `${origin}/`, seedUrls };
  }
  return {
    refusal: "no-site-found",
    evidence: `${results.length} result(s), none a pub's own site: ${[...new Set(considered)].slice(0, 6).join(", ")}`,
  };
}

const NON_CONTENT_PARAMS = /^(?:modal|scroll-to|scrollto|utm_.*|fbclid|gclid|ref)$/i;

function withoutNonContentParams(url) {
  try {
    const parsed = new URL(url);
    for (const name of [...parsed.searchParams.keys()]) {
      if (NON_CONTENT_PARAMS.test(name)) parsed.searchParams.delete(name);
    }
    return parsed.href;
  } catch {
    return url;
  }
}

function normaliseUrl(url) {
  try {
    const parsed = new URL(withoutNonContentParams(url));
    parsed.hash = "";
    parsed.hostname = parsed.hostname.replace(/^www\./, "");
    parsed.pathname = parsed.pathname.replace(/\/$/, "");
    return parsed.href;
  } catch {
    return String(url).toLowerCase();
  }
}

/** Same-site links in Tavily markdown, resolved against the page they sit on. */
function markdownLinks(markdown, pageUrl) {
  const links = [];
  for (const match of String(markdown ?? "").matchAll(/(?<!!)\[([^\]]*)\]\(\s*([^)\s]+)[^)]*\)/g)) {
    try {
      const url = new URL(match[2], pageUrl);
      url.hash = "";
      if (url.protocol === "http:" || url.protocol === "https:") links.push({ label: match[1], url: url.href });
    } catch {
      // A link that names no URL names no page.
    }
  }
  return links;
}

const CONTACT_LINK = /(contact|find[- ]?us|location|visit|about)/i;

function decideRobots(decision) {
  if (decision.allowed) return null;
  return decision.reason === "robots-disallowed"
    ? "robots-disallowed"
    : decision.reason === "robots-unreachable"
      ? "unreachable"
      : "robots-unreadable";
}

/** A credit budget the run shares between searches and extractions. */
export function createCreditBudget(limit) {
  let spent = 0;
  return {
    canSpend: (credits) => spent + credits <= limit + 1e-9,
    charge: (credits) => {
      spent += credits;
    },
    get spent() {
      return spent;
    },
    limit,
  };
}

function pageRecord(state, url, kind) {
  url = withoutNonContentParams(url);
  const key = normaliseUrl(url);
  if (state.refusals.some((refusal) => DEFINITIVE_REFUSALS.has(refusal.reason) && normaliseUrl(refusal.url) === key)) return null;
  if ((kind === "menu" || kind === "seed") && state.completedUrls.has(key)
    && (state.addressBound || key !== normaliseUrl(state.bindingUrl))) return null;
  const existing = state.pages.find((page) => normaliseUrl(page.url) === key);
  if (existing) {
    if (kind === "start") existing.kind = kind;
    if (kind === "menu" || kind === "seed") existing.menu = true;
    return null;
  }
  const page = { url, kind, markdown: null, landed: null, via: null, error: null };
  state.pages.push(page);
  return page;
}

async function gatePage(state, page, robots) {
  if (!permittedTavilySite(page.url)) {
    page.error = "policy-refused";
    state.refusals.push({ url: page.url, reason: "policy-refused-host" });
    return false;
  }
  const decision = await robots(page.url);
  const refused = decideRobots(decision);
  if (refused) {
    page.error = refused;
    state.refusals.push({ url: page.url, reason: refused, evidence: String(decision.evidence ?? "").slice(0, 200) });
    return false;
  }
  state.robots ??= decision.robots ?? null;
  return true;
}

async function acceptLanding(state, page, landedUrl, robots, checkedRedirects = false) {
  const landing = harvestRedirectLanding(page.url, landedUrl);
  if (landing.outcome === "refused" || !permittedTavilySite(landing.url)
    || hostOfUrl(landing.url) !== hostOfUrl(page.url)
    || (!checkedRedirects && normaliseUrl(landing.url) !== normaliseUrl(page.url))) {
    page.error = "redirect-refused";
    state.refusals.push({ url: landing.url, reason: "redirect-refused" });
    return false;
  }
  if (!(await gatePage(state, { ...page, url: landing.url }, robots))) {
    page.error = state.refusals.at(-1).reason;
    return false;
  }
  page.landed = landing.url;
  return true;
}

function acceptContent(state, page, markdown, via) {
  if (looksLikeChallengePage(markdown)) {
    page.error = "blocked-by-challenge";
    state.refusals.push({ url: page.url, reason: page.error });
    return false;
  }
  page.markdown = markdown;
  page.via = via;
  page.reading = null;
  return true;
}

/** A Markdown list marker is layout, not part of the drink's printed name. */
function printedLabel(label) {
  if (typeof label !== "string") return label;
  const cleaned = label.replace(/^\s*(?:[-*+\u2022]\s+)+/, "").trim();
  return cleaned || undefined;
}

const PDF_URL = /\.pdf$/i;

/**
 * Tavily flattens a PDF's columns, which puts a price beside the wrong drink,
 * so a PDF is read through its own text layer instead (lib/harvest/pdfText.ts).
 */
async function readPdfPages(pending, deps) {
  for (const { state, page } of pending) {
    if (!deps.readPdf) {
      page.error = "pdf-not-read";
      continue;
    }
    const answer = await deps.readPdf(page.url);
    if (!answer.text) {
      const error = answer.error ?? "pdf has no text layer";
      const refusal = answer.refusal ?? (/^HTTP (401|403|407|429|451)\b/.test(error) ? "refused-by-site" : null);
      page.error = refusal ?? error;
      if (refusal) state.refusals.push({ url: page.url, reason: refusal });
      continue;
    }
    if (!(await acceptLanding(state, page, answer.finalUrl, deps.robots, true))) continue;
    acceptContent(state, page, answer.text, "pdf-text");
  }
}

/** One URL Tavily rejects outright fails its whole batch, so a rejected batch is asked again one page at a time. */
async function extractOrSplit(urls, deps) {
  try {
    return await deps.extract(urls);
  } catch (error) {
    if (urls.length === 1 || error?.status !== 400) throw error;
    const answer = { pages: [], failed: [], credits: 0 };
    for (const url of urls) {
      try {
        const one = await deps.extract([url]);
        answer.pages.push(...one.pages);
        answer.failed.push(...one.failed);
        answer.credits += one.credits ?? 0;
      } catch (single) {
        answer.failed.push({ url, error: String(single?.message ?? single).slice(0, 160) });
      }
    }
    return answer;
  }
}

async function extractPages(allPending, deps, budget) {
  const isPdf = (item) => {
    try {
      return item.page.pdf || PDF_URL.test(new URL(item.page.url).pathname);
    } catch {
      return false;
    }
  };
  await readPdfPages(allPending.filter(isPdf), deps);
  const pending = allPending.filter((item) => !isPdf(item));
  const byUrl = new Map();
  for (const item of pending) {
    const key = normaliseUrl(item.page.url);
    if (!byUrl.has(key)) byUrl.set(key, []);
    byUrl.get(key).push(item);
  }
  const keys = [...byUrl.keys()];
  for (let at = 0; at < keys.length; at += TAVILY_EXTRACT_BATCH) {
    const chunk = keys.slice(at, at + TAVILY_EXTRACT_BATCH);
    while (chunk.length && !budget.canSpend(chunk.length * EXTRACT_CREDITS_PER_PAGE)) {
      const key = chunk.pop();
      for (const item of byUrl.get(key)) {
        item.page.error = "budget-spent";
        item.state.budgetSpent = true;
      }
    }
    if (!chunk.length) continue;
    const urls = chunk.map((key) => byUrl.get(key)[0].page.url);
    let answer;
    try {
      answer = await extractOrSplit(urls, deps);
    } catch (error) {
      for (const key of chunk) {
        for (const item of byUrl.get(key)) item.page.error = `tavily: ${String(error?.message ?? error).slice(0, 160)}`;
      }
      continue;
    }
    budget.charge(answer.pages.length * EXTRACT_CREDITS_PER_PAGE);
    deps.onCredits?.({ extract: answer.credits, pagesRead: answer.pages.length });
    const read = new Map(answer.pages.map((page) => [normaliseUrl(page.url), page]));
    const failed = new Map(answer.failed.map((page) => [normaliseUrl(page.url), page.error]));
    for (const key of chunk) {
      const page = read.get(key);
      for (const item of byUrl.get(key)) {
        if (!page) {
          const unexpected = answer.pages.find((other) => !byUrl.has(normaliseUrl(other.url)));
          if (unexpected) {
            item.page.error = "redirect-refused";
            item.state.refusals.push({ url: unexpected.url, reason: "redirect-refused" });
          } else {
            item.page.error = `tavily: ${failed.get(key) ?? "not extracted"}`;
          }
          continue;
        }
        if (!(await acceptLanding(item.state, item.page, page.url, deps.robots))) continue;
        acceptContent(item.state, item.page, page.markdown, "tavily");
      }
    }
  }
}

const STATES_A_PRICE = /£\s?\d/;

async function readingFor(state, page, deps) {
  if (!page.reading) {
    const { reading } = await deps.readPrices(page.markdown, { pubName: state.target.pub.name, pageUrl: page.landed });
    page.reading = reading;
  }
  return page.reading;
}

async function needsRender(state, page, hasMenuPage, deps) {
  if (page.incomplete || page.error || typeof page.markdown !== "string" || page.via !== "tavily" || page.kind === "contact") return false;
  if (page.kind === "start" && hasMenuPage
    && !(state.target.pendingUrls ?? []).some((url) => normaliseUrl(url) === normaliseUrl(page.url))) return false;
  return !pageStatesADrinksList(await readingFor(state, page, deps));
}

async function renderPage(state, page, deps) {
  page.incomplete = true;
  if (!deps.render || !deps.renderBudget?.take()) return false;
  if (!(await gatePage(state, { ...page, url: page.landed ?? page.url }, deps.robots))) {
    page.error = state.refusals.at(-1).reason;
    page.markdown = null;
    return false;
  }
  try {
    const rendered = await deps.render(page.landed ?? page.url);
    if (!(await acceptLanding(state, page, rendered.finalUrl, deps.robots))) {
      page.markdown = null;
      return false;
    }
    if (!acceptContent(state, page, rendered.markdown, rendered.via ?? "browserbase")) {
      page.markdown = null;
      return false;
    }
    page.incomplete = /\b(?:loading\b|please wait\b)/i.test(rendered.markdown)
      || (!STATES_A_PRICE.test(rendered.markdown) && renderLooksEmpty(rendered.markdown));
    state.rendered = (state.rendered ?? 0) + 1;
    return rendered.links ?? [];
  } catch (error) {
    if (error?.refusal) {
      page.error = error.refusal;
      page.incomplete = false;
      page.markdown = null;
      state.refusals.push({ url: page.url, reason: error.refusal });
      return false;
    }
    page.error = "render-failed";
    state.renderErrors.push(String(error?.message ?? error).slice(0, 160));
    return false;
  }
}

const DRINKS_PAGE_WORDS = /(drink|bar|beer|ale|tap|cask|wine|cocktail|cider|spirit|gin|whisk)/i;
const FOOD_PAGE_WORDS = /(food|sunday|kid|youngster|child|breakfast|brunch|lunch|dessert|pudding|main-menu|set-menu|bagel|burger|bangers|roast|christmas|xmas|festive|party|function)/i;

/** Drinks pages before mixed menus, and food menus last, so the per-pub page cap reads drinks first. */
function drinksFirst(url) {
  let content = url;
  try {
    const parsed = new URL(withoutNonContentParams(url));
    content = [decodeURIComponent(parsed.pathname), ...parsed.searchParams.values()].join(" ");
  } catch {
    // An unparseable URL keeps its whole string for ranking.
  }
  if (DRINKS_PAGE_WORDS.test(content) && !FOOD_PAGE_WORDS.test(content)) return 0;
  return FOOD_PAGE_WORDS.test(content) ? 2 : 1;
}

function queueLinks(state, links, origin) {
  const menu = links
    .map((link) => withoutNonContentParams(link.url ?? link))
    .filter((url) => isLikelyMenuUrl(url, origin));
  for (const url of menu) {
    pageRecord(state, url, "menu");
  }
}

/** A stated website can itself be the drinks page (/drinks/), and then it counts as one. */
function startIsMenuPage(url) {
  try {
    const parsed = new URL(url);
    return parsed.pathname !== "/" && isLikelyMenuUrl(parsed.href, parsed.origin);
  } catch {
    return false;
  }
}

function isMenuPage(page) {
  return page.menu || page.kind === "menu" || page.kind === "seed" || (page.kind === "start" && startIsMenuPage(page.url));
}

const DEFINITIVE_REFUSALS = new Set([
  "policy-refused", "policy-refused-host", "robots-disallowed", "robots-unreadable",
  "redirect-refused", "blocked-by-challenge", "refused-by-site",
]);

function result(state, outcome, evidence, rows = []) {
  for (const row of rows) state.priceKeys.add(siteHarvestPriceKey(row.category, row.drinkLabel, row.servingSize));
  const pendingUrls = state.pages.filter((page) =>
    !DEFINITIVE_REFUSALS.has(page.error)
    && (page.incomplete || (isMenuPage(page) && typeof page.markdown !== "string")))
    .toSorted((a, b) => Number(b.error === "page-cap") - Number(a.error === "page-cap"))
    .map((page) => page.url);
  if (pendingUrls.length && state.discovered && !state.addressBound) {
    for (const page of state.pages) {
      if (isMenuPage(page) && !DEFINITIVE_REFUSALS.has(page.error) && !pendingUrls.includes(page.url)) pendingUrls.push(page.url);
    }
  }
  for (const url of pendingUrls) state.completedUrls.delete(normaliseUrl(url));
  for (const page of state.pages) {
    if (DEFINITIVE_REFUSALS.has(page.error)) {
      state.completedUrls.delete(normaliseUrl(page.url));
    } else if (isMenuPage(page) && typeof page.markdown === "string" && !page.incomplete && !page.error
      && (!state.discovered || state.addressBound)) {
      state.completedUrls.add(normaliseUrl(page.url));
    }
  }
  return {
    osmId: state.target.pub.osmId,
    venueId: state.target.venueId,
    host: state.host,
    siteUrl: state.target.siteUrl,
    seedUrls: state.seedUrls,
    pendingUrls,
    completedUrls: [...state.completedUrls],
    bindingUrl: state.bindingUrl ?? null,
    outcome: pendingUrls.length ? "partial" : state.budgetSpent ? "budget-spent" : outcome,
    evidence: state.budgetSpent ? `${evidence}. Budget exhausted with pending work` : evidence,
    addressBound: state.addressBound ?? false,
    discovered: state.discovered,
    robots: state.robots ?? null,
    searches: state.searches,
    pagesRead: state.pages.filter((page) => page.markdown).length,
    pages: state.pages.map((page) => ({
      url: page.landed ?? page.url,
      kind: page.kind,
      via: page.via,
      error: page.error,
      figures: typeof page.markdown === "string" ? (page.markdown.match(/£\s?\d/g) ?? []).length : null,
    })),
    rendered: state.rendered ?? 0,
    renderErrors: state.renderErrors,
    refusals: state.refusals,
    drops: state.drops,
    rows,
    priceKeys: [...state.priceKeys],
  };
}

async function resolveSite(state, deps, budget, reservedReads) {
  const { pub } = state.target;
  if ((!state.target.siteUrl || state.discovered) && !state.binding) {
    return result(state, "no-address-to-bind", "OSM states no postcode or street address");
  }
  if (state.target.siteUrl) return null;
  if (!budget.canSpend(SEARCH_CREDITS + reservedReads + READ_CREDITS_PER_PUB)) {
    return result(state, "budget-spent", "insufficient credit budget for search and reads");
  }
  let answer;
  try {
    answer = await deps.search(discoveryQuery(pub));
  } catch (error) {
    return result(state, "unreachable", `tavily search: ${String(error?.message ?? error).slice(0, 160)}`);
  }
  budget.charge(SEARCH_CREDITS);
  deps.onCredits?.({ search: answer.credits });
  state.searches += 1;
  const site = discoveredSiteFor(pub, answer.results, deps);
  if (site.refusal) return result(state, site.refusal, site.evidence);
  state.discovered = true;
  state.target = { ...state.target, siteUrl: site.siteUrl, pubsOnHost: 1 };
  state.seedUrls = site.seedUrls;
  return null;
}

/** A site that links no drinks page is asked once, through Tavily, which of its pages state prices. */
async function searchWithinSite(state, deps, budget, pendingReads) {
  if (!deps.siteSearch) return;
  if (!budget.canSpend(SEARCH_CREDITS + pendingReads + MENU_PAGES_PER_PUB * EXTRACT_CREDITS_PER_PAGE)) {
    state.budgetSpent = true;
    return;
  }
  let answer;
  try {
    answer = await deps.siteSearch(state.host, state.target.pub.name);
  } catch (error) {
    state.renderErrors.push(`tavily site search: ${String(error?.message ?? error).slice(0, 120)}`);
    return;
  }
  budget.charge(SEARCH_CREDITS);
  deps.onCredits?.({ search: answer.credits });
  state.searches += 1;
  const origin = new URL(state.target.siteUrl).origin;
  for (const found of answer.results) {
    const url = withoutNonContentParams(found.url);
    if (hostOfUrl(url) !== state.host) continue;
    if (!isLikelyMenuUrl(url, origin) && !STATES_A_PRICE.test(found.content)) continue;
    const page = pageRecord(state, url, "menu");
    if (page) state.seedUrls.push(page.url);
  }
}

/**
 * Read a batch of pubs. Each target is `{ pub, venueId, siteUrl, pubsOnHost }`;
 * `siteUrl` is null for a pub OSM states no website for.
 */
export async function harvestPubBatch(targets, deps, budget) {
  const states = targets.map((target) => ({
    target,
    binding: bindingForPub(target.pub),
    host: target.siteUrl ? hostOfUrl(target.siteUrl) : null,
    discovered: Boolean(target.discovered),
    addressBound: Boolean(target.discovered && target.addressBound),
    bindingUrl: target.bindingUrl ? withoutNonContentParams(target.bindingUrl) : null,
    seedUrls: [...(target.seedUrls ?? [])],
    pendingUrlOrder: new Map([...new Set((target.pendingUrls ?? []).map(normaliseUrl))].map((url, index) => [url, index])),
    completedUrls: new Set((target.completedUrls ?? []).map(normaliseUrl)),
    priceKeys: new Set(target.priceKeys ?? []),
    menuReads: 0,
    searches: 0,
    pages: [],
    refusals: [...(target.refusals ?? [])],
    renderErrors: [],
    drops: [],
    robots: null,
  }));
  const done = new Map();

  let reservedReads = states.filter((state) => state.target.siteUrl).length * READ_CREDITS_PER_PUB;
  for (const state of states) {
    const hadSite = Boolean(state.target.siteUrl);
    const early = await resolveSite(state, deps, budget, reservedReads);
    if (early) {
      done.set(state, early);
      continue;
    }
    if (!hadSite) reservedReads += READ_CREDITS_PER_PUB;
    state.host = hostOfUrl(state.target.siteUrl);
    const origin = new URL(state.target.siteUrl).origin;
    const sameSite = (url) => hostOfUrl(url) === state.host || isLikelyMenuUrl(url, origin);
    state.seedUrls = [...new Set(state.seedUrls.map(withoutNonContentParams))].filter(sameSite);
    state.completedUrls = new Set([...state.completedUrls].filter(sameSite));
    if (state.discovered && !state.addressBound && state.bindingUrl
      && hostOfUrl(state.bindingUrl) === state.host) {
      pageRecord(state, state.bindingUrl, "contact");
    }
    for (const seed of [...(state.target.pendingUrls ?? []), ...state.seedUrls].filter(Boolean)) {
      if (sameSite(seed)) pageRecord(state, seed, "seed");
    }
    const pendingStart = (state.target.pendingUrls ?? []).some((url) => normaliseUrl(url) === normaliseUrl(state.target.siteUrl));
    if (!(state.target.pendingUrls?.length) || pendingStart) pageRecord(state, state.target.siteUrl, "start");
  }

  const live = () => states.filter((state) => !done.has(state));
  const unread = (state) => state.pages.filter((page) => page.markdown === null && page.error === null);
  const savedOrder = (state, page) => state.pendingUrlOrder.get(normaliseUrl(page.url)) ?? Infinity;

  async function readRound() {
    const pending = [];
    for (const state of live()) {
      for (const page of unread(state).toSorted((a, b) =>
        savedOrder(state, a) - savedOrder(state, b) || drinksFirst(a.url) - drinksFirst(b.url))) {
        if (page.kind === "menu" || page.kind === "seed") {
          if (state.menuReads >= MENU_PAGES_PER_PUB) {
            page.error = "page-cap";
            continue;
          }
          state.menuReads += 1;
        }
        if (!(await gatePage(state, page, deps.robots))) continue;
        const pdf = PDF_URL.test(new URL(page.url).pathname);
        if (!pdf && deps.siteLinks) {
          const found = await deps.siteLinks(page.url);
          if (found.refusal) {
            page.error = found.refusal;
            state.refusals.push({ url: page.url, reason: found.refusal });
            continue;
          }
          page.pdf = found.pdf === true;
          queueLinks(state, found.menu, new URL(page.url).origin);
          if (state.discovered && !state.addressBound && found.contact[0] && !state.pages.some((other) => other.kind === "contact")) {
            pageRecord(state, found.contact[0], "contact");
          }
        }
        pending.push({ state, page });
      }
    }
    const priority = ({ state, page }) => state.discovered && !state.addressBound
      && normaliseUrl(page.url) === normaliseUrl(state.bindingUrl) ? -1 : Number(!isMenuPage(page));
    pending.sort((a, b) => priority(a) - priority(b));
    await extractPages(pending, deps, budget);
    for (const { state, page } of pending) {
      if (!page.markdown) continue;
      const links = markdownLinks(page.markdown, page.landed);
      queueLinks(state, links, new URL(page.landed).origin);
      if (state.discovered && !state.addressBound && !state.pages.some((other) => other.kind === "contact")) {
        const contact = links.find((link) => CONTACT_LINK.test(`${link.label} ${link.url}`) && hostOfUrl(link.url) === state.host);
        if (contact) pageRecord(state, contact.url, "contact");
      }
    }
  }

  await readRound();
  for (const state of live()) {
    if (!state.pages.some((page) => typeof page.markdown === "string") && unread(state).length === 0) {
      const start = state.pages.find((page) => page.kind === "start") ?? state.pages[0];
      const outcome = state.refusals.at(-1)?.reason ?? (start?.error === "budget-spent" ? "budget-spent" : "unreachable");
      done.set(state, result(state, outcome, start?.error ?? "start page not read"));
      continue;
    }
    if (!state.completedUrls.size && !state.pages.some((page) => page.kind === "menu" || page.kind === "seed")) {
      const pendingReads = live().reduce((sum, other) => sum + unread(other).length, 0) * EXTRACT_CREDITS_PER_PAGE;
      await searchWithinSite(state, deps, budget, pendingReads);
    }
  }
  do {
    await readRound();
    for (const state of live()) {
      const pages = [...state.pages].sort((a, b) => Number(a.kind === "start") - Number(b.kind === "start"));
      for (const page of pages) {
        const hasMenuPage = state.completedUrls.size > 0 || state.pages.some((other) =>
          other.kind !== "start" && isMenuPage(other)
          && ((typeof other.markdown === "string" && !DEFINITIVE_REFUSALS.has(other.error))
            || other.error === "budget-spent" || other.error === "page-cap"));
        if (!(await needsRender(state, page, hasMenuPage, deps))) continue;
        const links = await renderPage(state, page, deps);
        if (links) {
          const origin = new URL(page.landed).origin;
          queueLinks(state, [...links.map((url) => ({ url })), ...markdownLinks(page.markdown, page.landed)], origin);
        }
      }
    }
  } while (live().some((state) => unread(state).length > 0));

  for (const state of live()) {
    done.set(state, await decide(state, deps));
  }
  return states.map((state) => done.get(state));
}

async function decide(state, deps) {
  const read = state.pages.filter((page) => typeof page.markdown === "string");
  const bindingPage = state.discovered ? read.find((page) => pageBindsPub(page.markdown, state.binding)) : null;
  state.bindingUrl = bindingPage?.url ?? state.bindingUrl;
  if (state.discovered && !state.addressBound && !bindingPage) {
    const wanted = state.binding.postcode ?? state.binding.streetAddress;
    return result(state, "site-unbound", `${read.length} page(s) read on ${state.host}, none states ${wanted}`);
  }
  const { pub, pubsOnHost } = state.target;
  if (state.discovered) {
    const owner = deps.claimedBy?.(state.host);
    if (owner && owner !== pub.osmId) return result(state, "site-unbound", `host belongs to ${owner}`);
    state.addressBound = true;
    deps.claim?.(state.host, pub.osmId);
  }
  const identity = { name: pub.name, locality: pub.locality, address: pub.address, website: pub.website };
  let unattributed = 0;
  const best = new Map();
  for (const page of read) {
    const reading = await readingFor(state, page, deps);
    state.drops.push(...reading.drops);
    if (!pageStatesADrinksList(reading)) continue;
    if (!pageMayPriceThisPub(page.landed, identity, pubsOnHost)) {
      unattributed += 1;
      continue;
    }
    for (const priced of cheapestPerCategory(reading)) {
      const row = {
        url: page.landed,
        category: priced.category,
        priceGbp: priced.priceGbp,
        drinkLabel: printedLabel(priced.drinkLabel),
        servingSize: priced.servingSize,
        linesOnPage: reading.kept.length,
        renderer: page.via,
      };
      const key = siteHarvestPriceKey(row.category, row.drinkLabel, row.servingSize);
      const seen = best.get(key);
      if (!seen || row.priceGbp < seen.priceGbp) best.set(key, row);
    }
  }
  const rows = [...best.values()];
  if (rows.length === 0 && state.priceKeys.size === 0) {
    const outcome = unattributed ? "estate-page-names-no-pub"
      : state.refusals.at(-1)?.reason ?? (read.length > 1 ? "menu-states-no-price" : "no-menu-page-found");
    return result(state, outcome, `${read.length} page(s) read, ${state.rendered ?? 0} rendered, no stated drink price`);
  }
  return result(state, "priced", `${read.length} page(s) read, ${state.rendered ?? 0} rendered`, rows);
}
