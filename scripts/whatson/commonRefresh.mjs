// scripts/whatson/commonRefresh.mjs
//
// Common linked-card reader. robots.txt allows the sitemap. We fetch each
// /post/* page for og:title + og:description ONLY, then derive place + date
// from the OG prefix ("<place> · <date> - ..."). The description text and
// any names inside it are never stored or rendered. Captain 2026-08-16:
// Common cards = facts only + link out.
//
// Rows join public/data/whats_on/events_london.json under source "common".
// Polite: 1 request per second, UA names PUBMAXX and the public contact.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { eventsOutputPath, toIsoInstant } from "./eventsRefresh.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export const COMMON_SITEMAP_URL = "https://www.common-social.com/sitemap.xml";
export const COMMON_SOURCE = {
  label: "common",
  url: "https://www.common-social.com/",
};
export const COMMON_USER_AGENT =
  "PUBMAXX/1 (+https://pubmaxxing.com; contact karanszdy@gmail.com)";
export const COMMON_FETCH_GAP_MS = 1000;

const MONTHS = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function stableId(prefix, input) {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${prefix}-${(hash >>> 0).toString(36)}`;
}

export function parseCommonOgPrefix(text) {
  if (!nonEmptyString(text)) return null;
  const parts = text
    .split("·")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 2) return null;
  const placeName = parts[0];
  const dateText = parts[1].split(/\s+[\u2014\u2013-]\s+/)[0].trim();
  if (!nonEmptyString(placeName) || !nonEmptyString(dateText)) return null;
  return { placeName, dateText };
}

function metaContent(html, property) {
  const propertyRe = new RegExp(
    `<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']*)["']`,
    "i",
  );
  const contentFirst = new RegExp(
    `<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${property}["']`,
    "i",
  );
  return propertyRe.exec(html)?.[1] ?? contentFirst.exec(html)?.[1] ?? null;
}

export function parseCommonPostHtml(html) {
  if (!nonEmptyString(html)) return null;
  const title = metaContent(html, "og:title")?.trim();
  const description = metaContent(html, "og:description");
  const prefix = parseCommonOgPrefix(description ?? "");
  if (!nonEmptyString(title) || !prefix) return null;
  return { title, placeName: prefix.placeName, dateText: prefix.dateText };
}

export function parseCommonSitemap(xml) {
  if (!nonEmptyString(xml)) return [];
  const locs = [];
  const re = /<loc>\s*([^<]+)\s*<\/loc>/gi;
  let match;
  while ((match = re.exec(xml))) {
    const loc = match[1].trim();
    try {
      const url = new URL(loc);
      if (url.hostname === "www.common-social.com" && url.pathname.startsWith("/post/")) {
        locs.push(url.toString());
      }
    } catch {
      // skip a malformed loc
    }
  }
  return [...new Set(locs)];
}

function parseDayMonth(dateText, year) {
  const match = /^(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i.exec(
    dateText.trim(),
  );
  if (!match) return null;
  const month = MONTHS[match[2].slice(0, 3).toLowerCase()];
  const day = Number(match[1]);
  if (month === undefined || !Number.isFinite(day)) return null;
  return { year, month, day };
}

export function isStaleCommonDate(dateText, todayLondon) {
  const [yearText, monthText, dayText] = todayLondon.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const parsed = parseDayMonth(dateText, year);
  if (!parsed) return true;
  const dateMs = Date.UTC(parsed.year, parsed.month, parsed.day);
  const todayMs = Date.UTC(year, month - 1, day);
  return dateMs < todayMs;
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function startsAtFromDateText(dateText, todayLondon) {
  const year = Number(todayLondon.slice(0, 4));
  const parsed = parseDayMonth(dateText, year);
  if (!parsed) return null;
  const wall = `${parsed.year}-${pad2(parsed.month + 1)}-${pad2(parsed.day)} 20:00:00`;
  return toIsoInstant(wall);
}

function sourceIdFromUrl(url) {
  try {
    const path = new URL(url).pathname.replace(/\/+$/, "");
    const slug = path.split("/").filter(Boolean).pop();
    return nonEmptyString(slug) ? slug : url;
  } catch {
    return url;
  }
}

export function toCommonEventRow({ url, parsed, observedAt, todayLondon }) {
  if (!parsed || !nonEmptyString(url) || !nonEmptyString(parsed.title)) return null;
  if (isStaleCommonDate(parsed.dateText, todayLondon)) return null;
  const startsAt = startsAtFromDateText(parsed.dateText, todayLondon);
  if (!startsAt) return null;
  return {
    id: stableId("events-cm", url),
    placeName: parsed.placeName,
    kind: "event",
    startsAt,
    title: parsed.title,
    source: { label: COMMON_SOURCE.label, url },
    observedAt,
    confidence: "listed",
    sourceId: sourceIdFromUrl(url),
  };
}

function londonToday(nowMs = Date.now()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(nowMs));
  const get = (type) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function serialiseFile(payload) {
  const meta = JSON.stringify({ ...payload, rows: undefined }, null, 2)
    .replace(/\n\}$/, "")
    .replace(/\s*"rows": undefined,?/, "");
  const rowLines = payload.rows.map((row) => `    ${JSON.stringify(row)}`).join(",\n");
  return payload.rows.length
    ? `${meta},\n  "rows": [\n${rowLines}\n  ]\n}\n`
    : `${meta},\n  "rows": []\n}\n`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchText(url, fetchImpl) {
  const res = await fetchImpl(url, {
    headers: {
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "user-agent": COMMON_USER_AGENT,
    },
  });
  if (!res.ok) {
    await res.arrayBuffer();
    throw new Error(`Common fetch ${url} returned ${res.status}`);
  }
  return res.text();
}

export async function refreshCommonEvents({
  nowMs = Date.now(),
  fetchImpl = fetch,
  outPath = eventsOutputPath("london"),
  gapMs = COMMON_FETCH_GAP_MS,
} = {}) {
  const observedAt = new Date(nowMs).toISOString();
  const todayLondon = londonToday(nowMs);
  const sitemap = await fetchText(COMMON_SITEMAP_URL, fetchImpl);
  const posts = parseCommonSitemap(sitemap);
  const rows = [];
  let droppedStale = 0;
  let droppedUnparseable = 0;
  let droppedFetch = 0;

  for (let i = 0; i < posts.length; i += 1) {
    if (i > 0 && gapMs > 0) await sleep(gapMs);
    const url = posts[i];
    try {
      const html = await fetchText(url, fetchImpl);
      const parsed = parseCommonPostHtml(html);
      if (!parsed) {
        droppedUnparseable += 1;
        continue;
      }
      const row = toCommonEventRow({ url, parsed, observedAt, todayLondon });
      if (!row) {
        droppedStale += 1;
        continue;
      }
      rows.push(row);
    } catch {
      droppedFetch += 1;
    }
  }

  let existing = { generatedAt: observedAt, kind: "events", region: "greater-london", sources: [], rows: [] };
  if (existsSync(outPath)) {
    try {
      existing = JSON.parse(readFileSync(outPath, "utf8"));
    } catch {
      // keep the empty shell
    }
  }
  const kept = (Array.isArray(existing.rows) ? existing.rows : []).filter(
    (row) => row?.source?.label?.toLowerCase() !== "common",
  );
  const merged = [...kept, ...rows];
  const sources = Array.isArray(existing.sources) ? existing.sources.filter((s) => s?.provider !== "common") : [];
  sources.push({
    ...COMMON_SOURCE,
    firstParty: false,
    provider: "common",
    rowsEmitted: rows.length,
    notes:
      "Common sitemap + OG prefix only. Place and date from the prefix; description text is never stored.",
  });
  const payload = {
    ...existing,
    generatedAt: existing.generatedAt ?? observedAt,
    kind: existing.kind ?? "events",
    region: existing.region ?? "greater-london",
    sources,
    rows: merged,
  };
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, serialiseFile(payload));
  console.log(
    `commonRefresh: wrote ${rows.length} common rows into ${outPath} ` +
      `(kept ${kept.length} other; dropped stale=${droppedStale} unparseable=${droppedUnparseable} fetch=${droppedFetch})`,
  );
  return { rows, droppedStale, droppedUnparseable, droppedFetch };
}

async function main() {
  try {
    await refreshCommonEvents();
  } catch (err) {
    console.error(`commonRefresh: failed (${err.message}). Leaving events_london.json untouched.`);
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
void ROOT;
