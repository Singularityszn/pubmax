// Pal moments: the few things a person does that their Pub Pal reacts to.
//
// A moment is announced once, in this tab, by the code that knows it happened
// (the crawl's "Mark complete", a planned night's saved ending), and every Pal
// on screen (the summon chip, the Pal on the map) reacts to it. It is a closed
// list. A moment is a celebration, never a score: nothing is counted, stored
// or sent, and nothing in the product branches on one.

const PAL_MOMENT_KINDS = ["crawl-finished", "night-finished"] as const;
export type PalMomentKind = (typeof PAL_MOMENT_KINDS)[number];

export type PalMoment = {
  kind: PalMomentKind;
  /** How many stops the crawl or night had. */
  stops: number;
};

const PAL_MOMENT_EVENT = "pubmax:pal-moment";

function palMomentFrom(value: unknown): PalMoment | null {
  if (!value || typeof value !== "object") return null;
  const { kind, stops } = value as Partial<PalMoment>;
  if (!PAL_MOMENT_KINDS.includes(kind as PalMomentKind)) return null;
  if (typeof stops !== "number" || !Number.isInteger(stops) || stops < 0) return null;
  return { kind: kind as PalMomentKind, stops };
}

export function announcePalMoment(moment: PalMoment): void {
  if (typeof window === "undefined") return;
  const checked = palMomentFrom(moment);
  if (!checked) return;
  window.dispatchEvent(new CustomEvent(PAL_MOMENT_EVENT, { detail: checked }));
}

export function subscribePalMoments(listener: (moment: PalMoment) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onMoment = (event: Event) => {
    const moment = palMomentFrom((event as CustomEvent).detail);
    if (moment) listener(moment);
  };
  window.addEventListener(PAL_MOMENT_EVENT, onMoment);
  return () => window.removeEventListener(PAL_MOMENT_EVENT, onMoment);
}
