#!/usr/bin/env node
/**
 * Reddit London drink-price harvest lane.
 *
 *   node --conditions=react-server --import tsx scripts/harvest_reddit_london_prices.mjs
 *   node --conditions=react-server --import tsx scripts/harvest_reddit_london_prices.mjs --from-fixture
 *   node --conditions=react-server --import tsx scripts/harvest_reddit_london_prices.mjs --dry-run --limit 5
 *
 * Keys (subshell only): TAVILY_API_KEY, TYPESAFE_API_KEY from keys.env
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { PAID_SPEND_DEFAULT_DAILY_BUDGET } from "../lib/paidSpendBudget.ts";
import {
  commentsFromRedditThreadPayload,
  extractRedditPriceCandidates,
  redditObservedAt,
} from "../lib/harvest/redditPriceExtract.ts";
import { redditDecisionFromJudgment } from "../lib/harvest/redditPriceJudgmentPolicy.ts";
import { judgeRedditPriceCandidate } from "../lib/harvest/redditPriceJudgment.server.ts";
import { matchPubNameToVenue } from "./lib/redditVenueMatch.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const USER_AGENT = "PubMaxxing/1.0 (contact: hello@pubmaxxing.com; see README)";
const SLIM = join(ROOT, "public/data/venues_slim.json");
const SEED_OUT = join(ROOT, "data/community_price_observations/london_reddit.json");
const REVIEW_OUT = join(ROOT, "data/review/reddit_london_prices_review.jsonl");
const REPORT_OUT = join(ROOT, "data/review/reddit_london_prices_report.json");
const FIXTURE = join(ROOT, "__tests__/fixtures/reddit/london_pint_thread.json");

const TAVILY_BUDGET = Math.min(120, PAID_SPEND_DEFAULT_DAILY_BUDGET.typesafe);
const TYPESAFE_BUDGET = PAID_SPEND_DEFAULT_DAILY_BUDGET.typesafe;

const QUERIES = [
  "site:reddit.com/r/london pint price £",
  "site:reddit.com/r/londonpubs pint £ London",
  "site:reddit.com/r/CasualUK pint London £",
  "site:reddit.com/r/AskUK how much is a pint in London",
  "site:reddit.com/r/beer London pint price 2026",
  "site:reddit.com/r/ukdrinking London pub prices",
  "cocktail prices London reddit £",
  "gin and tonic price pub London reddit",
  "Guinness price London 2026 reddit",
  "£ pint Camden reddit",
  "£ pint Shoreditch reddit",
  "£ pint Brixton reddit",
  "how much is a pint in Westminster reddit",
];

function flag(name) {
  return process.argv.includes(name);
}

function loadVenues() {
  const payload = JSON.parse(readFileSync(SLIM, "utf8"));
  return Array.isArray(payload?.rows) ? payload.rows : [];
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function redditJsonUrl(url) {
  const trimmed = String(url ?? "").replace(/\/$/, "");
  if (trimmed.endsWith(".json")) return trimmed;
  return `${trimmed}.json`;
}

async function fetchRedditJson(url) {
  const jsonUrl = redditJsonUrl(url);
  await sleep(2000);
  const res = await fetch(jsonUrl, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    redirect: "follow",
  });
  if (res.status === 429) throw new Error("reddit-429");
  if (!res.ok) return null;
  const text = await res.text();
  if (!text.trim().startsWith("{") && !text.trim().startsWith("[")) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function tavilySearch(query, spend) {
  if (!process.env.TAVILY_API_KEY?.trim() || !spend.tavily()) return [];
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: process.env.TAVILY_API_KEY,
      query,
      max_results: 5,
      include_domains: ["reddit.com"],
      include_raw_content: false,
    }),
  });
  if (!res.ok) return [];
  const body = await res.json();
  return (body.results ?? [])
    .filter((r) => r?.url)
    .map((r) => ({
      url: r.url,
      content: [r.title, r.content].filter(Boolean).join("\n"),
    }));
}

/** When Reddit blocks thread JSON, Tavily snippets may still carry verbatim £ claims. */
async function processTavilyHit(hit, venues, state, spend) {
  const body = String(hit.content ?? "").trim();
  if (body.length < 12) return;
  const permalink = hit.url.startsWith("http") ? hit.url : `https://www.reddit.com${hit.url}`;
  const pseudo = {
    body,
    permalink,
    observedAt: new Date().toISOString(),
    author: "tavily-snippet",
  };
  await processComments([pseudo], venues, state, spend);
}

async function processComments(comments, venues, state, spend) {
  for (const c of comments) {
    state.threadsScanned += 1;
    const candidates = extractRedditPriceCandidates({
      body: c.body ?? "",
      permalink: c.permalink ?? "",
      observedAt: c.observedAt ?? redditObservedAt(c.created_utc ?? 0),
      author: c.author ?? "anon",
    });
    state.candidates += candidates.length;
    for (const row of candidates) {
      let judgment = null;
      if (process.env.TYPESAFE_API_KEY?.trim() && spend.typesafe()) {
        judgment = await judgeRedditPriceCandidate({
          snippet: row.snippet,
          priceText: row.priceText ?? `£${row.priceGbp.toFixed(2)}`,
          permalink: row.permalink,
          pubNameHint: row.pubNameHint,
        });
      }
      if (!judgment) {
        const { keylessRedditJudgment } = await import("../lib/harvest/redditPriceJudgmentPolicy.ts");
        judgment = keylessRedditJudgment(row.snippet);
      }
      const decision = redditDecisionFromJudgment(judgment, row.priceGbp);
      if (decision.outcome === "review") {
        state.review.push({ ...row, decision });
        continue;
      }
      if (decision.outcome !== "publish" || !decision.drinkCategory) {
        state.rejected += 1;
        continue;
      }
      state.passing += 1;
      const match = matchPubNameToVenue(row.pubNameHint, row.areaHint, venues);
      if (!match) {
        state.review.push({ ...row, reason: "unmatched-venue", pubName: row.pubNameHint });
        continue;
      }
      state.landed.push({
        venueId: match.venueId,
        drinkCategory: decision.drinkCategory,
        drinkName: row.drinkText,
        priceGbp: row.priceGbp,
        observedAt: row.observedAt,
        source: "reddit",
        sourceUrl: row.permalink,
        confidence: decision.confidence,
        pubNameHint: row.pubNameHint ?? undefined,
      });
    }
  }
}

async function main() {
  const dryRun = flag("--dry-run");
  const fromFixture = flag("--from-fixture");
  const limit = Number(process.argv[process.argv.indexOf("--limit") + 1]) || QUERIES.length;
  const venues = loadVenues();
  const state = {
    threadsScanned: 0,
    candidates: 0,
    passing: 0,
    rejected: 0,
    landed: [],
    review: [],
    queries: QUERIES.slice(0, limit),
    spend: { tavily: 0, typesafe: 0 },
  };
  const spend = {
    tavily: () => state.spend.tavily++ < TAVILY_BUDGET,
    typesafe: () => state.spend.typesafe++ < TYPESAFE_BUDGET,
  };

  if (fromFixture) {
    const payload = JSON.parse(readFileSync(FIXTURE, "utf8"));
    await processComments(commentsFromRedditThreadPayload(payload), venues, state, spend);
  } else {
    const subredditListings = [
      "https://www.reddit.com/r/london/search.json?q=pint+price&restrict_sr=on&sort=relevance&t=year&limit=25",
      "https://www.reddit.com/r/londonpubs/search.json?q=pint+%C2%A3&restrict_sr=on&sort=relevance&t=year&limit=25",
      "https://www.reddit.com/r/CasualUK/search.json?q=pint+London+%C2%A3&restrict_sr=on&sort=relevance&t=year&limit=25",
    ];
    for (const listingUrl of subredditListings) {
      try {
        const payload = await fetchRedditJson(listingUrl);
        const posts = payload?.data?.children ?? [];
        for (const child of posts) {
          const link = child?.data?.permalink;
          if (!link) continue;
          const threadUrl = `https://www.reddit.com${link}`;
          const threadPayload = await fetchRedditJson(threadUrl);
          if (threadPayload) {
            await processComments(commentsFromRedditThreadPayload(threadPayload), venues, state, spend);
          }
        }
      } catch (e) {
        if (String(e).includes("429")) {
          console.error("Reddit 429 on listing - pausing ten minutes");
          await sleep(10 * 60 * 1000);
        }
      }
    }

    for (const q of state.queries) {
      const hits = await tavilySearch(q, spend);
      for (const hit of hits) {
        try {
          const payload = await fetchRedditJson(hit.url);
          if (payload) {
            await processComments(commentsFromRedditThreadPayload(payload), venues, state, spend);
          } else {
            await processTavilyHit(hit, venues, state, spend);
          }
        } catch (e) {
          if (String(e).includes("429")) {
            console.error("Reddit 429 - stopping for ten minutes");
            await sleep(10 * 60 * 1000);
          }
        }
      }
    }
  }

  const pack = {
    version: 1,
    generatedAt: new Date().toISOString(),
    lane: "reddit-london",
    observations: state.landed,
  };

  const report = {
    generatedAt: pack.generatedAt,
    threadsScanned: state.threadsScanned,
    candidates: state.candidates,
    passing: state.passing,
    landed: state.landed.length,
    rejected: state.rejected,
    reviewCount: state.review.length,
    queries: state.queries,
    spend: state.spend,
    byCategory: Object.fromEntries(
      [...new Set(state.landed.map((r) => r.drinkCategory))].map((c) => [
        c,
        state.landed.filter((r) => r.drinkCategory === c).length,
      ]),
    ),
  };

  mkdirSync(dirname(REVIEW_OUT), { recursive: true });
  if (!dryRun) {
    writeFileSync(SEED_OUT, JSON.stringify(pack, null, 2) + "\n");
    writeFileSync(REVIEW_OUT, state.review.map((r) => JSON.stringify(r)).join("\n") + (state.review.length ? "\n" : ""));
  }
  writeFileSync(REPORT_OUT, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
