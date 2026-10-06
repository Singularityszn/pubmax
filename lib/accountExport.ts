// What an account's own export IS, in ONE place.
//
// UK GDPR gives a person the right to a portable copy of what is held about
// them, and until this door the only self-serve export was Pal memory JSON
// (`/api/pub-pal/memories/export`). This module owns the SHAPE the export
// route answers and every word the export surface prints, so the card, the
// route and the tests read one answer. It is pure: the reads live in
// `lib/accountExport.server.ts`.
//
// FIVE rules. (1) The export is the caller's own and nobody else's: the route
// derives the account from the verified bearer, like deletion does, and there
// is no field a caller could aim elsewhere. (2) Every lane says whether it
// answered whole: a read we could not run is `unavailable`, never an empty
// list presented as "nothing here", and the route refuses rather than hand
// over a partial export as if it were complete. (3) Nothing here is a second
// authority on any figure: prices and Pint Drops are exported as the stores
// project them. (4) No bytes: photos are named by their storage key and the
// Memory they sit in, and the words of a message thread are exported for the
// caller's own messages, never the other side's. (5) EVERY OWNER-KEYED STORE
// IS EITHER A LANE OR A NAMED EXCLUSION. `ACCOUNT_EXPORT_LANES` below is the
// table, and `__tests__/accountExport.test.ts` walks every `lib/*Store*.ts`
// module in the tree and fails on one that is neither, so a store added
// tomorrow cannot leave a person's data out of their own copy in silence.
// Review finding: the first cut of this door shipped four lanes and left the
// private card, the visit reports, the wall photos, the saved pubs, the Wanted
// list, the linked socials and the Night Profile out of it.

import type { DrinkCategory } from "@/lib/drinks";
import type { ConversationKind } from "@/lib/messageGroupThread";
import type { CheckIn } from "@/lib/checkIn";
import type { NightMemory, NightMoment } from "@/lib/nightMemory";
import type { NightProfile } from "@/lib/nightProfile";
import type { SavedPubDTO } from "@/lib/savedPubs";
import type { DrinkWallCategory } from "@/lib/venuePhotos";
import type { PublicSocialConnection } from "@/lib/socialConnections";
import type { VisitReportDTO } from "@/lib/visitReports";
import type { DiaryEntryDTO } from "@/lib/diary";
import type { WantedDTO } from "@/lib/wanted";

/** The export document's version, bumped when a field changes meaning. */
export const ACCOUNT_EXPORT_VERSION = 1;

/** How many of each lane the export carries at most. A cap is a window, not a filter: `truncated` says when it bit. */
export const ACCOUNT_EXPORT_LANE_CAP = 1000;

/** The heading over the export control, signed in. */
export const ACCOUNT_EXPORT_TITLE = "Download your data";

/** One line under the heading. */
export const ACCOUNT_EXPORT_LEDE =
  "A JSON file of everything this account holds: your private details, your Memories and Moments, your prices, Pint Drops, visit reports and photos, your saved pubs and the messages you sent.";

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
type AccountExportLaneStatus = "complete" | "unavailable";

export type AccountExportMemory = NightMemory & {
  moments: NightMoment[];
};

/**
 * The private card: the details behind the owner-authenticated read, which no
 * public projection ever carries. It is the row a person is most obviously
 * owed a copy of, and it was the one lane the first cut of this door missed.
 */
export type AccountExportIdentity = {
  /** ISO 8601 date, `YYYY-MM-DD`, or null for an account that never gave one. */
  dateOfBirth: string | null;
  fullName: string | null;
  sex: string | null;
  gender: string | null;
  genderSelfDescribed: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

/** One photo in this account's own cover rotation, named by its key. */
export type AccountExportCoverPhoto = {
  id: string;
  /** 1-based rotation position, the order the owner chose. */
  position: number;
  objectKey: string;
  createdAt: string;
};

/** One photo this account put on a pub wall or the Drink Wall, named by its key and never its bytes. */
export type AccountExportWallPhoto = {
  id: string;
  venueId: string | null;
  wallCategory: DrinkWallCategory;
  placeLabel: string;
  objectKey: string;
  caption: string;
  drinkCategory: DrinkCategory | null;
  /** `approved`, `hidden` or whatever the moderation lane last decided. */
  moderationState: string;
  createdAt: string;
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
  /**
   * What rode with the message, in the shape the person actually sent.
   *
   * A photo is named and not inlined (the bytes are the storage half of the
   * export). Every other kind carries the ID it stored rather than the card
   * that was resolved from it, because the card is a live read of somebody
   * else's row and a frozen copy of it in a file is a claim nobody can
   * correct. A poll carries its ballot and the EXPORTER'S OWN answer; no other
   * voter is named, exactly as no reader is ever told who voted.
   */
  attachment:
    | { kind: "photo" }
    | { kind: "venue"; venueId: string }
    | { kind: "contact"; handle: string }
    | { kind: "event"; planId: string }
    | {
        kind: "poll";
        question: string;
        options: string[];
        yourAnswer: number | null;
      }
    | null;
};

export type AccountExportConversation = {
  id: string;
  otherHandle: string;
  /**
   * WHAT KIND OF THREAD IT WAS. Absent means `direct`, so a file written before
   * group threads reads exactly as it did.
   *
   * A group carries its members and its title as well, because `otherHandle` on
   * a group row is only the FIRST other member - a nine-person thread exported
   * with that field alone reads back as a one-to-one with whoever happened to
   * sort first, which is a portable copy saying something untrue about the
   * person's own record.
   */
  kind?: ConversationKind;
  /** A group's own name, when it was given one. Absent on a direct row. */
  title?: string;
  /** Every live member at export time, the exporter included. Absent on a direct row. */
  memberHandles?: string[];
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
  /** At most one row, because an account has at most one private card. */
  identity: AccountExportLane<AccountExportIdentity>;
  memories: AccountExportLane<AccountExportMemory>;
  prices: AccountExportLane<AccountExportPrice>;
  pintDrops: AccountExportLane<AccountExportPintDrop>;
  visitReports: AccountExportLane<VisitReportDTO>;
  wallPhotos: AccountExportLane<AccountExportWallPhoto>;
  coverPhotos: AccountExportLane<AccountExportCoverPhoto>;
  checkIns: AccountExportLane<CheckIn>;
  /** The handles this account follows. Who follows it is their action, not its data. */
  follows: AccountExportLane<string>;
  savedPubs: AccountExportLane<SavedPubDTO>;
  wanted: AccountExportLane<WantedDTO>;
  /** The account's own diary: private visits, each with its day and optional half-star rating. */
  diary: AccountExportLane<DiaryEntryDTO>;
  socialLinks: AccountExportLane<PublicSocialConnection>;
  /** At most one row, the same way `identity` is. */
  nightProfile: AccountExportLane<NightProfile>;
  messages: AccountExportLane<AccountExportConversation>;
};

/** The lanes an export carries, so a refusal can name the one that could not answer. */
export const ACCOUNT_EXPORT_LANES = [
  "identity",
  "memories",
  "prices",
  "pintDrops",
  "visitReports",
  "wallPhotos",
  "coverPhotos",
  "checkIns",
  "follows",
  "savedPubs",
  "wanted",
  "diary",
  "socialLinks",
  "nightProfile",
  "messages",
] as const;
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
