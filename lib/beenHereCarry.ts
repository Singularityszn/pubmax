// The browser half of "Been here" (lib/beenHere.ts holds the rules).
//
// A tap writes the device store at once and adds the pub to the carry set. The
// carry then moves the whole set to the signed-in account in ONE request to
// POST /api/saved-pubs, which adds and never toggles, so a repeat is harmless
// and a press made twice cannot take a pub back off. Nothing here writes the
// diary: a tap has no date, and the diary needs one.

import { authedFetch } from "@/lib/authedFetch";
import {
  BEEN_HERE_CARRY_ACTION,
  BEEN_HERE_LIST,
  carryAfterTap,
  carryBelongsTo,
  emitBeenHereChanged,
  readBeenHereCarry,
  writeBeenHereCarry,
} from "@/lib/beenHere";
import { discardBody } from "@/lib/responseBody";
import { getSaved, toggleSaveDurable } from "@/lib/savedPubs";

/** Whether this device's store holds the pub on Been here. */
export function deviceHasBeenHere(venueId: string): boolean {
  return getSaved().some((row) => row.venueId === venueId && row.listType === BEEN_HERE_LIST);
}

/**
 * One tap on the card. The device store answers first, so the pub is on this
 * device's Been here list whatever the network does; the carry set remembers
 * it for the account. `owner` is the signed-in account's id, or null signed
 * out. Resolves to whether the device now holds the pub.
 */
export async function tapBeenHere(
  venueId: string,
  wanted: boolean,
  owner: string | null,
): Promise<boolean> {
  // An empty handle keeps the write on this device: the account gets the
  // whole set in one carry rather than one request per tap.
  await toggleSaveDurable("", venueId, BEEN_HERE_LIST, undefined, "pub", wanted);
  writeBeenHereCarry(carryAfterTap(readBeenHereCarry(), venueId, wanted, owner));
  return deviceHasBeenHere(venueId);
}

export type BeenHereCarryOutcome = "carried" | "nothing" | "failed";

type CarryAnswer = { carried?: unknown; refused?: unknown };

/**
 * The sent ids the server has answered for, in the words it was sent them: a
 * pub now on the list (`carried`, even when it was there already) and a pub it
 * could not find (`refused`), which would never land and so leaves the set
 * rather than being asked for on every visit.
 */
function settledIds(answer: CarryAnswer, sent: readonly string[]): Set<string> {
  const settled = new Set<string>();
  for (const list of [answer.carried, answer.refused]) {
    if (!Array.isArray(list)) continue;
    for (const id of list) if (typeof id === "string") settled.add(id);
  }
  return new Set(sent.filter((id) => settled.has(id)));
}

let inFlight: Promise<BeenHereCarryOutcome> | null = null;

async function runCarry(handle: string, userId: string): Promise<BeenHereCarryOutcome> {
  const carry = readBeenHereCarry();
  if (!carry.venueIds.length || !carryBelongsTo(carry, userId)) return "nothing";
  const sent = carry.venueIds;
  let answer: CarryAnswer;
  try {
    const response = await authedFetch(
      "/api/saved-pubs",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ handle, action: BEEN_HERE_CARRY_ACTION, venueIds: sent }),
      },
      { requiresIdentity: true },
    );
    if (!response.ok) {
      discardBody(response);
      return "failed";
    }
    answer = (await response.json()) as CarryAnswer;
  } catch {
    return "failed";
  }
  const settled = settledIds(answer, sent);
  // Read the set again: a tap that landed while the request was out stays.
  const now = readBeenHereCarry();
  writeBeenHereCarry({
    owner: now.owner,
    venueIds: now.venueIds.filter((id) => !settled.has(id)),
  });
  const landed = Array.isArray(answer.carried) && answer.carried.length > 0;
  if (landed) emitBeenHereChanged();
  return settled.size ? "carried" : "failed";
}

/**
 * Move the card's waiting taps to the signed-in account that owns `handle`.
 * One request at a time per tab. Never throws; a failure keeps the set for the
 * next visit to the owner's own page.
 */
export function carryBeenHere(handle: string, userId: string): Promise<BeenHereCarryOutcome> {
  const h = handle.trim();
  if (!h || !userId) return Promise.resolve("nothing");
  inFlight ??= runCarry(h, userId).finally(() => {
    inFlight = null;
  });
  return inFlight;
}
