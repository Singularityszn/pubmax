// What an account's own export IS, in ONE place.
//
// UK GDPR gives a person the right to a portable copy of what is held about
// them, and until this door the only self-serve export was Pal memory JSON
// (`/api/pub-pal/memories/export`). This module owns the SHAPE the export
// route answers and every word the export surface prints, so the card, the
// route and the tests read one answer. It is pure: the reads live in
// `lib/accountExport.server.ts`.
//
// FOUR rules. (1) The export is the caller's own and nobody else's: the route
// derives the account from the verified bearer, like deletion does, and there
// is no field a caller could aim elsewhere. (2) Every lane says whether it
// answered whole: a read we could not run is `unavailable`, never an empty
// list presented as "nothing here", and the route refuses rather than hand
// over a partial export as if it were complete. (3) Nothing here is a second
// authority on any figure: prices and Pint Drops are exported as the stores
// project them. (4) No bytes: photos are named by their storage key and the
// Memory they sit in, and the words of a message thread are exported for the
// caller's own messages, never the other side's.

import type { DrinkCategory } from "@/lib/drinks";
import type { NightMemory, NightMoment } from "@/lib/nightMemory";

/** The export document's version, bumped when a field changes meaning. */
export const ACCOUNT_EXPORT_VERSION = 1;

/** How many of each lane the export carries at most. A cap is a window, not a filter: `truncated` says when it bit. */
export const ACCOUNT_EXPORT_LANE_CAP = 1000;

/** The heading over the export control, signed in. */
export const ACCOUNT_EXPORT_TITLE = "Download your data";

/** One line under the heading. */
export const ACCOUNT_EXPORT_LEDE =
  "A JSON file of your Memories, Moments, prices, Pint Drops and the messages you sent.";

/** The control that prepares the file. */
export const ACCOUNT_EXPORT_LABEL = "Download JSON";

/** Said while the request is in flight. */
export const ACCOUNT_EXPORT_BUSY_LINE = "Preparing your file.";

/** Said once the file has been handed to the browser. */
export const ACCOUNT_EXPORT_DONE_LINE = "Your file is ready.";

/** Said when the request could not be sent or the server could not answer. */
export const ACCOUNT_EXPORT_FAILED_LINE = "Your data could not be prepared. Try again.";

/** Said when the browser session went away before the request could be signed. */
export const ACCOUNT_EXPORT_SESSION_LINE = "Sign in again, then download your data.";

/** A lane either answered whole or could not be run; there is no third word. */
export type AccountExportLaneStatus = "complete" | "unavailable";

export type AccountExportMemory = NightMemory & {
  moments: NightMoment[];
};

export type AccountExportPrice = {
  id: string;
  venueId: string;
  drinkCategory: DrinkCategory;
  priceGbp: number;
  /** ISO 8601, server clock. */
  submittedAt: string;
  /** Hidden by a moderator; still the caller's own observation. */
  hidden: boolean;
};

export type AccountExportPintDrop = {
  id: string;
  venueId: string;
  drink: string;
  priceGbp: number | null;
  passedDownNote: string;
  era: string;
  visibility: string;
  createdAt: string;
  confirmedAt: string | null;
};

export type AccountExportMessage = {
  id: string;
  conversationId: string;
  body: string;
  createdAt: string;
  /** `photo` or `venue`; a venue share also carries its venue id. */
  attachment: { kind: "photo" } | { kind: "venue"; venueId: string } | null;
};

export type AccountExportConversation = {
  id: string;
  otherHandle: string;
  /** The caller's OWN messages in the thread, oldest first. */
  messages: AccountExportMessage[];
};

export type AccountExportLane<T> = {
  status: AccountExportLaneStatus;
  /** True when the lane cap bit, so `items` is a window rather than the whole. */
  truncated: boolean;
  items: T[];
};

export type AccountExport = {
  version: typeof ACCOUNT_EXPORT_VERSION;
  /** ISO 8601, server clock. */
  exportedAt: string;
  account: {
    userId: string;
    handle: string | null;
    displayName: string | null;
  };
  memories: AccountExportLane<AccountExportMemory>;
  prices: AccountExportLane<AccountExportPrice>;
  pintDrops: AccountExportLane<AccountExportPintDrop>;
  messages: AccountExportLane<AccountExportConversation>;
};

/** The lanes an export carries, so a refusal can name the one that could not answer. */
export const ACCOUNT_EXPORT_LANES = ["memories", "prices", "pintDrops", "messages"] as const;
export type AccountExportLaneName = (typeof ACCOUNT_EXPORT_LANES)[number];

/** The lanes that could not be run, in table order. Empty means the export is whole. */
export function unavailableExportLanes(
  document: Pick<AccountExport, AccountExportLaneName>,
): AccountExportLaneName[] {
  return ACCOUNT_EXPORT_LANES.filter((lane) => document[lane].status === "unavailable");
}

/** The file name the browser is handed: the handle when there is one, else the day. */
export function accountExportFilename(handle: string | null, exportedAt: string): string {
  const stem = handle ? handle.toLowerCase().replace(/[^a-z0-9_]+/g, "-") : "account";
  const day = exportedAt.slice(0, 10);
  return `pubmaxx-${stem}-${day}.json`;
}

/** A lane bounded to the cap, saying so when it bit. */
export function boundedLane<T>(items: readonly T[]): AccountExportLane<T> {
  return {
    status: "complete",
    truncated: items.length > ACCOUNT_EXPORT_LANE_CAP,
    items: items.slice(0, ACCOUNT_EXPORT_LANE_CAP),
  };
}

/** The one shape a lane that could not be read takes. */
export function unavailableLane<T>(): AccountExportLane<T> {
  return { status: "unavailable", truncated: false, items: [] };
}
