// The in-tab notes pub crawl bingo reads (lib/crawlBingo.ts).
//
// An existing surface that already records an action (a kept price, a wall
// photo, a heritage answer, the Lore tab) calls noteCrawlBingoAction with the
// pub it was about. The note is kept only while a plan is on tonight, it names
// that plan, and it lives in this tab's memory alone: nothing is written to
// storage, nothing is sent, and a reload starts the card again. That is the
// whole lifecycle, so this is a note pad, never a store.
//
// The Night Mode card is unmounted on /map, where the venue sheet lives, so a
// window event alone would be missed. Module memory survives a client-side
// route change, so the card reads what was noted when it mounts again.

import { isPlanActiveNow, readActivePlan } from "@/lib/activePlan";
import { isCrawlBingoNoteKind, type CrawlBingoNote, type CrawlBingoNoteKind } from "@/lib/crawlBingo";

const MAX_NOTES = 200;
const CHANGE_EVENT = "pubmax:crawl-bingo-note";

let notes: readonly CrawlBingoNote[] = [];

/** Note an action for the plan that is on tonight. A no-op when none is. */
export function noteCrawlBingoAction(kind: CrawlBingoNoteKind, venueId: string, now: number = Date.now()): void {
  if (typeof window === "undefined") return;
  if (!isCrawlBingoNoteKind(kind) || typeof venueId !== "string" || !venueId) return;
  const ref = readActivePlan();
  if (!ref || !isPlanActiveNow(ref, now)) return;
  if (notes.some((note) => note.planId === ref.id && note.venueId === venueId && note.kind === kind)) return;
  notes = [...notes, { planId: ref.id, venueId, kind, at: now }].slice(-MAX_NOTES);
  try {
    window.dispatchEvent(new Event(CHANGE_EVENT));
  } catch {
    // The note is kept; a listener reads it on its next mount.
  }
}

/** Every note in this tab. The array is replaced on change, never mutated. */
export function readCrawlBingoNotes(): readonly CrawlBingoNote[] {
  return notes;
}

export function subscribeCrawlBingoNotes(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(CHANGE_EVENT, listener);
  return () => window.removeEventListener(CHANGE_EVENT, listener);
}

/** Test seam: forget every note. */
export function resetCrawlBingoNotesForTest(): void {
  notes = [];
}
