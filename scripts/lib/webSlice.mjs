import { harvestRedirectLanding } from "../../lib/harvest/sourcePolicy.ts";
import { allowedEvidenceUrl, parseTaskVenues } from "./parallelVenueDiscovery.mjs";
import { rankSearchResults, readFailureIsDefinitive, webPageResult, webQueries } from "./webVenueDiscovery.mjs";

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

// Asks robots for a host, and again `retries` times when the network kept the
// answer from us. A host still unreachable after that is skipped with its
// evidence; robots is never assumed to allow.
export function createRobotsGate(check, { retries = 2, delayMs = 5_000, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), now = () => new Date().toISOString() } = {}) {
  const trials = new Map();
  async function trial(url) {
    const evidence = [];
    for (let attempt = 0; ; attempt += 1) {
      const decision = await check(url, attempt);
      const answer = robotsOutcome(decision);
      evidence.push({ at: now(), reason: decision.reason, evidence: decision.evidence ?? null });
      if (answer.outcome !== "transient") return null;
      if (attempt >= retries) return { outcome: "skipped", reason: answer.reason, attempts: attempt + 1, evidence };
      await sleep(delayMs);
    }
  }
  return async (url) => {
    const host = new URL(url).host;
    if (!trials.has(host)) trials.set(host, trial(url));
    const skipped = await trials.get(host);
    if (skipped) return skipped;
    const decision = await check(url, 0);
    const answer = robotsOutcome(decision);
    return answer.outcome === "transient" ? { outcome: "skipped", reason: answer.reason, attempts: 1, evidence: [{ at: now(), reason: decision.reason, evidence: decision.evidence ?? null }] } : answer;
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

const settled = (page) => page && (typeof page.text === "string" || page.settled === true);

async function readPages(urls, search, state, { spend, refresh }, io) {
  const pages = new Map();
  const extract = [];
  const transient = [];
  const skips = [];
  for (const url of urls) {
    const host = new URL(url).host;
    let answer = state.robots[url];
    if (spend) {
      answer = { ...(await io.robots(url)), checkedAt: io.now() };
      state.robots[url] = answer;
    }
    if (!answer) { transient.push(`robots not yet asked for ${host}`); continue; }
    if (answer.outcome === "skipped") { skips.push({ url, host, reason: answer.reason, attempts: answer.attempts, evidence: answer.evidence, checkedAt: answer.checkedAt }); continue; }
    if (answer.outcome !== "allowed") { pages.set(url, { url, unreadable: `robots refused (${answer.reason})` }); continue; }
    const stored = refresh ? null : await io.storedPage(url);
    const result = search.results.find((row) => row.url === url);
    if (settled(stored)) pages.set(url, stored);
    else if (result?.raw_content) pages.set(url, { url, landedUrl: url, observedAt: search.observedAt, title: result.title ?? null, text: result.raw_content });
    else if (spend) extract.push(url);
    else transient.push(`page not yet read: ${url}`);
  }
  for (let at = 0; at < extract.length; at += 20) {
    const batch = extract.slice(at, at + 20);
    const first = await io.extract(batch, "basic");
    const retry = (first.failed_results ?? []).filter((failure) => !readFailureIsDefinitive(failure)).map((failure) => failure.url);
    const second = retry.length ? await io.extract(retry, "advanced") : { results: [], failed_results: [] };
    const response = { results: [...(first.results ?? []), ...(second.results ?? [])],
      failed_results: [...(first.failed_results ?? []).filter((failure) => !retry.includes(failure.url)), ...(second.failed_results ?? [])] };
    const observedAt = io.now();
    const failures = [...response.failed_results];
    for (const row of response.results) {
      const same = (left, right) => String(left).replace(/^https?:\/\/(?:www\.)?/, "").replace(/\/$/, "") === String(right).replace(/^https?:\/\/(?:www\.)?/, "").replace(/\/$/, "");
      const url = batch.find((asked) => same(asked, row.url));
      if (!url) continue;
      const landed = harvestRedirectLanding(url, row.url);
      const page = landed.outcome === "refused" || !allowedEvidenceUrl(landed.url) ? { url, unreadable: "landed outside the source fence", settled: true, observedAt }
        : { url, landedUrl: landed.url, observedAt, title: search.results.find((result) => result.url === url)?.title ?? null, text: row.raw_content ?? "" };
      await io.storePage(url, page);
      pages.set(url, page);
    }
    for (const url of batch) if (!pages.has(url) && !failures.some((failure) => failure.url === url)) failures.push({ url, error: "Extract returned nothing" });
    for (const failure of failures) {
      const probe = readFailureIsDefinitive(failure) ? null : await io.probe(failure.url);
      const reason = settleReadFailure(failure, probe);
      if (!reason) { transient.push(`Tavily Extract: ${String(failure.error).slice(0, 80)} for ${failure.url}`); continue; }
      const page = { url: failure.url, unreadable: reason, settled: true, observedAt, evidence: { extract: String(failure.error ?? "").slice(0, 120), probe } };
      await io.storePage(failure.url, page);
      pages.set(failure.url, page);
    }
  }
  return { pages, transient, skips };
}

// Searches a slice with Tavily, one query variant at a time, until a variant
// finds no page the slice has not read, then reads each page's own text.
// Without spend it replays the searches, page text and robots answers already
// recorded, and stays incomplete only where a paid read is still missing.
export async function webSlice({ city, district, category }, { spend, refresh = false }, io) {
  const state = (refresh ? null : await io.loadState()) ?? { city: city.id, district, category: category.id, queries: [] };
  state.robots ??= {};
  const found = [];
  const rejected = [];
  const skips = [];
  const read = new Set();
  let researched = 0;
  const outcome = (complete) => ({ found, rejected, researched, taskRuns: 0, webSearches: state.queries.length, pagesRead: read.size, skips, complete });
  try {
    for (const [index, query] of webQueries(city, district, category).entries()) {
      if (!state.queries[index]) {
        if (!spend) return outcome(false);
        const response = await io.search(query);
        state.queries.push({ query, resultPath: await io.saveSearch(index, response), observedAt: io.now() });
        await io.saveState(state);
      }
      const search = { ...(await io.readSearch(state.queries[index].resultPath)), observedAt: state.queries[index].observedAt };
      const urls = rankSearchResults(search.results, district).filter((url) => !read.has(url));
      if (!urls.length) break;
      urls.forEach((url) => read.add(url));
      const pages = await readPages(urls, search, state, { spend, refresh }, io);
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
          if (row) found.push({ ...row, provider: "tavily" });
          else rejected.push({ name: candidate.name, reason: "postcode-does-not-geocode-inside-city" });
        }
      }
      if (pages.transient.length) throw new Error(`${pages.transient.length} pages not read yet (${pages.transient[0]}); rerun to resume`);
    }
  } catch (error) { throw Object.assign(error, { partial: outcome(false) }); }
  return outcome(true);
}
