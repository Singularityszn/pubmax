import type { Route } from "next";

import { DRINK_MEASURE_LABEL, drinkMeasureName, measureIsPint, type DrinkMeasure } from "@/lib/drinkMeasure";
import { formatGbp } from "@/lib/formatGbp";
import { dropAuthorLabel } from "@/lib/handleDisplay";
import { ANON_HANDLE_LABEL, type Visibility } from "@/lib/pintDropShared";
import type { PriceEvidence } from "@/lib/pintDropReceipt";
import { pintShareSourceLine, type PintShare } from "@/lib/pintShare";
import { PRICE_NOT_COMPARED_LINE } from "@/lib/priceMovementLine";

// THE PINT RECEIPT: one public Pint Drop, printed like a till receipt.
//
// It prints only what the drinker logged and what the server knows about it:
// the pub, the drink, the measure, the price, the London day it was logged,
// who logged it and what the bill check found. A listed price prints beside a
// pint only with its source line, and always with the house line, because a
// listed row and a drinker's pint cannot be shown to be the same pint.
//
// The day is the day the drop was logged. The app has no other paid date, so
// the receipt says "Logged" and never claims more.
//
// Browser-safe: the permalink, its share image and the composer's share step
// all read this one model.

export type PintReceiptDrop = {
  venueName: string;
  drink: string;
  measure?: DrinkMeasure;
  measureLabel?: string;
  priceGbp: number | null;
  createdAt: string;
  handle: string;
  visibility?: Visibility;
  priceEvidence?: PriceEvidence;
};

export type PintReceipt = {
  venueName: string;
  /** "Pint", "Half", or the free label an `other` measure carries. */
  measure: string;
  drink: string | null;
  price: string | null;
  /** "Tue 10 Nov 2026" in London, or null when the timestamp is unreadable. */
  loggedOn: string | null;
  /** "@handle", or the house label for an anonymous or withheld author. */
  drinker: string;
  bill: string | null;
  listed: { price: string; source: string; houseLine: string } | null;
};

const BILL_LINE: Record<PriceEvidence, string> = {
  receipt: "Checked against the bill",
  unchecked: "Not checked yet",
};

const LONDON_DAY = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Europe/London",
});

function londonDay(iso: string): string | null {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const parts = LONDON_DAY.formatToParts(new Date(ms));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${part("weekday")} ${part("day")} ${part("month")} ${part("year")}`;
}

function positivePrice(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

/** How a drop's author is shown. An anonymous or withheld author has no "@". */
function receiptDrinkerLabel(handle: string, visibility?: Visibility): string {
  if (visibility === "anonymous") return ANON_HANDLE_LABEL;
  return dropAuthorLabel(handle);
}

export function buildPintReceipt(
  drop: PintReceiptDrop,
  listedShare: PintShare | null = null,
): PintReceipt {
  const priceGbp = positivePrice(drop.priceGbp);
  const drink = drop.drink.replace(/\s+/g, " ").trim();
  const comparable = priceGbp !== null && measureIsPint(drop.measure) && listedShare !== null;
  return {
    venueName: drop.venueName,
    measure: drinkMeasureName(drop.measure, drop.measureLabel),
    drink: drink || null,
    price: priceGbp === null ? null : formatGbp(priceGbp),
    loggedOn: londonDay(drop.createdAt),
    drinker: receiptDrinkerLabel(drop.handle, drop.visibility),
    bill: priceGbp !== null && drop.priceEvidence ? BILL_LINE[drop.priceEvidence] : null,
    listed: comparable
      ? {
          price: formatGbp(listedShare.priceGbp),
          source: pintShareSourceLine(listedShare),
          houseLine: PRICE_NOT_COMPARED_LINE,
        }
      : null,
  };
}

export function formatReceiptItem(receipt: PintReceipt): string {
  const measure = Object.values(DRINK_MEASURE_LABEL).includes(receipt.measure)
    ? receipt.measure.toLowerCase()
    : receipt.measure;
  if (receipt.drink) {
    return measure === "pint" || measure === "half"
      ? `${receipt.measure} of ${receipt.drink}`
      : `${receipt.drink}, ${measure}`;
  }
  return measure === "pint" || measure === "half" || measure === "bottle"
    ? `A ${measure}`
    : `A ${measure} serve`;
}

export function buildReceiptShareText(receipt: PintReceipt): string {
  const what = formatReceiptItem(receipt);
  const bits = [`${what} at ${receipt.venueName}`, receipt.price, receipt.loggedOn].filter(Boolean);
  return `${bits.join(", ")}. My receipt on PUBMAXX.`;
}

export type ReceiptShare = { dropId: string; path: Route; receipt: PintReceipt };

/** What the server answered for a saved drop: loose, because it crossed the wire. */
export type SavedDropForReceipt = {
  id?: unknown;
  status?: unknown;
  visibility?: unknown;
  drink?: unknown;
  measure?: unknown;
  measureLabel?: unknown;
  priceGbp?: unknown;
  createdAt?: unknown;
  handle?: unknown;
  priceEvidence?: unknown;
};

const text = (value: unknown): string => (typeof value === "string" ? value : "");

/**
 * The receipt a just-saved drop may offer to share, or null. Only a priced,
 * visible drop that a stranger's link can open: public or anonymous. A friends
 * or Ledger drop would open as "not on the wall" for everyone else.
 */
export function receiptShareFromSavedDrop(
  saved: SavedDropForReceipt,
  venueName: string,
): ReceiptShare | null {
  const dropId = text(saved.id).trim();
  const visibility = text(saved.visibility);
  if (!dropId || saved.status !== "visible") return null;
  if (visibility !== "public" && visibility !== "anonymous") return null;
  const priceGbp = typeof saved.priceGbp === "number" ? positivePrice(saved.priceGbp) : null;
  if (priceGbp === null) return null;
  const evidence = text(saved.priceEvidence);
  const receipt = buildPintReceipt({
    venueName,
    drink: text(saved.drink),
    measure: (text(saved.measure) || undefined) as DrinkMeasure | undefined,
    measureLabel: text(saved.measureLabel) || undefined,
    priceGbp,
    createdAt: text(saved.createdAt),
    handle: text(saved.handle),
    visibility,
    priceEvidence: evidence === "receipt" || evidence === "unchecked" ? evidence : undefined,
  });
  return { dropId, path: `/p/${encodeURIComponent(dropId)}` as Route, receipt };
}
