// Enrich data/area_news.json with venueMatch links, conservatively.
//
// News facts have no coordinates, so we can't do heritageMatch-style spatial
// matching. Instead we hand-list the facts whose named pub we BELIEVE is in our
// venue dataset (MATCH_TARGETS: fact id -> { name, borough }), then let the pure
// matcher (scripts/lib/areaNewsMatch.mjs) decide against the live slim index. A
// target only earns a venueMatch when the name resolves to exactly one venue in
// that borough; anything ambiguous is silently dropped. Re-run after the venue
// dataset changes:  node scripts/build_area_news_matches.mjs
//
// Deterministic and reviewable: the match rule lives in one tested module, and
// the diff to area_news.json shows exactly which facts gained a badge.
//
// Judged pass (requires TYPESAFE_API_KEY):
//   node --import tsx scripts/build_area_news_matches.mjs --judged

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { matchVenue, slugifyBorough } from "./lib/areaNewsMatch.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATASET = join(ROOT, "data", "area_news.json");
const SLIM = join(ROOT, "public", "data", "venues_slim.json");

// Facts whose named pub we expect to exist in the London venue dataset. Borough
// is the display name (slugified before matching). Only these are considered;
// everything else stays unmatched by design (an opening/closure of a venue we
// don't yet map should not borrow a same-name pin elsewhere).
const MATCH_TARGETS = {
  "the-george-fitzrovia-best-pub-london": { name: "The George", borough: "Westminster" },
  "punch-bowl-mayfair-destination-pub": { name: "The Punch Bowl", borough: "Westminster" },
  "the-devonshire-soho-guinness": { name: "The Devonshire", borough: "Westminster" },
  "leyton-engineer-camra-award": { name: "The Leyton Engineer", borough: "Waltham Forest" },
  "camberwell-arms-gastropub-award": { name: "The Camberwell Arms", borough: "Southwark" },
  "lord-southampton-design-award": { name: "The Lord Southampton", borough: "Camden" },
  "windsor-castle-finchley-best-licensees": { name: "The Windsor Castle", borough: "Barnet" },
  "black-horse-barnet-reopen": { name: "The Black Horse", borough: "Barnet" },
  "the-queens-crouch-end-refurb": { name: "The Queens", borough: "Haringey" },
  "mary-wollstonecraft-opening": { name: "The Mary Wollstonecraft", borough: "Hackney" },
  "the-mitre-penge-demolition": { name: "The Mitre", borough: "Bromley" },
  "the-alliance-west-hampstead-campaign": { name: "The Alliance", borough: "Camden" },
  "the-grapes-limehouse": { name: "The Grapes", borough: "Tower Hamlets" },
};

async function matchOne(target, venues, judged) {
  const boroughSlug = slugifyBorough(target.borough);
  if (!judged) {
    return { result: matchVenue(target.name, boroughSlug, venues), review: [] };
  }
  const { typesafeConfigured, requiresTypesafeKeyMessage } = await import(
    "../lib/samePubIdentity.ts"
  );
  const { judgedMatchVenue } = await import("./lib/areaNewsJudgedMatch.ts");
  if (!typesafeConfigured()) {
    throw new Error(requiresTypesafeKeyMessage());
  }
  const judgedResult = await judgedMatchVenue(target.name, boroughSlug, venues);
  return {
    result: judgedResult.venueId
      ? { venueId: judgedResult.venueId, confidence: judgedResult.confidence }
      : null,
    review: judgedResult.review,
  };
}

async function main() {
  const judged = process.argv.includes("--judged");
  const dataset = JSON.parse(readFileSync(DATASET, "utf8"));
  const payload = JSON.parse(readFileSync(SLIM, "utf8"));
  const venues = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.rows)
      ? payload.rows
      : [];
  const byId = new Map(dataset.entries.map((e) => [e.id, e]));

  let matched = 0;
  const report = [];
  const review = [];
  for (const [id, target] of Object.entries(MATCH_TARGETS)) {
    const entry = byId.get(id);
    if (!entry) {
      report.push(`  SKIP  ${id} (no such entry)`);
      continue;
    }
    const { result, review: rows } = await matchOne(target, venues, judged);
    review.push(...rows);
    if (result) {
      entry.venueMatch = result;
      matched += 1;
      const v = venues.find((x) => x.id === result.venueId);
      report.push(`  MATCH ${id} -> ${result.venueId} (${result.confidence}) ${v ? v.name : ""}`);
    } else {
      if (entry.venueMatch) delete entry.venueMatch;
      report.push(`  miss  ${id} ("${target.name}", ${target.borough})`);
    }
  }

  if (judged) {
    const { writeSamePubReviewFile } = await import("./lib/samePubJudgedCanonicalize.ts");
    const reviewPath = await writeSamePubReviewFile(
      review,
      ROOT,
      "data/review/area-news-review.json",
      "Area-news venue pairs in the uncertain band between the refuse and merge thresholds. Never auto-merged.",
    );
    console.log(`area-news: judged pass wrote ${review.length} review-band pair(s) to ${reviewPath}`);
  }

  writeFileSync(DATASET, JSON.stringify(dataset, null, 2) + "\n");
  console.log(report.join("\n"));
  console.log(`\nvenueMatch written: ${matched} of ${Object.keys(MATCH_TARGETS).length} targets, ${dataset.entries.length} entries total.`);
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
