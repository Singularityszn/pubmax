// The findings /press hands a writer, each one a complete sentence.
//
// BACKLINK PLAYBOOK, tactics 13 to 19 (docs/growth/BACKLINK_PLAYBOOK.md). A
// writer quotes a sentence, not a table, so each finding is written whole, with
// its figure, its place and its period inside it. Every figure is READ from a
// Pint Index snapshot through the same league table /pint-index renders, so a
// finding can never say a number the Index does not. A snapshot that has not
// cleared the admission floor (`pintIndexMeetsAdmissionFloor`) yields NO
// findings: an unindexed page must not be quoted either.

import { buildLeagueTable, dearestFirst, formatPintIndexDate, indexSummary, type PintIndexSnapshot } from "@/lib/pintIndex";
import { pintIndexMeetsAdmissionFloor } from "@/lib/pintIndexArchive";
import { formatGbp } from "@/lib/formatGbp";

export type CitableFinding = {
  /** Stable anchor, so a writer can link to one finding. */
  id: string;
  sentence: string;
};

export type CitableSample = {
  pubCount: number;
  boroughCount: number;
  observationCount: number;
  sourceCount: number;
  windowLabel: string;
};

// A Pint Index month is a UTC calendar month (lib/pintIndexArchive.ts), so a
// window edge is read as its UTC day. Formatting the instant itself in London
// time turns a June edition's last instant, 23:59:59.999Z, into 1 July, and every
// finding would then claim a period outside its own frozen edition. Noon on the
// UTC day is the `pintIndexMonthCloseDay` idiom: no zone can move it a day.
function windowDay(iso: string): string {
  return formatPintIndexDate(`${new Date(iso).toISOString().slice(0, 10)}T12:00:00.000Z`);
}

export function citableSample(snapshot: PintIndexSnapshot): CitableSample | null {
  if (!snapshot.observationWindow || snapshot.observations.length === 0) return null;
  const summary = indexSummary(buildLeagueTable(snapshot));
  return {
    pubCount: summary.pubCount,
    boroughCount: summary.boroughCount,
    observationCount: snapshot.observations.length,
    sourceCount: snapshot.sources.length,
    windowLabel: `${windowDay(snapshot.observationWindow.start)} to ${windowDay(snapshot.observationWindow.end)}`,
  };
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

export function citableFindings(snapshot: PintIndexSnapshot): CitableFinding[] {
  if (!pintIndexMeetsAdmissionFloor(snapshot)) return [];
  const sample = citableSample(snapshot);
  const rows = buildLeagueTable(snapshot);
  const summary = indexSummary(rows);
  if (!sample || summary.averageGbp === null) return [];

  const period = `between ${sample.windowLabel}`;
  const findings: CitableFinding[] = [
    {
      id: "average",
      sentence: `The average eligible pint in the London Pint Index was ${formatGbp(summary.averageGbp)}, across ${plural(sample.pubCount, "pub", "pubs")} in ${plural(sample.boroughCount, "borough", "boroughs")}, for prices seen ${period}.`,
    },
  ];

  const cheapest = summary.cheapestBorough;
  const dearest = summary.dearestBorough;
  if (cheapest && dearest && cheapest.name !== dearest.name) {
    const gap = Math.round((dearest.averageGbp - cheapest.averageGbp) * 100) / 100;
    findings.push(
      {
        id: "cheapest-borough",
        sentence: `${cheapest.name} had the cheapest average pint of any London borough in the Pint Index, at ${formatGbp(cheapest.averageGbp)} across ${plural(cheapest.pubCount, "pub", "pubs")}, for prices seen ${period}.`,
      },
      {
        id: "dearest-borough",
        sentence: `${dearest.name} had the dearest average pint of any London borough in the Pint Index, at ${formatGbp(dearest.averageGbp)} across ${plural(dearest.pubCount, "pub", "pubs")}, for prices seen ${period}.`,
      },
      {
        id: "borough-gap",
        sentence: `The average pint in ${dearest.name} cost ${formatGbp(gap)} more than in ${cheapest.name}, according to the London Pint Index for prices seen ${period}.`,
      },
    );
  }

  const dearestPint = dearestFirst(rows)[0];
  if (dearestPint) {
    findings.push({
      id: "dearest-pint",
      sentence: `The dearest eligible pint in the London Pint Index was ${formatGbp(dearestPint.maxGbp)}, at ${dearestPint.maxPubName} in ${dearestPint.name}, for prices seen ${period}.`,
    });
  }
  return findings;
}

/** The credit line a writer pastes under a quote or a chart. */
export function citationLine(title: string, url: string, publishedLabel: string): string {
  return `Source: ${title}, PUBMAXX, ${publishedLabel}. ${url}`;
}
