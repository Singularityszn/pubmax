// Venue submissions (Phase 1): a signed-in drinker names a pub the map does not
// have, and can attach its menu and the prices they saw there.
//
// A submission is a PROPOSAL, never a venue. Nothing reads it to draw a pin,
// answer a search or admit a write: a venue still exists only in the committed
// packs (`lib/venueWriteTarget.server.ts`). An accepted submission reaches them
// through the offline pack rebuild, so accepting one here only stamps a status.
//
// What it carries, and what each part is worth:
//   - name, address, postcode, an optional map position: what the reviewer
//     checks against the street before the pub is folded into a pack.
//   - website and menu link: PROVENANCE ONLY. The app never fetches either. A
//     harvest may read one only after the owner records it as a source in
//     `lib/harvest/sourcePolicy.ts`, like every other URL.
//   - prices: what the submitter says they saw. They carry no Price Standing; a
//     reviewer checks each figure before any of it enters a price lane.
//   - menu files: photos and PDFs a reviewer reads, kept in the private bucket.
//
// Browser-safe leaf: the form and the route share ONE validator, so the client
// can answer instantly and the server's answer is still the only one trusted.
// The closed sets here are mirrored by CHECKs in migration 0181.

import type { Route } from "next";

import { COMMUNITY_PRICE_MAX_GBP, COMMUNITY_PRICE_MIN_GBP, roundToPennies } from "@/lib/communityPrice";
import { DRINK_CATEGORIES, isDrinkCategory, type DrinkCategory } from "@/lib/drinks";
import { cleanDrinkMeasure, type DrinkMeasure } from "@/lib/drinkMeasure";
import { cleanText } from "@/lib/textClean";
import { UPLOAD_PHOTO_MAX_BYTES } from "@/lib/uploadBodyLimit";

export const VENUE_SUBMISSION_STATUSES = ["pending", "accepted", "declined", "duplicate"] as const;
export type VenueSubmissionStatus = (typeof VENUE_SUBMISSION_STATUSES)[number];

export const VENUE_SUBMISSION_FILE_KINDS = ["image", "pdf"] as const;
export type VenueSubmissionFileKind = (typeof VENUE_SUBMISSION_FILE_KINDS)[number];

export const VENUE_SUBMISSION_NAME_MAX = 120;
export const VENUE_SUBMISSION_ADDRESS_MAX = 200;
const VENUE_SUBMISSION_URL_MAX = 500;
export const VENUE_SUBMISSION_HOURS_MAX = 300;
export const VENUE_SUBMISSION_NOTE_MAX = 500;
export const VENUE_SUBMISSION_DRINK_NAME_MAX = 60;
export const VENUE_SUBMISSION_REVIEWER_NOTE_MAX = 500;
export const VENUE_SUBMISSION_MAX_PRICES = 20;
export const VENUE_SUBMISSION_MAX_FILES = 3;
/** One file per request, so the platform's body cap is the file cap. */
export const VENUE_SUBMISSION_FILE_MAX_BYTES = UPLOAD_PHOTO_MAX_BYTES;
/** More open proposals than this from one account is a backlog, not a pub. */
export const VENUE_SUBMISSION_MAX_PENDING_PER_ACCOUNT = 10;

/** What the file picker offers and the route accepts. HEIC is converted by the browser. */
export const VENUE_SUBMISSION_FILE_ACCEPT = "image/jpeg,image/png,image/webp,application/pdf";
export const VENUE_SUBMISSION_FILE_TYPES: ReadonlySet<string> = new Set(
  VENUE_SUBMISSION_FILE_ACCEPT.split(","),
);

/** The Add a pub page. A name rides along so the form opens with it typed. */
const ADD_PUB_PATH = "/add-a-pub";

export function addPubHref(name?: string): Route {
  const typed = cleanText(name, VENUE_SUBMISSION_NAME_MAX);
  return (typed ? `${ADD_PUB_PATH}?name=${encodeURIComponent(typed)}` : ADD_PUB_PATH) as Route;
}

/** Bucket folder for one account's menu files. Account deletion walks it. */
const VENUE_SUBMISSION_STORAGE_PREFIX = "venue-submissions";

export function venueSubmissionObjectPrefix(ownerUserId: string): string {
  return `${VENUE_SUBMISSION_STORAGE_PREFIX}/${ownerUserId}`;
}

/** The one shape a stored menu file's key takes; the 0181 CHECK holds it. */
export function venueSubmissionFileKey(
  ownerUserId: string,
  submissionId: string,
  fileId: string,
  kind: VenueSubmissionFileKind,
): string {
  const extension = kind === "pdf" ? "pdf" : "jpg";
  return `${venueSubmissionObjectPrefix(ownerUserId)}/${submissionId}/${fileId}.${extension}`;
}

/** Great Britain's bounding box, the same one the 0181 position CHECK uses. */
const GB_BOUNDS = { minLat: 49.8, maxLat: 60.95, minLng: -8.7, maxLng: 1.8 } as const;

/** A full UK postcode, outward and inward parts. */
const UK_POSTCODE = /^([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})$/;

export type VenueSubmissionPrice = {
  drinkCategory: DrinkCategory;
  /** What the menu or the bar called it, such as "Camden Hells". May be empty. */
  drinkName: string;
  priceGbp: number;
  measure: DrinkMeasure;
};

/** Validated fields the store persists (id, status and timestamps come from the store). */
export type VenueSubmissionFields = {
  /** The signed-in account's auth user id. Never a handle and never a request field. */
  ownerUserId: string;
  name: string;
  address: string;
  postcode: string;
  latitude: number | null;
  longitude: number | null;
  website: string;
  menuUrl: string;
  openingHours: string;
  note: string;
  prices: VenueSubmissionPrice[];
};

export type VenueSubmissionFile = {
  id: string;
  submissionId: string;
  ownerUserId: string;
  objectKey: string;
  kind: VenueSubmissionFileKind;
  contentType: "image/jpeg" | "application/pdf";
  byteSize: number;
  sha256: string;
  createdAt: string;
};

export type VenueSubmission = VenueSubmissionFields & {
  id: string;
  status: VenueSubmissionStatus;
  duplicateOfVenueId: string | null;
  reviewerNote: string | null;
  reviewedAt: string | null;
  createdAt: string;
  files: VenueSubmissionFile[];
};

/** A submission without its owner or its stored files: what a moderator and an export read. */
export type VenueSubmissionPublicFields = Omit<VenueSubmission, "ownerUserId" | "files">;

export function venueSubmissionPublicFields(row: VenueSubmission): VenueSubmissionPublicFields {
  return {
    id: row.id,
    name: row.name,
    address: row.address,
    postcode: row.postcode,
    latitude: row.latitude,
    longitude: row.longitude,
    website: row.website,
    menuUrl: row.menuUrl,
    openingHours: row.openingHours,
    note: row.note,
    prices: row.prices.map((price) => ({ ...price })),
    status: row.status,
    duplicateOfVenueId: row.duplicateOfVenueId,
    reviewerNote: row.reviewerNote,
    reviewedAt: row.reviewedAt,
    createdAt: row.createdAt,
  };
}

/** A pub the map already has that a new submission may be. */
export type ExistingVenueMatch = {
  venueId: string;
  venueName: string;
  address: string;
};

/** What the submitter reads back about their own proposal. */
export type VenueSubmissionOwnerDTO = {
  id: string;
  name: string;
  address: string;
  postcode: string;
  status: VenueSubmissionStatus;
  priceCount: number;
  fileCount: number;
  createdAt: string;
};

export function toVenueSubmissionOwnerDTO(row: VenueSubmission): VenueSubmissionOwnerDTO {
  return {
    id: row.id,
    name: row.name,
    address: row.address,
    postcode: row.postcode,
    status: row.status,
    priceCount: row.prices.length,
    fileCount: row.files.length,
    createdAt: row.createdAt,
  };
}

export type VenueSubmissionValidation =
  | { ok: true; value: VenueSubmissionFields }
  | { ok: false; error: string; field: VenueSubmissionField };

type VenueSubmissionField =
  | "body"
  | "name"
  | "address"
  | "postcode"
  | "position"
  | "website"
  | "menuUrl"
  | "prices";

const STATUS_LABEL: Record<VenueSubmissionStatus, string> = {
  pending: "Waiting for a check",
  accepted: "Going on the map at the next update",
  declined: "Not added",
  duplicate: "Already on the map",
};

/** How a submitter's own list names each status. */
export function venueSubmissionStatusLabel(status: VenueSubmissionStatus): string {
  return STATUS_LABEL[status];
}

export function isVenueSubmissionStatus(value: unknown): value is VenueSubmissionStatus {
  return typeof value === "string" && (VENUE_SUBMISSION_STATUSES as readonly string[]).includes(value);
}

/** "sw1a1aa" and "SW1A  1AA" both read as "SW1A 1AA"; anything else is null. */
export function normaliseUkPostcode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = UK_POSTCODE.exec(value.trim().toUpperCase());
  return match ? `${match[1]} ${match[2]}` : null;
}

/**
 * A link a person typed, as an https URL we are willing to store, or null.
 *
 * A bare "crownpub.co.uk" gains its https scheme, because that is how people
 * type a pub's site. Plain http, credentials in the URL and every other scheme
 * are refused: the link is stored for a reviewer to open, and it must not be a
 * way to hand them a password or a script.
 */
export function cleanSubmittedUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return "";
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  if (withScheme.length > VENUE_SUBMISSION_URL_MAX) return null;
  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) return null;
  if (!parsed.hostname.includes(".")) return null;
  return parsed.toString();
}

function readNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    // What a phone keypad produces: "£4.20", " 4.20", "4,20".
    const cleaned = value.replace(/[£\s]/g, "").replace(",", ".");
    if (cleaned === "") return null;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function readPosition(
  latitude: unknown,
  longitude: unknown,
): { ok: true; latitude: number | null; longitude: number | null } | { ok: false } {
  const blank = (value: unknown) => value === undefined || value === null || value === "";
  if (blank(latitude) && blank(longitude)) return { ok: true, latitude: null, longitude: null };
  const lat = readNumber(latitude);
  const lng = readNumber(longitude);
  if (lat === null || lng === null) return { ok: false };
  if (lat < GB_BOUNDS.minLat || lat > GB_BOUNDS.maxLat) return { ok: false };
  if (lng < GB_BOUNDS.minLng || lng > GB_BOUNDS.maxLng) return { ok: false };
  return { ok: true, latitude: lat, longitude: lng };
}

type PriceValidation =
  | { ok: true; value: VenueSubmissionPrice }
  | { ok: false; error: string };

/** One price line. Bounds are the community price envelope, so the two never disagree. */
function validateVenueSubmissionPrice(input: unknown): PriceValidation {
  if (!input || typeof input !== "object") return { ok: false, error: "Each price needs a drink and a figure." };
  const raw = input as Record<string, unknown>;
  const category = typeof raw.drinkCategory === "string" ? raw.drinkCategory.trim().toLowerCase() : "";
  if (!isDrinkCategory(category)) return { ok: false, error: "Pick what each price is for." };
  const parsed = readNumber(raw.priceGbp);
  if (parsed === null) return { ok: false, error: "Type each price as a figure, like 5.20." };
  if (parsed < COMMUNITY_PRICE_MIN_GBP || parsed > COMMUNITY_PRICE_MAX_GBP) {
    return {
      ok: false,
      error: `A drink price sits between £${COMMUNITY_PRICE_MIN_GBP} and £${COMMUNITY_PRICE_MAX_GBP}.`,
    };
  }
  return {
    ok: true,
    value: {
      drinkCategory: category,
      drinkName: cleanText(raw.drinkName, VENUE_SUBMISSION_DRINK_NAME_MAX),
      priceGbp: roundToPennies(parsed),
      measure: cleanDrinkMeasure(raw.measure),
    },
  };
}

/**
 * Trust boundary for a new submission. The owner is passed in from the
 * session by the route; a body owner field is never read.
 */
export function validateVenueSubmission(
  ownerUserId: string,
  input: unknown,
): VenueSubmissionValidation {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "Missing submission body.", field: "body" };
  }
  const raw = input as Record<string, unknown>;

  const name = cleanText(raw.name, VENUE_SUBMISSION_NAME_MAX);
  if (!name) return { ok: false, error: "Add the pub's name.", field: "name" };

  const address = cleanText(raw.address, VENUE_SUBMISSION_ADDRESS_MAX);
  if (!address) return { ok: false, error: "Add the street address.", field: "address" };

  let postcode = "";
  if (typeof raw.postcode === "string" && raw.postcode.trim()) {
    const normalised = normaliseUkPostcode(raw.postcode);
    if (!normalised) return { ok: false, error: "That postcode doesn't look right. Try SE1 9AA.", field: "postcode" };
    postcode = normalised;
  }

  const position = readPosition(raw.latitude, raw.longitude);
  if (!position.ok) return { ok: false, error: "The map pin needs to be in Great Britain.", field: "position" };

  const website = cleanSubmittedUrl(raw.website ?? "");
  if (website === null) return { ok: false, error: "The website needs to be a full https link.", field: "website" };

  const menuUrl = cleanSubmittedUrl(raw.menuUrl ?? "");
  if (menuUrl === null) return { ok: false, error: "The menu link needs to be a full https link.", field: "menuUrl" };

  const rawPrices = raw.prices ?? [];
  if (!Array.isArray(rawPrices)) return { ok: false, error: "Prices arrived in the wrong shape.", field: "prices" };
  if (rawPrices.length > VENUE_SUBMISSION_MAX_PRICES) {
    return { ok: false, error: `Add up to ${VENUE_SUBMISSION_MAX_PRICES} prices.`, field: "prices" };
  }
  const prices: VenueSubmissionPrice[] = [];
  for (const line of rawPrices) {
    const price = validateVenueSubmissionPrice(line);
    if (!price.ok) return { ok: false, error: price.error, field: "prices" };
    prices.push(price.value);
  }

  return {
    ok: true,
    value: {
      ownerUserId,
      name,
      address,
      postcode,
      latitude: position.latitude,
      longitude: position.longitude,
      website,
      menuUrl,
      openingHours: cleanText(raw.openingHours, VENUE_SUBMISSION_HOURS_MAX),
      note: cleanText(raw.note, VENUE_SUBMISSION_NOTE_MAX),
      prices,
    },
  };
}

/** A file's kind from its declared type, or null when the route refuses it. */
export function venueSubmissionFileKind(contentType: string): VenueSubmissionFileKind | null {
  if (!VENUE_SUBMISSION_FILE_TYPES.has(contentType)) return null;
  return contentType === "application/pdf" ? "pdf" : "image";
}

/** "%PDF-" at byte zero. A PDF is stored as sent, so this is its whole type check. */
export function looksLikePdf(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 5
    && bytes[0] === 0x25
    && bytes[1] === 0x50
    && bytes[2] === 0x44
    && bytes[3] === 0x46
    && bytes[4] === 0x2d
  );
}

/** The drink choices the form offers, in the vocabulary's own order. */
export const VENUE_SUBMISSION_DRINK_CATEGORIES: readonly DrinkCategory[] = DRINK_CATEGORIES;

/** A moderator's verdict on a pending submission. */
export type VenueSubmissionDecision =
  | { status: "accepted" | "declined"; note: string | null }
  | { status: "duplicate"; duplicateOfVenueId: string; note: string | null };

export function validateVenueSubmissionDecision(
  input: Record<string, unknown>,
): { ok: true; value: VenueSubmissionDecision } | { ok: false; error: string } {
  const note = cleanText(input.note, VENUE_SUBMISSION_REVIEWER_NOTE_MAX) || null;
  const action = input.action;
  if (action === "accept") return { ok: true, value: { status: "accepted", note } };
  if (action === "decline") return { ok: true, value: { status: "declined", note } };
  if (action === "duplicate") {
    const target = typeof input.duplicateOfVenueId === "string" ? input.duplicateOfVenueId.trim() : "";
    if (!/^venue-[a-z0-9-]{1,58}$/.test(target)) {
      return { ok: false, error: "Name the pub this one duplicates by its venue id." };
    }
    return { ok: true, value: { status: "duplicate", duplicateOfVenueId: target, note } };
  }
  return { ok: false, error: "Unknown action." };
}
