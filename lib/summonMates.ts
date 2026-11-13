// SUMMON YOUR MATES: "come to <pub> at <time>" from a pub's sheet. Pure leaf,
// safe for the browser and the route alike.
//
// The time is a London wall-clock time, "HH:MM", with no date: a summon is for
// tonight. It travels two ways. Signed in, the route sends each chosen mate a
// direct message with the pub attached (lib/summonMates.server.ts). Anyone can
// also share a link, `/map?sel=<id>&meet=<HH:MM>`, which opens the pub with the
// time on its action card. Nothing here counts anyone or says who is coming.

import type { Route } from "next";

import { venueMapUrl } from "@/lib/venueMapUrl";

/** The map parameter that carries a summon's time beside `sel`. */
const SUMMON_TIME_PARAM = "meet";

/** The most mates one summon reaches. */
export const SUMMON_MAX_MATES = 12;

export const SUMMON_ACTION_LABEL = "Summon mates";
export const SUMMON_SEND_FAILED_LINE = "We couldn't send that just now. Try again.";
export const SUMMON_NO_MATES_LINE =
  "No mates to summon yet. Mates are people you follow who follow you back.";
export const SUMMON_SIGNED_OUT_LINE = "Sign in to send it to your mates on PUBMAXX, or share a link.";

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** A valid "HH:MM" (24-hour), or null. */
export function parseSummonTime(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return TIME.test(trimmed) ? trimmed : null;
}

/** "20:00" → "8pm", "20:30" → "8:30pm", "00:15" → "12:15am", "12:00" → "12pm". */
export function formatSummonTime(time: string): string {
  const match = TIME.exec(time);
  if (!match) return time;
  const hours = Number(match[1]);
  const minutes = match[2]!;
  const suffix = hours < 12 ? "am" : "pm";
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return minutes === "00" ? `${hour12}${suffix}` : `${hour12}:${minutes}${suffix}`;
}

/** The words a mate receives, in a message and in a shared link alike. */
export function summonText(pubName: string, time: string): string {
  return `Come to ${pubName} at ${formatSummonTime(time)}?`;
}

/** The shared text: the invite and where the pub is. */
export function summonShareText(pubName: string, time: string): string {
  return `${summonText(pubName, time)} It's on the PUBMAXX map.`;
}

/** The pub's map link with the summon's time beside it. */
export function venueSummonUrl(venueId: string, time: string): Route {
  return `${venueMapUrl(venueId)}&${SUMMON_TIME_PARAM}=${encodeURIComponent(time)}` as Route;
}

/**
 * The time a shared link names for THIS pub, or null. A link for another pub,
 * or a malformed time, names nothing.
 */
export function summonTimeFromSearch(search: string, venueId: string): string | null {
  const params = new URLSearchParams(search);
  if (params.get("sel") !== venueId) return null;
  return parseSummonTime(params.get(SUMMON_TIME_PARAM));
}

/** The line a summoned mate reads on the pub's sheet. */
export function summonArrivalLine(time: string): string {
  return `Meet here at ${formatSummonTime(time)}.`;
}

/** The sender's receipt, naming exactly who the server says it reached. */
export function summonSentLine(handles: readonly string[]): string {
  const named = handles.map((handle) => `@${handle}`);
  const list =
    named.length <= 1
      ? named.join("")
      : `${named.slice(0, -1).join(", ")} and ${named[named.length - 1]}`;
  return `Sent to ${list}. They'll find it in Messages.`;
}

/**
 * The first suggested time: the next quarter hour at least 30 minutes from
 * now, on London's clock. Late at night it wraps past midnight.
 */
export function defaultSummonTime(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");
  const total = Math.ceil((hour * 60 + minute + 30) / 15) * 15;
  const wrapped = total % (24 * 60);
  const hh = String(Math.floor(wrapped / 60)).padStart(2, "0");
  const mm = String(wrapped % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}
