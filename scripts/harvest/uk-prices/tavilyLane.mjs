// The Tavily lane: a UK pub's own drinks list, found and read through Tavily,
// and rendered through Browserbase when the page Tavily read carries no price.
// Kept apart from tavily.mjs so the rules are testable without a network.
//
// FIVE RULES.
//
// 1. THE PUB'S OWN SITE, OR NOTHING. A pub OSM states a website for starts
//    there. A pub with none is searched for once, and a result counts only
//    when its host is not a directory, a social page or a chain estate, its
//    name carries a distinctive word of the pub's name, and no other pub in
//    the snapshot states it. A directory page states the pub's address as
//    readily as the pub does, so the name rule comes first.
//
// 2. A FOUND SITE IS BOUND BY ADDRESS. A searched-for site gives a price only
//    when a page read on it states the pub's own postcode or house number and
//    street, the same binding the Exa lane uses (`pageBindsPub`).
//
// 3. PERMISSION BEFORE EVERY READ. `isHarvestableOperatorUrl` and a live
//    robots ask come before any URL is handed to Tavily or Browserbase, and
//    the page a provider says it read is asked again (`harvestRedirectLanding`
//    and the same host). A refusal is recorded with its reason.
//
// 4. A BROWSER IS NOT A WAY PAST A SHUT DOOR. Only a page Tavily did read, and
//    which stated no price, is rendered. A page Tavily could not read is not,
//    and a rendered challenge page is dropped.
//
// 5. THE SHARED READER DECIDES. Every figure goes through the reader in
//    lib/harvest/ukPriceCrawl.ts, a page must state a drinks list, and an
//    estate page must name the pub (`pageMayPriceThisPub`).

import { looksLikeChallengePage } from "../../../lib/harvest/robots.ts";
import { harvestRedirectLanding, isHarvestableOperatorUrl } from "../../../lib/harvest/sourcePolicy.ts";
import {
  cheapestPerCategory,
  isLikelyMenuUrl,
  menuLinkCandidates,
  pageMayPriceThisPub,
  pageStatesADrinksList,
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
      .filter((other) => hostOfUrl(other.url) === host && isLikelyMenuUrl(other.url, origin))
      .map((other) => other.url);
    return { host, siteUrl: `${origin}/`, seedUrls };
  }
  return {
    refusal: "no-site-found",
    evidence: `${results.length} result(s), none a pub's own site: ${[...new Set(considered)].slice(0, 6).join(", ")}`,
  };
}

function normaliseUrl(url) {
  try {
    const parsed = new URL(url);
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
  const key = normaliseUrl(url);
  if ((kind === "menu" || kind === "seed") && state.completedUrls.has(key)
    && key !== normaliseUrl(state.target.bindingUrl)) return null;
  if (state.pages.some((page) => normaliseUrl(page.url) === key)) return null;
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
      page.error = answer.error ?? "pdf has no text layer";
      const refusal = answer.refusal ?? (/^HTTP (401|403|407|429|451)\b/.test(page.error) ? "refused-by-site" : null);
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
    if (!acceptContent(state, page, rendered.markdown, "browserbase")) {
      page.markdown = null;
      return false;
    }
    page.incomplete = false;
    state.rendered = (state.rendered ?? 0) + 1;
    return rendered.links ?? [];
  } catch (error) {
    page.error = "render-failed";
    state.renderErrors.push(String(error?.message ?? error).slice(0, 160));
    return false;
  }
}

function queueLinks(state, links, origin) {
  const menu = links.filter((link) => isLikelyMenuUrl(link.url ?? link, origin));
  for (const link of menu) {
    pageRecord(state, link.url ?? link, "menu");
  }
}

function result(state, outcome, evidence, rows = []) {
  const pendingUrls = state.pages.filter((page) =>
    page.incomplete || ((page.kind === "menu" || page.kind === "seed") && typeof page.markdown !== "string"))
    .toSorted((a, b) => Number(b.error === "page-cap") - Number(a.error === "page-cap"))
    .map((page) => page.url);
  if (pendingUrls.length && state.discovered && !state.addressBound) {
    for (const page of state.pages) {
      if ((page.kind === "menu" || page.kind === "seed") && !pendingUrls.includes(page.url)) pendingUrls.push(page.url);
    }
  }
  for (const url of pendingUrls) state.completedUrls.delete(normaliseUrl(url));
  for (const page of state.pages) {
    if ((page.kind === "menu" || page.kind === "seed") && typeof page.markdown === "string" && !page.incomplete
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
    if (hostOfUrl(found.url) !== state.host) continue;
    if (!isLikelyMenuUrl(found.url, origin) && !STATES_A_PRICE.test(found.content)) continue;
    if (pageRecord(state, found.url, "menu")) state.seedUrls.push(found.url);
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
    seedUrls: [...(target.seedUrls ?? [])],
    completedUrls: new Set((target.completedUrls ?? []).map(normaliseUrl)),
    menuReads: 0,
    searches: 0,
    pages: [],
    refusals: [],
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
    state.seedUrls = [...new Set(state.seedUrls)].filter(sameSite);
    state.completedUrls = new Set([...state.completedUrls].filter(sameSite));
    pageRecord(state, state.target.siteUrl, "start");
    for (const seed of [state.target.bindingUrl, ...(state.target.pendingUrls ?? []), ...state.seedUrls].filter(Boolean)) {
      if (sameSite(seed)) pageRecord(state, seed, "seed");
    }
  }

  const live = () => states.filter((state) => !done.has(state));
  const unread = (state) => state.pages.filter((page) => page.markdown === null && page.error === null);

  async function readRound() {
    const pending = [];
    for (const state of live()) {
      for (const page of unread(state)) {
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
          if (state.discovered && found.contact[0] && !state.pages.some((other) => other.kind === "contact")) {
            pageRecord(state, found.contact[0], "contact");
          }
        }
        pending.push({ state, page });
      }
    }
    await extractPages(pending, deps, budget);
    for (const { state, page } of pending) {
      if (!page.markdown) continue;
      const links = markdownLinks(page.markdown, page.landed);
      queueLinks(state, links, new URL(page.landed).origin);
      if (state.discovered && !state.pages.some((other) => other.kind === "contact")) {
        const contact = links.find((link) => CONTACT_LINK.test(`${link.label} ${link.url}`) && hostOfUrl(link.url) === state.host);
        if (contact) pageRecord(state, contact.url, "contact");
      }
    }
  }

  await readRound();
  for (const state of live()) {
    if (!state.pages.some((page) => typeof page.markdown === "string") && unread(state).length === 0) {
      const start = state.pages.find((page) => page.kind === "start");
      const outcome = state.refusals.at(-1)?.reason ?? (start.error === "budget-spent" ? "budget-spent" : "unreachable");
      done.set(state, result(state, outcome, start.error ?? "start page not read"));
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
      const hasMenuPage = state.completedUrls.size > 0 || state.pages.some((page) =>
        (page.kind === "menu" || page.kind === "seed") && typeof page.markdown === "string");
      for (const page of [...state.pages]) {
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
  state.bindingUrl = bindingPage?.url;
  if (state.discovered && !bindingPage) {
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
        drinkLabel: priced.drinkLabel,
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
  if (rows.length === 0 && state.completedUrls.size === 0) {
    const outcome = unattributed ? "estate-page-names-no-pub"
      : state.refusals.at(-1)?.reason ?? (read.length > 1 ? "menu-states-no-price" : "no-menu-page-found");
    return result(state, outcome, `${read.length} page(s) read, ${state.rendered ?? 0} rendered, no stated drink price`);
  }
  return result(state, "priced", `${read.length} page(s) read, ${state.rendered ?? 0} rendered`, rows);
}
