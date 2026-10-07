#!/usr/bin/env node
// npm run harvest:contextdev-whats-on -- --plan
// npm run harvest:contextdev-whats-on -- --read --limit=100
// npm run harvest:contextdev-whats-on -- --publish
// npm run harvest:contextdev-whats-on -- --monitor
// npm run harvest:contextdev-whats-on -- --refresh --publish
// The key comes from the caller's environment. Raw pages and resume state stay ignored.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { contextDevUsage, contextDevMonitorLimits, createContextDevBudget, createPageMonitor, pageMonitorRun, refreshChangedPage, scrapeMarkdown } from "../../lib/contextDev.ts";
import { ambiguousPubWebsites, discoverWhatsOnPages, isPubPage, mergeOwnSiteListings, pageKey, readPubWhatsOn } from "../../lib/harvest/contextDevWhatsOn.ts";
import { isChainPage, matchPubToVenue, parseChainDenylist } from "../../lib/harvest/pubWebsiteAmenities.ts";
import { createRobotsChecker } from "../../lib/harvest/robots.ts";
import { isHarvestableOperatorUrl } from "../../lib/harvest/sourcePolicy.ts";
import { stableVenueIdFromKey, venueGroupingKey } from "../lib/venueCanonicalization.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CACHE = path.join(ROOT, "data-harvest/contextdev-whats-on");
const REPORT = path.join(ROOT, "data/harvest/contextdev-whats-on");
const PLAN = path.join(REPORT, "plan.json");
const STATE = path.join(CACHE, "state.json");
const MONITORS = path.join(REPORT, "monitors.json");
const RESERVE = 50;
const MONITOR_BASELINES = 10;
const read = (file) => JSON.parse(readFileSync(file, "utf8"));
const write = (file, value) => writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
const pageFile = (url) => path.join(CACHE, `${pageKey(url)}.json`);
const robots = createRobotsChecker();
const ownSitePubs = read(path.join(ROOT, "data/osm/uk/uk_osm_pubs.json")).pubs.filter((pub) => isHarvestableOperatorUrl(pub.website));
const ambiguousSites = ambiguousPubWebsites(ownSitePubs);

async function usage() {
  const result = await contextDevUsage({ maxAttempts: 1 });
  if (result.status !== "ok") throw new Error(`Cannot read balance: ${result.status === "error" ? result.error.code : result.status}`);
  return result;
}

function plan(credits) {
  const dataset = read(path.join(ROOT, "public/data/pint_prices_app_dataset.json"));
  const anchors = [...new Map(dataset.map((row) => {
    const venueId = stableVenueIdFromKey(venueGroupingKey(row));
    return [venueId, { venueId, name: row.pub_name, lat: row.latitude, lng: row.longitude }];
  })).values()];
  const deny = parseChainDenylist(read(path.join(ROOT, "data/amenities/london_pub_website_chain_pages.json")));
  const candidates = read(path.join(ROOT, "data/osm/uk/uk_osm_pubs.json")).pubs
    .filter((pub) => pub.lat >= 51.26 && pub.lat <= 51.72 && pub.lng >= -0.55 && pub.lng <= 0.3 &&
      isHarvestableOperatorUrl(pub.website) && !ambiguousSites.has(pub.website) && !isChainPage(pub.website, deny))
    .map((pub) => ({ osmId: pub.osmId, name: pub.name, lat: pub.lat, lng: pub.lng, website: pub.website, venueId: matchPubToVenue(pub, anchors)?.venueId ?? null }));
  const known = [];
  for (const file of readdirSync(path.join(ROOT, "public/data/whats_on")).filter((file) => file.endsWith(".json"))) {
    const doc = read(path.join(ROOT, "public/data/whats_on", file));
    for (const row of Array.isArray(doc) ? doc : doc.rows ?? []) if (row.source?.url) known.push(row.source.url);
  }
  candidates.sort((a, b) => Number(known.some((url) => isPubPage(url, b.website))) - Number(known.some((url) => isPubPage(url, a.website))) ||
    Number(Boolean(b.venueId)) - Number(Boolean(a.venueId)) ||
    Math.hypot(a.lat - 51.51, a.lng + 0.12) - Math.hypot(b.lat - 51.51, b.lng + 0.12));
  const unique = [...new Map(candidates.map((pub) => [pub.website.replace(/\/$/, ""), pub])).values()];
  const creditsAtStart = existsSync(path.join(CACHE, "plan.json")) ? read(path.join(CACHE, "plan.json")).creditsAtStart : credits;
  const document = {
    observedAt: new Date().toISOString(), creditsAtStart, reserveCredits: RESERVE,
    maxCredits: Math.max(0, creditsAtStart - RESERVE), estimatedPages: Math.max(0, credits - RESERVE - MONITOR_BASELINES),
    estimatedMonitorBaselines: MONITOR_BASELINES,
    discovery: "Read OSM-stated own sites, then follow published same-pub events, offers and contact links. Prioritise existing listing sources and matched London pubs. At most four pages per venue.",
    knownEventsPages: unique.flatMap((pub) => [...new Set(known.filter((url) => /events|whats-on|whatson/i.test(url) && isPubPage(url, pub.website)))].map((url) => ({ name: pub.name, url }))),
    candidates: unique,
  };
  write(PLAN, document);
  return document;
}

async function harvest(limit) {
  const document = read(PLAN);
  const balance = await usage();
  const state = existsSync(STATE) ? read(STATE) : { creditsBefore: balance.creditsRemaining, reads: [], pending: document.candidates.map((pub) => ({ pub, url: pub.website, depth: 0 })) };
  // Rejected concurrency requests did not read a page. They remain pending.
  const rateLimited = state.reads.filter((entry) => entry.reason === "RATE_LIMITED");
  state.reads = state.reads.filter((entry) => entry.reason !== "RATE_LIMITED");
  state.pending.unshift(...rateLimited.map((entry) => ({ pub: entry.pub, url: entry.url, depth: entry.url === entry.pub.website ? 0 : 1 })));
  // The ten initial sample observations are imported once without a second fetch.
  if (state.reads.length === 0) {
    for (const file of readdirSync(CACHE).filter((file) => /^(node|way|relation)-.*\.json$/.test(file))) {
      const sample = read(path.join(CACHE, file));
      const entry = { pub: sample.pub, url: sample.pub.website, observedAt: sample.observedAt, result: sample.result, depth: 0 };
      write(pageFile(entry.url), entry);
      state.reads.push({ pub: entry.pub, url: entry.url, observedAt: entry.observedAt, status: entry.result.status, reason: entry.result.error?.code });
      state.pending = state.pending.filter((task) => task.url !== entry.url);
      if (entry.result.status === "ok") state.pending.unshift(...discoverWhatsOnPages(entry.result.markdown, entry.result.url).slice(0, 3).map((url) => ({ pub: entry.pub, url, depth: 1 })));
    }
  }
  const completed = new Set(state.reads.map((entry) => entry.url));
  let sent = 0;
  while (state.pending.length && sent < limit) {
    const current = await usage();
    const available = Math.min(current.creditsRemaining - RESERVE - MONITOR_BASELINES,
      document.maxCredits - (document.creditsAtStart - current.creditsRemaining) - MONITOR_BASELINES);
    if (available <= 0) break;
    const batch = [];
    while (state.pending.length && batch.length < Math.min(1, available, limit - sent)) {
      const task = state.pending.shift();
      if (completed.has(task.url) || !isPubPage(task.url, task.pub.website)) continue;
      const held = state.reads.filter((row) => row.pub.osmId === task.pub.osmId).length + batch.filter((row) => row.pub.osmId === task.pub.osmId).length;
      if (held >= 4) continue;
      completed.add(task.url);
      batch.push(task);
    }
    if (!batch.length) continue;
    const budget = createContextDevBudget(Math.min(2, available));
    const results = [];
    for (const task of batch) {
      let result = await scrapeMarkdown(task.url, { robots, budget, maxAgeMs: 0, maxAttempts: 2 });
      if (result.status === "error" && result.error.code === "RATE_LIMITED") {
        state.pending.unshift(task);
        write(STATE, state);
        throw new Error("Serial request still rate limited after bounded backoff; harvest stopped.");
      }
      if (result.status === "ok" && (!isPubPage(result.url, task.pub.website) || !(await robots(result.url)).allowed))
        result = { status: "error", error: { code: "LANDING_REFUSED", message: "Final page left this pub's permitted scope.", retryable: false } };
      const entry = { ...task, observedAt: new Date().toISOString(), result };
      write(pageFile(task.url), entry);
      results.push(entry);
    }
    sent += batch.length;
    for (const entry of results) {
      state.reads.push({ pub: entry.pub, url: entry.url, observedAt: entry.observedAt, status: entry.result.status, reason: entry.result.error?.code });
      if (entry.result.status === "ok" && entry.depth < 2) {
        const pages = discoverWhatsOnPages(entry.result.markdown, entry.result.url)
          .filter((url) => isPubPage(url, entry.pub.website) && !completed.has(url));
        state.pending.unshift(...pages.slice(0, 3).map((url) => ({ pub: entry.pub, url, depth: entry.depth + 1 })));
      }
    }
    state.creditsAfter = (await usage()).creditsRemaining;
    write(STATE, state);
    console.log(JSON.stringify({ read: state.reads.length, successful: state.reads.filter((row) => row.status === "ok").length, creditsLeft: state.creditsAfter, pending: state.pending.length }));
  }
  state.creditsAfter = (await usage()).creditsRemaining;
  write(STATE, state);
}

async function monitor() {
  const limits = await contextDevMonitorLimits({ maxAttempts: 1 });
  if (limits.status !== "ok") throw new Error("Cannot read monitor allowance");
  const watched = existsSync(MONITORS) ? read(MONITORS) : { schedule: "every 7 days", detection: "exact", monitors: [] };
  const state = read(STATE);
  const candidates = state.reads.filter((entry) => entry.status === "ok" && !ambiguousSites.has(entry.pub.website)).map((summary) => {
    const entry = read(pageFile(summary.url));
    const facts = readPubWhatsOn(entry.pub, entry.result.markdown, entry.result.url, entry.observedAt, new Date().toISOString());
    return { entry, score: facts.rows.length * 10 + Number(Boolean(facts.hours)) };
  }).filter((candidate) => candidate.score > 0).sort((a, b) => b.score - a.score);
  const capacity = Math.min(MONITOR_BASELINES - watched.monitors.length, limits.limit - limits.used);
  let created = 0;
  for (const { entry } of candidates) {
    if (created >= capacity) break;
    if (watched.monitors.some((item) => item.pub.osmId === entry.pub.osmId)) continue;
    if ((await usage()).creditsRemaining <= RESERVE) break;
    const url = entry.result.url;
    const result = await createPageMonitor(url, `PUBMAXX What's On: ${entry.pub.name}`, { robots, maxAttempts: 1, budget: createContextDevBudget(1) });
    if (result.status !== "ok") throw new Error(`Monitor creation failed: ${result.status === "error" ? result.error.code : result.status}`);
    const record = { pub: entry.pub, url, cacheUrl: entry.url, id: result.id, initialRunId: result.initialRunId, createdAt: new Date().toISOString(), seenChangeIds: [], baselineStatus: "queued" };
    watched.monitors.push(record);
    write(MONITORS, watched);
    created += 1;
    // Baseline capture finishes before another paid operation starts.
    for (let poll = 0; record.initialRunId && poll < 60; poll += 1) {
      const outcome = await pageMonitorRun(url, record.id, record.initialRunId, { robots, maxAttempts: 1 });
      if (outcome.status !== "ok") throw new Error("Cannot read monitor baseline status");
      record.baselineStatus = outcome.runStatus;
      write(MONITORS, watched);
      if (["completed", "failed", "skipped"].includes(outcome.runStatus)) break;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    if (record.baselineStatus !== "completed") throw new Error(`Monitor baseline did not complete: ${record.id} ${record.baselineStatus}`);
    console.log(JSON.stringify({ monitor: entry.pub.name, baseline: record.baselineStatus }));
  }
  state.creditsAfter = (await usage()).creditsRemaining;
  write(STATE, state);
}

async function refresh() {
  const watched = read(MONITORS);
  const state = read(STATE);
  for (const record of watched.monitors) {
    const available = (await usage()).creditsRemaining - RESERVE;
    if (available <= 0) break;
    const result = await refreshChangedPage(record.url, record.id, record.seenChangeIds, { robots, maxAttempts: 2, budget: createContextDevBudget(Math.min(2, available)) });
    if (result.status === "unchanged") { console.log(JSON.stringify({ name: record.pub.name, status: "unchanged" })); continue; }
    if (result.status !== "ok") throw new Error(`Monitor refresh failed: ${result.status === "error" ? result.error.code : result.status}`);
    if (!isPubPage(result.url, record.pub.website) || !(await robots(result.url)).allowed) throw new Error("Monitor page left its permitted pub scope");
    const previous = read(pageFile(record.cacheUrl));
    write(pageFile(record.cacheUrl), { ...previous, observedAt: result.observedAt, result: { status: "ok", url: result.url, markdown: result.markdown } });
    const summary = state.reads.find((entry) => entry.url === record.cacheUrl);
    summary.observedAt = result.observedAt;
    record.seenChangeIds.push(...result.changeIds);
    write(STATE, state);
    write(MONITORS, watched);
    console.log(JSON.stringify({ name: record.pub.name, status: "changed", observedAt: result.observedAt }));
  }
  state.creditsAfter = (await usage()).creditsRemaining;
  write(STATE, state);
}

function publish() {
  const state = read(STATE);
  const rows = new Map();
  const hoursByPub = new Map();
  const conflictedHours = new Set();
  const listings = [];
  const observations = [];
  for (const summary of state.reads) {
    const entry = read(pageFile(summary.url));
    if (entry.result.status !== "ok") { observations.push(summary); continue; }
    if (ambiguousSites.has(entry.pub.website)) { observations.push({ ...summary, reason: "AMBIGUOUS_SHARED_SITE", published: false }); continue; }
    const facts = readPubWhatsOn(entry.pub, entry.result.markdown, entry.result.url, entry.observedAt, new Date().toISOString());
    listings.push({ sourceUrl: entry.result.url, rows: facts.rows, complete: facts.drops.length === 0 });
    for (const row of facts.rows) rows.set(row.id, row);
    if (facts.hours && entry.pub.venueId && !conflictedHours.has(entry.pub.osmId)) {
      const held = hoursByPub.get(entry.pub.osmId);
      const conflict = held && Object.entries(facts.hours.hours).some(([day, windows]) => held.hours.hours[day] && JSON.stringify(held.hours.hours[day]) !== JSON.stringify(windows));
      if (conflict) { hoursByPub.delete(entry.pub.osmId); conflictedHours.add(entry.pub.osmId); }
      else if (!held || facts.hours.statedDays.length > held.hours.statedDays.length)
        hoursByPub.set(entry.pub.osmId, { osmId: entry.pub.osmId, name: entry.pub.name, venueId: entry.pub.venueId, sourceUrl: entry.result.url, readOn: entry.observedAt.slice(0, 10), hours: facts.hours });
    }
    observations.push({ ...summary, finalUrl: entry.result.url, contentSha256: createHash("sha256").update(entry.result.markdown).digest("hex"), events: facts.rows.filter((row) => row.kind !== "deal").length, happyHours: facts.rows.filter((row) => row.kind === "deal").length, openingHours: Boolean(facts.hours), drops: facts.drops });
  }
  const whatsOnPath = path.join(ROOT, "public/data/whats_on/events_london.json");
  const held = read(whatsOnPath);
  const previous = Array.isArray(held) ? held : held.rows;
  const newRows = [...rows.values()];
  const merged = mergeOwnSiteListings(previous, listings);
  const generatedAt = [held.generatedAt, ...merged.map((row) => row.observedAt)].filter(Boolean).sort().at(-1);
  write(whatsOnPath, { ...(Array.isArray(held) ? { version: 1 } : held), generatedAt, rows: merged });
  const hoursPath = path.join(ROOT, "data/amenities/london_pub_website_hours_dogs.json");
  const hoursDoc = read(hoursPath);
  for (const fact of hoursByPub.values()) {
    const index = hoursDoc.rows.findIndex((row) => row.osmId === fact.osmId || row.venueId === fact.venueId);
    const previous = hoursDoc.rows[index];
    if (previous?.readOn > fact.readOn) continue;
    // Dogs and hours share one source/date. A new hours read cannot restamp a held dog fact.
    if (previous?.dogs) continue;
    if (index < 0) hoursDoc.rows.push(fact);
    else hoursDoc.rows[index] = { ...previous, ...fact };
  }
  hoursDoc.counts = { rows: hoursDoc.rows.length, dogsWelcome: hoursDoc.rows.filter((row) => row.dogs?.policy === "welcome").length, dogsNotAllowed: hoursDoc.rows.filter((row) => row.dogs?.policy === "not-allowed").length, hours: hoursDoc.rows.filter((row) => row.hours).length, withVenueId: hoursDoc.rows.filter((row) => row.venueId).length };
  write(hoursPath, hoursDoc);
  const report = { assembledAt: new Date().toISOString(), creditsAtStart: read(PLAN).creditsAtStart, creditsUsed: read(PLAN).creditsAtStart - state.creditsAfter, creditsLeft: state.creditsAfter, venuesRead: new Set(state.reads.filter((row) => row.status === "ok").map((row) => row.pub.osmId)).size, pagesRead: state.reads.filter((row) => row.status === "ok").length, eventsPublished: newRows.filter((row) => row.kind !== "deal").length, happyHoursPublished: newRows.filter((row) => row.kind === "deal").length, hoursPublished: [...hoursByPub.values()].filter((row) => hoursDoc.rows.some((published) => JSON.stringify(published.hours) === JSON.stringify(row.hours) && published.venueId === row.venueId && published.readOn === row.readOn)).length, conflictingHoursPages: [...conflictedHours], monitors: existsSync(MONITORS) ? read(MONITORS).monitors.length : 0, remainingCandidates: state.pending.length, observations };
  write(path.join(REPORT, "report.json"), report);
  console.log(JSON.stringify({ ...report, observations: undefined }));
}

async function main() {
  mkdirSync(CACHE, { recursive: true });
  mkdirSync(REPORT, { recursive: true });
  const args = process.argv.slice(2);
  if (args.includes("--plan")) {
    const document = plan((await usage()).creditsRemaining);
    console.log(JSON.stringify({ venues: document.candidates.length, knownEventsPages: document.knownEventsPages, estimatedPages: document.estimatedPages, monitorBaselines: MONITOR_BASELINES, reserve: RESERVE }));
  }
  if (args.includes("--read")) {
    const limit = Number(args.find((arg) => arg.startsWith("--limit="))?.slice(8) ?? 950);
    if (!Number.isInteger(limit) || limit <= 0) throw new Error("--limit must be a positive integer");
    await harvest(limit);
  }
  if (args.includes("--monitor")) await monitor();
  if (args.includes("--refresh")) await refresh();
  if (args.includes("--publish")) publish();
  if (!args.some((arg) => ["--plan", "--read", "--publish", "--monitor", "--refresh"].includes(arg))) throw new Error("Choose --plan, --read, --publish, --monitor or --refresh");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
