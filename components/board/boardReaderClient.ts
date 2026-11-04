"use client";

// Client plumbing for the board reader: the account-bound read, and the
// confirmed rows sent one by one through the EXISTING community price write.
//
// The write is `postCommunityContribution`, the same call the venue sheet's
// price card makes, so every confirmed row takes that route's identity gate,
// bill check, rate limits, store and corroboration. The board photo is each
// row's bill. Nothing here writes a price any other way.

import { accountBoundFetch, type AccountAuthSnapshot } from "@/lib/accountBoundFetch";
import { errorMessageFrom, offlineOrMessage } from "@/lib/apiErrorMessage";
import {
  BOARD_READ_KEYLESS_CODE,
  boardPriceGbp,
  parseBoardReadAnswer,
  type BoardRead,
  type BoardReadProposal,
} from "@/lib/boardRead";
import { validateCommunityPrice } from "@/lib/communityPrice";
import { postCommunityContribution } from "@/lib/communityContributionClient";
import {
  readContributionGateStatus,
  type ContributionGateStatus,
} from "@/lib/contributionGateStatus";
import { discardBody } from "@/lib/responseBody";

const READ_FAILED = "The Pal could not read that board. Try again.";
const WRITE_FAILED = "Could not log that price right now.";

export type BoardReadResult =
  | ({ ok: true; photoSha256: string } & BoardRead)
  | { ok: false; kind: "gate"; status: ContributionGateStatus; error: string }
  | { ok: false; kind: "keyless"; error: string }
  | { ok: false; kind: "error"; error: string };

type ErrorBody = { error?: unknown; code?: unknown; status?: unknown };

export async function readBoard(
  auth: AccountAuthSnapshot,
  venueId: string,
  photo: File,
): Promise<BoardReadResult> {
  const form = new FormData();
  form.set("venueId", venueId);
  form.set("photo", photo);
  let res: Response;
  try {
    res = await accountBoundFetch(auth, "/api/board-reads", { method: "POST", body: form });
  } catch {
    return { ok: false, kind: "error", error: offlineOrMessage(READ_FAILED) };
  }
  const body = (await res.json().catch(() => ({}))) as ErrorBody & {
    photo?: { sha256?: unknown };
    proposals?: unknown;
    keptOut?: unknown;
  };
  if (res.ok) {
    // The server already parsed the model; this parses the server, so a card
    // never prints a row the leaf would not have kept. The food lines come
    // back through the same parser with their own kind.
    const read = parseBoardReadAnswer({
      rows: [
        ...(Array.isArray(body.proposals) ? body.proposals : []).map((row) => ({
          ...(row as Record<string, unknown>),
          kind: "drink",
        })),
        ...(Array.isArray(body.keptOut) ? body.keptOut : []).map((row) => ({
          ...(row as Record<string, unknown>),
          kind: "food",
        })),
      ],
    });
    const sha = typeof body.photo?.sha256 === "string" ? body.photo.sha256 : "";
    return { ok: true, photoSha256: sha, ...read };
  }
  if (body.code === BOARD_READ_KEYLESS_CODE) {
    return { ok: false, kind: "keyless", error: errorMessageFrom(body, READ_FAILED) };
  }
  const status = readContributionGateStatus(body.status);
  if (status) return { ok: false, kind: "gate", status, error: errorMessageFrom(body, READ_FAILED) };
  return { ok: false, kind: "error", error: errorMessageFrom(body, READ_FAILED) };
}

/** One card as the drinker left it: their price and measure, ticked or not. */
export type BoardRowDraft = BoardReadProposal & {
  /** The price as typed, in pounds ("4.80"). */
  priceGbp: string;
  ticked: boolean;
};

export type BoardRowOutcome =
  | { id: string; status: "logged" }
  | { id: string; status: "refused"; error: string };

export type BoardConfirmResult =
  | { ok: true; outcomes: BoardRowOutcome[] }
  | { ok: false; status: ContributionGateStatus; error: string; outcomes: BoardRowOutcome[] };

export function boardRowDraft(proposal: BoardReadProposal): BoardRowDraft {
  return { ...proposal, priceGbp: boardPriceGbp(proposal.pricePence), ticked: true };
}

/**
 * Send each TICKED row, in order, through the community price write with the
 * board photo as its bill. One at a time on purpose: the write's own rate
 * limits count each one, and a gate answer (sign in again, finish your
 * profile) stops the rest rather than repeating the same refusal.
 */
export async function confirmBoardRows(
  auth: AccountAuthSnapshot,
  venueId: string,
  rows: readonly BoardRowDraft[],
  bill: File,
  post: typeof postCommunityContribution = postCommunityContribution,
): Promise<BoardConfirmResult> {
  const outcomes: BoardRowOutcome[] = [];
  for (const row of rows) {
    if (!row.ticked) continue;
    const checked = validateCommunityPrice({
      venueId,
      drinkCategory: row.category,
      priceGbp: row.priceGbp,
    });
    if (!checked.ok) {
      outcomes.push({ id: row.id, status: "refused", error: checked.error });
      continue;
    }
    let res: Response;
    try {
      res = await post(
        auth,
        {
          venueId,
          drinkCategory: checked.value.drinkCategory,
          priceGbp: checked.value.priceGbp,
          measure: row.measure,
          ...(row.measure === "other" && row.measureLabel ? { measureLabel: row.measureLabel } : {}),
        },
        { receiptPhoto: bill },
      );
    } catch {
      outcomes.push({ id: row.id, status: "refused", error: offlineOrMessage(WRITE_FAILED) });
      continue;
    }
    if (res.ok) {
      discardBody(res);
      outcomes.push({ id: row.id, status: "logged" });
      continue;
    }
    const body = (await res.json().catch(() => ({}))) as ErrorBody;
    const error = errorMessageFrom(body, WRITE_FAILED);
    const status = readContributionGateStatus(body.status);
    if (status) return { ok: false, status, error, outcomes };
    outcomes.push({ id: row.id, status: "refused", error });
  }
  return { ok: true, outcomes };
}
