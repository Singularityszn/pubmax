#!/usr/bin/env node
// Run the Context.dev price reader over the hosts the served lane could not read.
//
//   PUBMAX_UK_PRICES_CONTEXT_DEV=1 npx tsx scripts/harvest/uk-prices/context-dev-batch.mjs --budget 240
//   ... --dry-run          # print the plan and spend nothing
//
// WHICH HOSTS. The ledger the served lane writes names every host and what it
// answered. A host that answered `no-menu-page-found`, or `menu-states-no-price`
// with no drop but "no-price-on-page", may be a page whose prices exist only
// after its own script runs. Those are the hosts worth one rendered read. A
// refusal, an unreachable host and a host the rendered lane owns are not.
//
// WHAT STAYS THE SAME. context-dev.mjs still gates every URL on the source
// table and a live robots ask before a credit is spent, and its rows pass the
// SAME lib/harvest/ukPriceCrawl.ts rules. This file only chooses hosts, bounds
// the spend, and writes rows and the ledger the way run.mjs does.
//
// SPEND STOPS CLEANLY. One page is one credit. The run stops at --budget, and
// stops early when the account itself says it is out (a 402, or a 429 or error
// code naming credits or quota), so the last host is not retried into a ban.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { contextDevPriceLaneEnabled, createContextDevPriceReader } from "./context-dev.mjs";

const ROOT = process.cwd();
const LEDGER_PATH = path.join(ROOT, "data-harvest/uk_prices/hosts.json");
const RENDERED_REPORT = path.join(ROOT, "data/uk_prices/rendered_report.json");

/** Ledger outcomes whose page may simply not have rendered for the served reader. */
const UNREAD_OUTCOMES = new Set(["no-menu-page-found", "menu-states-no-price"]);

/**
 * Hosts worth a rendered read, most pubs first.
 *
 * `menu-states-no-price` counts only when every drop was a page with no price
 * on it: a host whose pages DID state prices that the rules then dropped was
 * read fine and a second reader would drop them again.
 */
export function selectUnreadHosts(ledger, { skipHosts = [] } = {}) {
  const skip = new Set(skipHosts);
  return Object.entries(ledger.hosts ?? {})
    .filter(([host, row]) => {
      if (skip.has(host) || row.contextDev) return false;
      if (!UNREAD_OUTCOMES.has(row.outcome)) return false;
      if (row.outcome === "no-menu-page-found") return true;
      return Object.keys(row.drops ?? {}).every((reason) => reason === "no-price-on-page");
    })
    .sort((a, b) => (b[1].pubs ?? 0) - (a[1].pubs ?? 0) || a[0].localeCompare(b[0]))
    .map(([host]) => host);
}

/** True when the answer says the ACCOUNT is out, not that one page failed. */
export function accountIsOut(answer) {
  if (answer.outcome !== "fetch-failed") return false;
  if (answer.statusCode === 402) return true;
  return /credit|quota|insufficient/i.test(`${answer.reason ?? ""} ${answer.evidence ?? ""}`);
}

const flag = (name) => process.argv.includes(name);
const option = (name, fallback) => {
  const at = process.argv.indexOf(name);
  const value = at >= 0 ? process.argv[at + 1] : undefined;
  return value && !value.startsWith("--") ? value : fallback;
};

async function main() {
  const dryRun = flag("--dry-run");
  const budget = Number(option("--budget", 240));
  if (!existsSync(LEDGER_PATH)) {
    console.error("no ledger at data-harvest/uk_prices/hosts.json; run npm run harvest:uk-prices -- --london first");
    process.exitCode = 1;
    return;
  }
  if (!dryRun && !contextDevPriceLaneEnabled()) {
    console.error("PUBMAX_UK_PRICES_CONTEXT_DEV=1 and CONTEXT_DEV_API_KEY are both needed; this lane stayed off.");
    process.exitCode = 2;
    return;
  }

  const { candidateHosts, appendPriceRows } = await import("./run.mjs");
  const ledger = JSON.parse(readFileSync(LEDGER_PATH, "utf8"));
  const rendered = existsSync(RENDERED_REPORT) ? JSON.parse(readFileSync(RENDERED_REPORT, "utf8")) : {};
  const byHost = new Map(candidateHosts({ londonOnly: true }).hosts.map((entry) => [entry.host, entry]));
  const hosts = selectUnreadHosts(ledger, { skipHosts: rendered.hostsPermitted ?? [] })
    .filter((host) => byHost.has(host))
    .slice(0, Number.isFinite(budget) ? budget : undefined);

  console.log(`context.dev lane: ${hosts.length} host(s) planned, ${hosts.length} credit(s) at one page each`);
  if (dryRun) return;

  const reader = createContextDevPriceReader({ pageBudget: budget });
  const outcomes = {};
  let pricedPubs = 0;
  let stoppedBecause = null;
  for (const host of hosts) {
    const entry = byHost.get(host);
    const answer = await reader.readPricesFrom(entry.pubs[0].website);
    if (accountIsOut(answer)) {
      stoppedBecause = `account out of credits (${answer.reason ?? answer.statusCode})`;
      break;
    }
    if (answer.reason === "BUDGET_EXHAUSTED") {
      stoppedBecause = "run budget reached";
      break;
    }
    outcomes[answer.outcome] = (outcomes[answer.outcome] ?? 0) + 1;
    if (answer.outcome === "priced") {
      appendPriceRows(
        entry,
        answer.rows.map((row) => ({ ...row, url: row.sourceUrl })),
      );
      pricedPubs += entry.pubs.length;
    }
    ledger.hosts[host] = {
      ...ledger.hosts[host],
      ...(answer.outcome === "priced" ? { outcome: "priced" } : {}),
      contextDev: { outcome: answer.outcome, checkedAt: new Date().toISOString() },
    };
    writeFileSync(LEDGER_PATH, `${JSON.stringify(ledger)}\n`);
  }

  console.log(JSON.stringify({ credits: reader.budget.spent(), outcomes, pubsOnPricedHosts: pricedPubs, stoppedBecause }));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
