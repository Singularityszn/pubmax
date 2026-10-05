import { harvestRedirectLanding } from "../../lib/harvest/sourcePolicy.ts";
import { allowedEvidenceUrl, parseTaskVenues } from "./parallelVenueDiscovery.mjs";
import { nonVenueSource, rankSearchResults, readFailureIsDefinitive, webPageResult, webQueries } from "./webVenueDiscovery.mjs";

// A robots answer the source gave, or one the network kept from us. Only an
// unreachable host, a timeout, a 429 or a 5xx is the network; a missing file
// is permission and a 401 or 403 is a refusal.
export function robotsOutcome(decision) {
  if (decision.allowed) return { outcome: "allowed", reason: decision.reason };
  const status = Number(/answered (\d{3})/.exec(decision.evidence ?? "")?.[1]);
  if (decision.reason === "robots-unreachable") return { outcome: "transient", reason: "robots unreachable" };
  if (decision.reason === "robots-unreadable" && (status === 429 || status >= 500)) return { outcome: "transient", reason: `robots HTTP ${status}` };
  return { outcome: "refused", reason: decision.reason };
}

// Asks robots for a host, and again `retries` times with a fresh checker when
// the network kept the answer from us. A host that answers keeps the checker
// that reached it, so each later URL is judged on that host's own rules. A host
// still unreachable after the retries is skipped with its evidence; robots is
// never assumed to allow.
export function createRobotsGate(makeChecker, { retries = 2, delayMs = 5_000, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), now = () => new Date().toISOString() } = {}) {
  const shared = makeChecker();
  const hosts = new Map();
  async function trial(url) {
    const evidence = [];
    let checker = shared;
    for (let attempt = 0; ; attempt += 1) {
      const decision = await checker(url);
      const answer = robotsOutcome(decision);
      evidence.push({ at: now(), reason: decision.reason, evidence: decision.evidence ?? null });
      if (answer.outcome !== "transient") return { checker };
      if (attempt >= retries) return { skip: { outcome: "skipped", kind: "robots", reason: answer.reason, attempts: attempt + 1, evidence } };
      await sleep(delayMs);
      checker = makeChecker();
    }
  }
  return async (url) => {
    const host = new URL(url).host;
    if (!hosts.has(host)) hosts.set(host, trial(url));
    const reached = await hosts.get(host);
    return reached.skip ?? robotsOutcome(await reached.checker(url));
  };
}

// An Extract failure is settled only by evidence: a 404 or 410, a source
// refusal, or a landing outside the fence. "Failed to fetch url" is not one.
export function settleReadFailure(failure, probe) {
  if (readFailureIsDefinitive(failure)) return `extract: ${String(failure.error ?? failure.status).slice(0, 120)}`;
  if (!probe) return null;
  if (probe.landed === "refused") return "landed outside the source fence";
  if (probe.status === 404 || probe.status === 410) return `page HTTP ${probe.status}`;
  if ([401, 403, 451].includes(probe.status)) return `source refused HTTP ${probe.status}`;
  return null;
}

const settled = (page) => page && (typeof page.text === "string" || page.settled === true || Boolean(page.skip));

const sameUrl = (left, right) => String(left).replace(/^https?:\/\/(?:www\.)?/, "").replace(/\/$/, "") === String(right).replace(/^https?:\/\/(?:www\.)?/, "").replace(/\/$/, "");
const answeredIn = (response, url) => (response.results ?? []).find((row) => sameUrl(url, row.url));
const failureIn = (response, url) => (response.failed_results ?? []).find((failure) => failure.url === url) ?? { url, error: "Extract returned nothing" };

// The reader a slice's pages go through: Tavily Extract at basic depth and
// again at advanced depth, unless the I/O names another reader.
const TAVILY_READER = { provider: "tavily", label: "Tavily Extract", failed: "failed at basic and advanced depth", depths: ["basic", "advanced"] };

// One read batch at the reader's first depth, and the pages it could not read
// once more at its second depth when it has one. What no read gets is settled
// by the page's own status when that says gone or refused, and otherwise
// skipped with the evidence.
async function readBatch(batch, search, io, pages, skips) {
  const reader = io.reader ?? TAVILY_READER;
  const [firstDepth, secondDepth] = reader.depths;
  let first = {};
  let second = {};
  let retry = [];
  let stopped = null;
  try {
    first = await io.extract(batch, firstDepth);
    retry = secondDepth ? batch.filter((url) => !answeredIn(first, url) && !readFailureIsDefinitive(failureIn(first, url))) : [];
    if (retry.length) second = await io.extract(retry, secondDepth);
  } catch (error) {
    stopped = error;
    if (retry.length) second = error.answered ?? {};
    else first = error.answered ?? {};
  }
  const observedAt = io.now();
  for (const url of batch) {
    const row = answeredIn(first, url) ?? answeredIn(second, url);
    if (row) {
      const landed = harvestRedirectLanding(url, row.landed_url ?? row.url);
      const page = landed.outcome === "refused" || !allowedEvidenceUrl(landed.url) ? { url, unreadable: "landed outside the source fence", settled: true, observedAt }
        : { url, landedUrl: landed.url, observedAt, title: search.results.find((result) => result.url === url)?.title ?? null, text: row.raw_content ?? "", ...(reader === TAVILY_READER ? {} : { reader: reader.provider }) };
      await io.storePage(url, page);
      pages.set(url, page);
      continue;
    }
    const failure = retry.includes(url) ? failureIn(second, url) : failureIn(first, url);
    if (stopped && !readFailureIsDefinitive(failure)) continue;
    const probe = readFailureIsDefinitive(failure) ? null : await io.probe(url);
    const reason = settleReadFailure(failure, probe);
    const evidence = { [firstDepth]: String(failureIn(first, url).error ?? "").slice(0, 120), ...(secondDepth ? { [secondDepth]: retry.includes(url) ? String(failure.error ?? "").slice(0, 120) : null } : {}), probe };
    if (reason) {
      const page = { url, unreadable: reason, settled: true, observedAt, evidence };
      await io.storePage(url, page);
      pages.set(url, page);
      continue;
    }
    const skip = { outcome: "skipped", kind: "extract", reason: `${reader.label} ${reader.failed}; ${probe ? `the page answered HTTP ${probe.status}` : "the page did not answer"}`, attempts: reader.depths.length, evidence, checkedAt: observedAt };
    await io.storePage(url, { url, skip });
    skips.push({ url, host: new URL(url).host, ...skip });
  }
  if (stopped) throw stopped;
}

// With skipsOnly, a spending run asks robots again and reads again only the
// sources an earlier run skipped; every settled answer and page replays.
async function readPages(urls, search, state, { spend, refresh, skipsOnly }, io) {
  const pages = new Map();
  const extract = [];
  const transient = [];
  const skips = [];
  for (const url of urls) {
    const host = new URL(url).host;
    let answer = state.robots[url];
    if (spend && (!skipsOnly || !answer || answer.outcome === "skipped")) {
      answer = { ...(await io.robots(url)), checkedAt: io.now() };
      state.robots[url] = answer;
    }
    if (!answer) { transient.push(`robots not yet asked for ${host}`); continue; }
    if (answer.outcome === "skipped") { skips.push({ url, host, kind: "robots", reason: answer.reason, attempts: answer.attempts, evidence: answer.evidence, checkedAt: answer.checkedAt }); continue; }
    if (answer.outcome !== "allowed") { pages.set(url, { url, unreadable: `robots refused (${answer.reason})` }); continue; }
    const stored = refresh ? null : await io.storedPage(url);
    const result = search.results.find((row) => row.url === url);
    if (stored?.skip && spend && skipsOnly) extract.push(url);
    else if (stored?.skip) skips.push({ url, host, ...stored.skip });
    else if (settled(stored)) pages.set(url, stored);
    else if (result?.raw_content) pages.set(url, { url, landedUrl: url, observedAt: search.observedAt, title: result.title ?? null, text: result.raw_content });
    else if (spend) extract.push(url);
    else transient.push(`page not yet read: ${url}`);
  }
  for (let at = 0; at < extract.length; at += 20) await readBatch(extract.slice(at, at + 20), search, io, pages, skips);
  return { pages, transient, skips };
}

// Searches a slice with Tavily, one query variant at a time, until a variant
// finds no page the slice has not read, then reads each page's own text. A
// page from a site that cannot describe a venue is filtered with its reason
// before anything is read or paid for. A page Extract cannot read at basic or
// advanced depth is skipped with the evidence of both reads and the page's own
// status, unless that status settles it as gone or refused.
// Without spend it replays the searches, page text and robots answers already
// recorded, and stays incomplete only where a paid read is still missing.
// With skipsOnly it never searches: it replays the recorded searches and
// spends only on the sources an earlier run skipped.
export async function webSlice({ city, district, category }, { spend, refresh = false, skipsOnly = false }, io) {
  const state = (refresh ? null : await io.loadState()) ?? { city: city.id, district, category: category.id, queries: [] };
  state.robots ??= {};
  const found = [];
  const rejected = [];
  const skips = [];
  const filtered = new Map();
  const read = new Set();
  let researched = 0;
  const outcome = (complete) => ({ found, rejected, researched, taskRuns: 0, webSearches: state.queries.length, pagesRead: read.size, skips, filtered: [...filtered.values()], complete });
  try {
    for (const [index, query] of webQueries(city, district, category).entries()) {
      if (!state.queries[index]) {
        if (!spend || skipsOnly) return outcome(false);
        const response = await io.search(query);
        state.queries.push({ query, resultPath: await io.saveSearch(index, response), observedAt: io.now() });
        await io.saveState(state);
      }
      const search = { ...(await io.readSearch(state.queries[index].resultPath)), observedAt: state.queries[index].observedAt };
      const urls = [];
      for (const url of rankSearchResults(search.results, district).filter((candidate) => !read.has(candidate) && !filtered.has(candidate))) {
        const reason = nonVenueSource(url);
        if (reason) filtered.set(url, { url, host: new URL(url).host, reason });
        else urls.push(url);
      }
      if (!urls.length) break;
      urls.forEach((url) => read.add(url));
      const pages = await readPages(urls, search, state, { spend, refresh, skipsOnly }, io);
      if (spend) await io.saveState(state);
      skips.push(...pages.skips);
      for (const page of pages.pages.values()) {
        if (page.unreadable) { rejected.push({ name: page.url, reason: `unreadable: ${page.unreadable}` }); continue; }
        const result = webPageResult(page, city, district);
        const parsed = parseTaskVenues(result, city, page.observedAt, { local: true });
        researched += result.output.content.venues.length;
        rejected.push(...parsed.rejected);
        for (const candidate of parsed.candidates) {
          const row = await io.geocode(candidate);
          if (row) found.push({ ...row, provider: page.reader === "firecrawl" ? "tavily-firecrawl" : "tavily" });
          else rejected.push({ name: candidate.name, reason: "postcode-does-not-geocode-inside-city" });
        }
      }
      if (pages.transient.length) throw new Error(`${pages.transient.length} pages not read yet (${pages.transient[0]}); rerun to resume`);
    }
  } catch (error) { throw Object.assign(error, { partial: outcome(false) }); }
  return outcome(true);
}
