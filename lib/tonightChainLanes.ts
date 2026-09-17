// The chain lanes on Tonight, and why a chain gets a lane of its own.
//
// A chain publishes one offer across dozens of pubs at once, so a chain row
// wins any list ordered by supply and a reader meets "J D Wetherspoon" where
// they came for a pub. The answer is not to hide the deal: 96 Wetherspoon rows
// and a shelf of Greene King fixtures are real, sourced supply somebody may
// want. The answer is to LABEL it. Each chain gets a block carrying the
// chain's own name, its source credit and the day that source was read, under
// the lede rather than in front of it.
//
// TWO RULES.
//
//   1. A LANE IS DECIDED BY THE SOURCE, NEVER BY THE TITLE. A pub whose own
//      listing mentions Wetherspoon is not a Wetherspoon row; the publisher of
//      the row is. That is the same reading `lib/tonightPrimary.ts` takes, and
//      the half that actually holds (PR #1488).
//   2. A BLOCK IS DATED BY ITS OLDEST ROW, or it is undated. One line covering
//      several rows takes the oldest of them, the covering rule in
//      `lib/whatsOn.ts`, so a block cannot borrow a fresh row's day for a stale
//      one beside it.

import { firstHttp } from "@/lib/httpUrl";
import type { WhatsOnRow } from "@/lib/whatsOn";

export type TonightChainLaneKey = "wetherspoon" | "greene-king";

export type TonightChainLane = {
  key: TonightChainLaneKey;
  /** The block heading a reader sees. */
  title: string;
};

/** How many rows a chain block shows before the rest fold away. */
export const TONIGHT_CHAIN_LANE_VISIBLE = 3;

const TONIGHT_CHAIN_LANES: readonly TonightChainLane[] = [
  { key: "wetherspoon", title: "Wetherspoon deals tonight" },
  { key: "greene-king", title: "Greene King tonight" },
];

function sourceHost(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function hostIs(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/** Which chain lane a row belongs to, or null when no chain published it. */
export function tonightChainLaneOf(
  row: Pick<WhatsOnRow, "id" | "source">,
): TonightChainLaneKey | null {
  const label = row.source.label.toLowerCase().replace(/[^a-z0-9]/g, "");
  const host = sourceHost(row.source.url);
  if (
    /^deal-jdw-/i.test(row.id) ||
    label.includes("jdw") ||
    label.includes("wetherspoon") ||
    hostIs(host, "jdwetherspoon.com")
  ) {
    return "wetherspoon";
  }
  if (label.includes("greeneking") || hostIs(host, "greeneking.co.uk")) {
    return "greene-king";
  }
  return null;
}

function isTonightChainRow(row: Pick<WhatsOnRow, "id" | "source">): boolean {
  return tonightChainLaneOf(row) !== null;
}

/** Everything a chain did not publish, in the order it arrived. */
export function withoutTonightChainRows<T extends Pick<WhatsOnRow, "id" | "source">>(
  rows: readonly T[],
): T[] {
  return rows.filter((row) => !isTonightChainRow(row));
}

export type TonightChainLaneAnswer = {
  key: TonightChainLaneKey;
  title: string;
  rows: WhatsOnRow[];
  /** How the chain names itself on its own rows. */
  sourceLabel: string;
  /** The chain's own page, when its rows carry one. */
  sourceHref: string | null;
  /** Oldest observation across the block's rows, or null when one is undated. */
  observedAt: string | null;
};

/**
 * One block per chain that published something, in the table's own order.
 *
 * A chain with no rows gets no block: an empty heading is a claim that the
 * chain was quiet tonight, and this list is not a coverage report.
 */
export function tonightChainLaneAnswers(
  rows: readonly WhatsOnRow[],
): TonightChainLaneAnswer[] {
  const answers: TonightChainLaneAnswer[] = [];
  for (const lane of TONIGHT_CHAIN_LANES) {
    const laneRows = rows.filter((row) => tonightChainLaneOf(row) === lane.key);
    if (laneRows.length === 0) continue;
    let observedAt: string | null = null;
    let dated = true;
    for (const row of laneRows) {
      const ms = Date.parse(row.observedAt ?? "");
      if (!Number.isFinite(ms)) {
        dated = false;
        continue;
      }
      if (observedAt === null || ms < Date.parse(observedAt)) observedAt = row.observedAt;
    }
    const first = laneRows[0] as WhatsOnRow;
    answers.push({
      key: lane.key,
      title: lane.title,
      rows: laneRows,
      sourceLabel: first.source.label,
      sourceHref: firstHttp(first.source.url) || null,
      observedAt: dated ? observedAt : null,
    });
  }
  return answers;
}
