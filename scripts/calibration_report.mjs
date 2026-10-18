#!/usr/bin/env node
// Calibration report for the TypeSafe (Jev) judgments a threshold acts on.
//
// A floor is only safe when the model is calibrated: its 0.8 answers must be
// right about 80 percent of the time. This joins the probabilities already
// recorded under __tests__/fixtures/typesafe/ with the right answer for each
// case, buckets them into ten confidence bins, and prints per decision: the
// count, mean confidence, actual accuracy and expected calibration error
// (ECE), then the lowest threshold whose cases above it are at least 95
// percent right, and the share of the recorded cases that would clear it.
//
//   node scripts/calibration_report.mjs            # writes docs/TYPESAFE_CALIBRATION_<today>.md
//   node scripts/calibration_report.mjs --stdout   # prints the report instead
//   node scripts/calibration_report.mjs --date 2026-10-18
//
// Offline: it reads committed recordings and calls no model. It changes no
// threshold; the report recommends, and the captain decides.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BIN_COUNT = 10;
const TARGET_ACCURACY = 0.95;
/** Fewer cases than this above a threshold is too few to move a floor on. */
const MIN_CASES_TO_ACT = 20;
const THRESHOLDS = Array.from({ length: BIN_COUNT }, (_, index) => index / BIN_COUNT);

function readJson(path) {
  return JSON.parse(readFileSync(join(ROOT, path), "utf8"));
}

/** The bin a probability falls in: [0, 0.1), [0.1, 0.2) ... [0.9, 1.0]. */
export function binIndex(probability) {
  return Math.min(Math.floor(probability * BIN_COUNT), BIN_COUNT - 1);
}

/**
 * Ten bins of `{ probability, correct }` rows. For a Choice, `probability` is
 * the chosen option's probability and `correct` whether that option was right.
 * For a yes/no Noul, `probability` is P(yes) and `correct` whether the answer
 * was yes, so `accuracy` is the observed rate of yes.
 */
export function calibrationBins(rows) {
  const bins = Array.from({ length: BIN_COUNT }, (_, index) => ({
    lower: index / BIN_COUNT,
    upper: (index + 1) / BIN_COUNT,
    count: 0,
    meanConfidence: null,
    accuracy: null,
  }));
  const sums = bins.map(() => ({ probability: 0, correct: 0 }));
  for (const row of rows) {
    const index = binIndex(row.probability);
    bins[index].count += 1;
    sums[index].probability += row.probability;
    sums[index].correct += row.correct ? 1 : 0;
  }
  for (const [index, bin] of bins.entries()) {
    if (bin.count === 0) continue;
    bin.meanConfidence = sums[index].probability / bin.count;
    bin.accuracy = sums[index].correct / bin.count;
  }
  return bins;
}

/** Expected calibration error: the count-weighted gap between confidence and accuracy. */
export function expectedCalibrationError(rows) {
  if (rows.length === 0) return null;
  let total = 0;
  for (const bin of calibrationBins(rows)) {
    if (bin.count === 0) continue;
    total += (bin.count / rows.length) * Math.abs(bin.accuracy - bin.meanConfidence);
  }
  return total;
}

/** Wilson score lower bound at 95 percent: how low the true accuracy could be at this sample size. */
export function wilsonLowerBound(successes, trials) {
  if (trials === 0) return null;
  const z = 1.96;
  const p = successes / trials;
  const denominator = 1 + (z * z) / trials;
  const centre = p + (z * z) / (2 * trials);
  const margin = z * Math.sqrt((p * (1 - p)) / trials + (z * z) / (4 * trials * trials));
  return (centre - margin) / denominator;
}

/**
 * For each threshold: the rows whose score clears it, how many of those are
 * right, and what share of all rows clears it. `recall` is the share of the
 * rows that should clear (`shouldClear`) that do, when the decision has one.
 */
export function thresholdTable(rows, thresholds = THRESHOLDS) {
  const positives = rows.filter((row) => row.shouldClear).length;
  return thresholds.map((threshold) => {
    const above = rows.filter((row) => row.score >= threshold);
    const right = above.filter((row) => row.correct).length;
    const caught = above.filter((row) => row.shouldClear).length;
    return {
      threshold,
      count: above.length,
      accuracy: above.length ? right / above.length : null,
      wilsonLower: wilsonLowerBound(right, above.length),
      share: rows.length ? above.length / rows.length : null,
      recall: positives ? caught / positives : null,
    };
  });
}

/** The lowest threshold whose cases above it are at least `target` right. */
export function recommendThreshold(table, target = TARGET_ACCURACY) {
  return table.find((row) => row.count > 0 && row.accuracy >= target) ?? null;
}

/** Whether a recommendation rests on enough cases to act on. */
export function enoughToAct(pick) {
  return Boolean(pick) && pick.count >= MIN_CASES_TO_ACT;
}

// ── The decisions ─────────────────────────────────────────────────────────

/** Expected tools by query: the router fixture's gold tool, plus the Pal answer key's alternates. */
function expectedToolsByQuery() {
  const expected = new Map();
  const router = readJson("__tests__/fixtures/typesafe/ask-router-cases.json");
  for (const row of router.cases) if (row.gold) expected.set(row.query, new Set([row.regexTool]));
  const cases = readJson("evals/pal/cases.public.json").cases;
  const key = readJson("evals/pal/answer-key.json").cases;
  for (const row of cases) {
    const tools = (key[row.id]?.expectedTools ?? []).filter(Boolean);
    if (tools.length === 0) continue;
    const set = expected.get(row.query) ?? new Set();
    for (const tool of tools) set.add(tool);
    expected.set(row.query, set);
  }
  return expected;
}

function askRouterDecisions() {
  const recorded = readJson("__tests__/fixtures/typesafe/ask-router-probabilities.json");
  const expected = expectedToolsByQuery();
  const rows = recorded.cases.filter((row) => expected.has(row.query));
  const toolRows = rows.map((row) => {
    const right = expected.get(row.query).has(row.tool);
    return {
      id: row.id,
      probability: row.toolProbability,
      correct: right,
      // The router publishes the judged tool only when probability AND
      // confidence clear the floor and the choice is not `none`.
      score: row.tool === "none" ? -1 : Math.min(row.toolProbability, row.toolConfidence),
    };
  });
  const mapRows = rows.map((row) => ({
    id: row.id,
    probability: row.wantsMap,
    correct: expected.get(row.query).has("propose_map_action"),
  }));
  return [
    {
      name: "Ask router: tool choice",
      kind: "choice",
      source: "`__tests__/fixtures/typesafe/ask-router-probabilities.json`, graded against the gold `regexTool` in `ask-router-cases.json` and the Pal answer key's `expectedTools`",
      code: "`ASK_ROUTER_TOOL_FLOOR` in `lib/ask/routerPolicy.ts`",
      current: recorded.toolFloor,
      scoreRule: "the lower of the chosen tool's probability and confidence (both must clear the floor); a `none` choice never publishes",
      model: recorded.model,
      recordedAt: recorded.recordedAt,
      caveat:
        "Every case here is one the regex router already routes right, so these rows cannot show what the floor exists to prevent: a judged tool overriding a right regex route on a new ask. Record cases the regex gets wrong before lowering it.",
      rows: toolRows,
      thresholdRows: toolRows.filter((row) => row.score >= 0),
      excluded: toolRows.filter((row) => row.score < 0).length,
    },
    {
      name: "Ask router: wantsMap",
      kind: "noul",
      source: "the same recording; truth is whether `propose_map_action` is an expected tool",
      code: "`ASK_ROUTER_WANTS_MAP_FLOOR` in `lib/ask/routerPolicy.ts` (confirmation only, never a veto)",
      current: null,
      model: recorded.model,
      recordedAt: recorded.recordedAt,
      rows: mapRows,
    },
  ];
}

function pubPalFenceDecisions() {
  const recorded = readJson("__tests__/fixtures/typesafe/pubPalFenceProbabilities.json");
  const threshold = 0.33;
  const fenceRows = recorded.cases.map((row) => {
    const score = Math.max(row.fitToTravelAfterDrinking, row.getHomeTonight);
    return {
      id: row.id,
      probability: score,
      score,
      shouldClear: row.expectFenced,
      // Above a threshold the fence fires, so a case there is right when it should fence.
      correct: row.expectFenced,
    };
  });
  // Per question, only where the labels settle it: a sobriety-only case is a
  // yes for fitness and a no for getting home, a fenced case that is not
  // sobriety-only is a yes for getting home, and an unfenced case is a no for both.
  const fitRows = recorded.cases
    .filter((row) => row.expectSobrietyOnly || !row.expectFenced)
    .map((row) => ({ id: row.id, probability: row.fitToTravelAfterDrinking, correct: row.expectSobrietyOnly }));
  const homeRows = recorded.cases.map((row) => ({
    id: row.id,
    probability: row.getHomeTonight,
    correct: row.expectFenced && !row.expectSobrietyOnly,
  }));
  return [
    {
      name: "Pub Pal fence: fires",
      kind: "noul",
      source: "`__tests__/fixtures/typesafe/pubPalFenceProbabilities.json`, graded against `expectFenced`",
      code: "`PUB_PAL_FENCE_NOUL_THRESHOLD` in `lib/pubPalLlmFence.ts`",
      current: threshold,
      scoreRule: "the higher of the two yes/no answers; a case that does not clear it falls through to the regex fence",
      harmNote: "A missed fence is the harm here, so read recall beside accuracy: below the threshold the regex is the only net.",
      model: recorded.model,
      recordedAt: recorded.recordedAt,
      rows: fenceRows,
      thresholdRows: fenceRows,
    },
    {
      name: "Pub Pal fence: fitToTravelAfterDrinking",
      kind: "noul",
      source: "the same recording, cases whose labels settle the question",
      code: "one half of the fence score",
      current: null,
      model: recorded.model,
      recordedAt: recorded.recordedAt,
      rows: fitRows,
    },
    {
      name: "Pub Pal fence: getHomeTonight",
      kind: "noul",
      source: "the same recording",
      code: "the other half of the fence score",
      current: null,
      model: recorded.model,
      recordedAt: recorded.recordedAt,
      rows: homeRows,
    },
  ];
}

function labelledNoulDecision({ name, path, label, code, current }) {
  const recorded = readJson(path);
  // Only a hand label is truth. A `keyless-heuristic` label is the old word
  // matcher's verdict, the thing the judgment replaced, so grading against it
  // would score TypeSafe on agreeing with the heuristic.
  const hand = recorded.cases.filter((row) => row.labelSource === "hand");
  const rows = hand.map((row) => ({
    id: row.id,
    probability: row.probability,
    score: row.probability,
    shouldClear: row[label],
    correct: row[label],
  }));
  return {
    name,
    kind: "noul",
    source: `\`${path}\`, graded against the hand label \`${label}\`${
      hand.length < recorded.cases.length
        ? `; ${recorded.cases.length - hand.length} rows labelled by the keyless heuristic are left out`
        : ""
    }`,
    code,
    current,
    model: recorded.model,
    recordedAt: recorded.recordedAt ?? "on a date the recording does not store",
    rows,
    thresholdRows: rows,
  };
}

export function loadDecisions() {
  return [
    ...askRouterDecisions(),
    ...pubPalFenceDecisions(),
    labelledNoulDecision({
      name: "Same pub: merge",
      path: "__tests__/fixtures/typesafe/same-pub-probabilities.json",
      label: "labelSame",
      code: "`SAME_PUB_MERGE_THRESHOLD` in `lib/samePubIdentity.ts`",
      current: 0.82,
    }),
    labelledNoulDecision({
      name: "Heritage listing: is the pub building",
      path: "__tests__/fixtures/typesafe/heritage-structure-probabilities.json",
      label: "labelListingIsPubBuilding",
      code: "`HERITAGE_STRUCTURE_ACCEPT_THRESHOLD` in `lib/heritageListingStructure.ts`",
      current: 0.8,
    }),
  ];
}

// ── The report ────────────────────────────────────────────────────────────

const pct = (value) => (value === null || value === undefined ? "n/a" : `${(value * 100).toFixed(0)}%`);
const num = (value) => (value === null || value === undefined ? "n/a" : value.toFixed(2));

function decisionSection(decision) {
  const lines = [`## ${decision.name}`, ""];
  lines.push(`- Data: ${decision.source}.`);
  lines.push(`- Model \`${decision.model}\`, recorded ${decision.recordedAt}. Cases: ${decision.rows.length}.`);
  lines.push(`- Threshold in code: ${decision.code}${decision.current === null ? "" : ` = ${decision.current}`}.`);
  if (decision.scoreRule) lines.push(`- Score compared with the threshold: ${decision.scoreRule}.`);
  const ece = expectedCalibrationError(decision.rows);
  lines.push(`- Expected calibration error: **${num(ece)}**.`);
  lines.push("");
  lines.push(
    decision.kind === "choice"
      ? "| Bin | Count | Mean confidence | Accuracy |"
      : "| Bin | Count | Mean P(yes) | Observed yes rate |",
  );
  lines.push("| --- | ---: | ---: | ---: |");
  for (const bin of calibrationBins(decision.rows)) {
    lines.push(`| ${bin.lower.toFixed(1)} to ${bin.upper.toFixed(1)} | ${bin.count} | ${num(bin.meanConfidence)} | ${pct(bin.accuracy)} |`);
  }
  lines.push("");
  if (!decision.thresholdRows) {
    lines.push("No threshold acts on this answer alone, so no threshold is recommended.", "");
    return lines.join("\n");
  }
  const table = thresholdTable(decision.thresholdRows);
  const hasRecall = decision.thresholdRows.some((row) => row.shouldClear !== undefined);
  lines.push(
    hasRecall
      ? "| Threshold | Cases at or above | Right | Wilson 95% low | Share clearing | Recall |"
      : "| Threshold | Cases at or above | Right | Wilson 95% low | Share clearing |",
  );
  lines.push(hasRecall ? "| ---: | ---: | ---: | ---: | ---: | ---: |" : "| ---: | ---: | ---: | ---: | ---: |");
  for (const row of table) {
    const cells = [row.threshold.toFixed(1), row.count, pct(row.accuracy), pct(row.wilsonLower), pct(row.share)];
    if (hasRecall) cells.push(pct(row.recall));
    lines.push(`| ${cells.join(" | ")} |`);
  }
  lines.push("");
  if (decision.excluded) lines.push(`${decision.excluded} case(s) chose \`none\` and never publish, so they are left out of this table.`, "");
  const pick = recommendThreshold(table);
  if (pick) {
    lines.push(
      `**Recommendation:** ${pick.threshold.toFixed(1)} is the lowest threshold whose cases at or above it are at least 95% right (${pct(pick.accuracy)} of ${pick.count}; ${pct(pick.share)} of the recorded cases clear it${hasRecall ? `, recall ${pct(pick.recall)}` : ""}). The Wilson lower bound is ${pct(pick.wilsonLower)}, so at this sample size the true accuracy could be that low.`,
    );
    if (!enoughToAct(pick)) {
      lines.push(
        "",
        `Only ${pick.count} cases clear it, fewer than the ${MIN_CASES_TO_ACT} this report asks for before a floor moves. Keep the current threshold and label more cases first.`,
      );
    }
  } else {
    lines.push("**Recommendation:** no threshold reaches 95% accuracy on these cases.");
  }
  if (decision.harmNote) lines.push("", decision.harmNote);
  if (decision.caveat) lines.push("", decision.caveat);
  lines.push("");
  return lines.join("\n");
}

export function renderReport(decisions, date) {
  const summary = decisions.map((decision) => {
    const pick = decision.thresholdRows ? recommendThreshold(thresholdTable(decision.thresholdRows)) : null;
    const recommended = !decision.thresholdRows
      ? "not thresholded"
      : !pick
        ? "none reaches 95%"
        : enoughToAct(pick)
          ? pick.threshold.toFixed(1)
          : `${pick.threshold.toFixed(1)} (too few cases)`;
    return `| ${decision.name} | ${decision.rows.length} | ${num(expectedCalibrationError(decision.rows))} | ${decision.current ?? "none"} | ${recommended} |`;
  });
  return [
    `# TypeSafe calibration report, ${date}`,
    "",
    "A dated record, written by `node scripts/calibration_report.mjs`. It changes no threshold. The captain chooses which recommendations to adopt.",
    "",
    "## How to read this",
    "",
    "- Each case's TypeSafe answer was recorded once, offline, by the `scripts/record_*_probabilities.ts` scripts. This report calls no model.",
    "- A **Choice** row is right when the chosen option was the right one. A **yes/no** row counts as yes when the right answer was yes, so its observed yes rate should match its mean P(yes).",
    "- **Expected calibration error (ECE)** is the count-weighted gap between stated confidence and observed accuracy across ten bins. 0 is perfectly calibrated.",
    "- A **recommendation** is the lowest threshold whose cases at or above it are at least 95% right, with the share of recorded cases that clear it. The share is over the fixture cases, not over live traffic, because no live probabilities are logged.",
    "- The samples are small (12 to 70 cases), so read the Wilson lower bound beside each accuracy before moving a threshold.",
    "",
    "## Summary",
    "",
    "| Decision | Cases | ECE | Threshold in code | Recommended |",
    "| --- | ---: | ---: | ---: | ---: |",
    ...summary,
    "",
    ...decisions.map(decisionSection),
    "## Not scored here",
    "",
    "- Venue resolution (`venue-resolution-probabilities.json`): the recording keeps the chosen candidate slot (`c0`, `c1`, ...) but not which venue each slot held, so a choice cannot be graded without re-running the candidate search.",
    "- Concierge intent (`conciergeIntentProbabilities.json`): several answers per case with no single threshold in front of them.",
    "- Pint price judgment (`pint-price-judgment-probabilities.json`): the recording has no hand label to grade against.",
    "- A comparison against another judge (TypeSafe's System One adapter or AnyJev) needs a live key and is not part of this offline report.",
    "",
  ].join("\n");
}

function main() {
  const args = process.argv.slice(2);
  const dateArg = args.indexOf("--date");
  const date = dateArg >= 0 ? args[dateArg + 1] : new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? "")) throw new Error("--date takes YYYY-MM-DD");
  const report = renderReport(loadDecisions(), date);
  if (args.includes("--stdout")) {
    process.stdout.write(report);
    return;
  }
  const out = join(ROOT, "docs", `TYPESAFE_CALIBRATION_${date}.md`);
  writeFileSync(out, report);
  console.log(`[calibration] wrote ${out.slice(ROOT.length + 1)}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
