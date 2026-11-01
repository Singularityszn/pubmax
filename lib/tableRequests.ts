// "Ask the pub for a table" (launch plan 1 Nov 2026, section 7 item 3): the
// PURE leaf. Types, the closed vocabularies, the untrusted-input validator and
// every word a request is sent in. No IO: the store is
// lib/tableRequestsStore.ts, the delivery is lib/tableRequestDelivery.server.ts
// and the one route is app/api/table-requests/route.ts.
//
// A TABLE REQUEST IS A MESSAGE TO A PUB, NEVER A BOOKING. PUBMAXX takes no
// booking, holds no table and charges nothing: no fee, no deposit, no card. A
// fee per seated group is a later decision under ADR 0011, and nothing here is
// built for it. The pub replies to the person directly, through the contact
// the person chose.
//
// IT CHANGES NOTHING ELSE. A request is never read by what ranks, colours,
// bands or orders a venue (__tests__/tableRequestFence.test.ts).
//
// Two ways out, and the reader is told which one ran:
//   1. The pub has a verified operator, and an email to that operator was
//      SENT: the request is stored for the operator panel and the person reads
//      "Sent to the pub".
//   2. Anything else (no operator, no email on file, no email keys, a send
//      that failed): PUBMAXX sent nothing, and the sheet hands the person a
//      prefilled email to the pub's own published address, or its phone, and
//      says plainly that PUBMAXX did not send it.

import { isValidEmail, normalizeEmail } from "@/lib/emailAddress";
import { londonCalendarDate } from "@/lib/privateIdentity";
import { cleanText } from "@/lib/textClean";
import { parsePhoneNumber } from "@/lib/venueTruth";

/** A crew of six or more: below that, a pub does not need asking. */
export const TABLE_REQUEST_MIN_PARTY = 6;
/** A pub crawl crew, not a function room. Bigger than this is a private hire. */
export const TABLE_REQUEST_MAX_PARTY = 20;
/** How far ahead a request may ask, in days. A pub does not plan a table further out from an app. */
export const TABLE_REQUEST_MAX_DAYS_AHEAD = 120;

const MAX_NAME = 60;
const MAX_NOTE = 300;
const MAX_VENUE_ID = 120;
const DAY_MS = 24 * 60 * 60 * 1000;

export const TABLE_REQUEST_CONTACT_KINDS = ["email", "phone"] as const;
export type TableRequestContactKind = (typeof TABLE_REQUEST_CONTACT_KINDS)[number];

/** Where a stored request got to. Only `emailed` is ever listed to an operator. */
export const TABLE_REQUEST_DELIVERIES = ["pending", "emailed"] as const;
export type TableRequestDelivery = (typeof TABLE_REQUEST_DELIVERIES)[number];

/** The validated request, with the account bound from the session, never the body. */
export type TableRequestFields = {
  venueId: string;
  requesterUserId: string;
  name: string;
  partySize: number;
  /** London calendar day, YYYY-MM-DD. */
  date: string;
  /** 24-hour clock, HH:MM. */
  time: string;
  note: string | null;
  contactKind: TableRequestContactKind;
  contactValue: string;
};

export type TableRequest = TableRequestFields & {
  id: string;
  delivery: TableRequestDelivery;
  createdAt: string;
  deliveredAt: string | null;
};

/**
 * What the operator panel shows for one request. The requester's own name and
 * the contact they chose for the pub to reply to, because replying is the whole
 * point. Never the requester's account id.
 */
export type OperatorTableRequest = {
  id: string;
  name: string;
  partySize: number;
  date: string;
  time: string;
  note: string | null;
  contactKind: TableRequestContactKind;
  contactValue: string;
  createdAt: string;
};

export function toOperatorTableRequest(request: TableRequest): OperatorTableRequest {
  return {
    id: request.id,
    name: request.name,
    partySize: request.partySize,
    date: request.date,
    time: request.time,
    note: request.note,
    contactKind: request.contactKind,
    contactValue: request.contactValue,
    createdAt: request.createdAt,
  };
}

// ── Words ────────────────────────────────────────────────────────────────────

export const TABLE_REQUEST_ACTION_LABEL = "Ask for a table";
export const TABLE_REQUEST_SEND_LABEL = "Send request";
export const TABLE_REQUEST_FREE_LINE =
  "For a crew of 6 to 20. Free. PUBMAXX takes no booking and no payment, and the pub replies to you.";
export const TABLE_REQUEST_SENT_LINE =
  "Sent to the pub. They reply to you, not to us. A reply is not promised.";
export const TABLE_REQUEST_NOT_SENT_LINE = "PUBMAXX did not send this.";
export const TABLE_REQUEST_EMAIL_FALLBACK_LINE =
  "Email the pub yourself. The message is written for you.";
export const TABLE_REQUEST_PHONE_FALLBACK_LINE = "Ring the pub and ask. Your request is below.";
export const TABLE_REQUEST_NO_CONTACT_LINE =
  "We have no published email or phone for this pub, so ask at the bar.";
export const TABLE_REQUEST_OPERATOR_HEADING = "Table requests";

// ── Validation ───────────────────────────────────────────────────────────────

export type TableRequestField =
  | "venueId"
  | "name"
  | "partySize"
  | "date"
  | "time"
  | "note"
  | "contact";

export type TableRequestValidation =
  | { ok: true; fields: TableRequestFields }
  | { ok: false; error: string; field: TableRequestField };

function refuse(field: TableRequestField, error: string): TableRequestValidation {
  return { ok: false, error, field };
}

/** A real London calendar day in YYYY-MM-DD, or null. */
function parseRequestDate(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }
  return raw.trim();
}

/** A 24-hour time in HH:MM, or null. */
function parseRequestTime(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(raw.trim());
  return match ? `${match[1]}:${match[2]}` : null;
}

/** A party size the form offers, or null. */
function parsePartySize(raw: unknown): number | null {
  const value = typeof raw === "string" && raw.trim() ? Number(raw) : raw;
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  return value >= TABLE_REQUEST_MIN_PARTY && value <= TABLE_REQUEST_MAX_PARTY ? value : null;
}

/** The contact the pub replies to, normalised, or null when it is not one of its kind. */
function parseRequestContact(
  kind: unknown,
  value: unknown,
): { kind: TableRequestContactKind; value: string } | null {
  if (kind === "email") {
    return isValidEmail(value) ? { kind, value: normalizeEmail(value) } : null;
  }
  if (kind === "phone") {
    const phone = parsePhoneNumber(typeof value === "string" ? value : null);
    return phone ? { kind, value: phone } : null;
  }
  return null;
}

function daysBetween(fromDay: string, toDay: string): number {
  return Math.round((Date.parse(`${toDay}T12:00:00Z`) - Date.parse(`${fromDay}T12:00:00Z`)) / DAY_MS);
}

/**
 * Validate an untrusted request against a server-verified account. Every
 * field is checked here and nowhere else, so the form and the route refuse the
 * same thing in the same words.
 */
export function validateTableRequest(
  raw: Record<string, unknown>,
  requesterUserId: string,
  now: number = Date.now(),
): TableRequestValidation {
  const account = typeof requesterUserId === "string" ? requesterUserId.trim() : "";
  if (!account) return refuse("name", "Sign in to ask for a table.");

  const venueId = typeof raw.venueId === "string" ? raw.venueId.trim() : "";
  if (!venueId || venueId.length > MAX_VENUE_ID) return refuse("venueId", "Pick a pub from the map.");

  const name = cleanText(raw.name, MAX_NAME);
  if (!name) return refuse("name", "Add the name the table is under.");

  const partySize = parsePartySize(raw.partySize);
  if (partySize === null) {
    return refuse(
      "partySize",
      `A table request is for ${TABLE_REQUEST_MIN_PARTY} to ${TABLE_REQUEST_MAX_PARTY} people.`,
    );
  }

  const date = parseRequestDate(raw.date);
  if (!date) return refuse("date", "Pick the day you want the table.");
  const ahead = daysBetween(londonCalendarDate(now), date);
  if (ahead < 0) return refuse("date", "That day has gone. Pick today or a later day.");
  if (ahead > TABLE_REQUEST_MAX_DAYS_AHEAD) {
    return refuse("date", `Pick a day in the next ${TABLE_REQUEST_MAX_DAYS_AHEAD} days.`);
  }

  const time = parseRequestTime(raw.time);
  if (!time) return refuse("time", "Pick a time.");

  const note = cleanText(raw.note, MAX_NOTE) || null;

  const contactRaw = raw.contact;
  const contactObject =
    contactRaw && typeof contactRaw === "object" && !Array.isArray(contactRaw)
      ? (contactRaw as Record<string, unknown>)
      : {};
  const contact = parseRequestContact(contactObject.kind, contactObject.value);
  if (!contact) {
    return refuse(
      "contact",
      contactObject.kind === "phone"
        ? "Add a phone number the pub can ring."
        : "Add an email address the pub can reply to.",
    );
  }

  return {
    ok: true,
    fields: {
      venueId,
      requesterUserId: account,
      name,
      partySize,
      date,
      time,
      note,
      contactKind: contact.kind,
      contactValue: contact.value,
    },
  };
}

// ── The message ──────────────────────────────────────────────────────────────

/** "Saturday 14 November", read as a London day. */
export function tableRequestDayLabel(date: string): string {
  const parsed = Date.parse(`${date}T12:00:00Z`);
  if (!Number.isFinite(parsed)) return date;
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "Europe/London",
  }).format(new Date(parsed));
}

type MessageInput = Pick<
  TableRequestFields,
  "name" | "partySize" | "date" | "time" | "note" | "contactKind" | "contactValue"
>;

function tableRequestSubject(venueName: string, request: MessageInput): string {
  return `Table for ${request.partySize} at ${venueName}, ${tableRequestDayLabel(request.date)}`;
}

/** The request in plain lines, the same words in the operator email and the person's own email. */
export function tableRequestLines(venueName: string, request: MessageInput): string[] {
  const reply =
    request.contactKind === "email"
      ? `Reply by email to ${request.contactValue}.`
      : `Reply by phone on ${request.contactValue}.`;
  return [
    `Hello ${venueName},`,
    `${request.name} would like a table for ${request.partySize} on ${tableRequestDayLabel(request.date)} at ${request.time}.`,
    ...(request.note ? [`Note: ${request.note}`] : []),
    reply,
  ];
}

/** The footer of the email PUBMAXX sends to a verified operator. */
export const TABLE_REQUEST_OPERATOR_FOOTER =
  "This request came through PUBMAXX. We take no booking and no payment. Reply to the person directly to say yes or no.";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** The email PUBMAXX sends to a verified operator: plain text and inline-styled HTML. */
export function tableRequestOperatorEmail(
  venueName: string,
  request: MessageInput,
): { subject: string; text: string; html: string } {
  const lines = [...tableRequestLines(venueName, request), TABLE_REQUEST_OPERATOR_FOOTER];
  return {
    subject: tableRequestSubject(venueName, request),
    text: lines.join("\n\n"),
    html: lines
      .map((line) => `<p style="margin:0 0 12px;font-family:Arial,sans-serif;font-size:15px;line-height:1.4">${escapeHtml(line)}</p>`)
      .join(""),
  };
}

/**
 * The person's own prefilled email to the pub's published address. Built in
 * the browser from the venue record, and sent by the person, never by us.
 */
export function tableRequestMailtoHref(
  pubEmailHref: string,
  venueName: string,
  request: MessageInput,
): string {
  const address = pubEmailHref.replace(/^mailto:/i, "");
  const subject = encodeURIComponent(tableRequestSubject(venueName, request));
  const body = encodeURIComponent(tableRequestLines(venueName, request).join("\n\n"));
  return `mailto:${address}?subject=${subject}&body=${body}`;
}

/** The days the date field offers: today through the last day a request may ask for. */
export function tableRequestDateBounds(now: number = Date.now()): { min: string; max: string } {
  const min = londonCalendarDate(now);
  const max = londonCalendarDate(Date.parse(`${min}T12:00:00Z`) + TABLE_REQUEST_MAX_DAYS_AHEAD * DAY_MS);
  return { min, max };
}
