// The summon chip's one line (components/pubpal/PubPalSummon.tsx): what the
// person's Pal offers right now, from state the app already holds. Pure, so the
// clock and the stores are handed in.
//
// It never invents: a stop number is the person's own Night Mode cursor, and a
// kept night is the morning card's own marker. It never pushes a drink: the
// evening line offers a plan, and after midnight the Pal says get home safe.

export type PalSummonState = {
  /** The local hour, 0 to 23. */
  hour: number;
  muted: boolean;
  /** The stop the person has reached on a planned night that is on now. */
  nightOnStop: number | null;
  /** A finished night's morning card is still owed. */
  nightKept: boolean;
};

export function palSummonLine(state: PalSummonState): string {
  if (state.muted) return "Muted";
  if (state.nightOnStop !== null) return `Night's on. Stop ${state.nightOnStop + 1}`;
  if (state.nightKept && state.hour >= 5 && state.hour < 12) return "Morning. Last night's kept";
  if (state.hour < 5) return "Late one. Get home safe";
  if (state.hour < 12) return "Morning. Tap to plan tonight";
  if (state.hour < 17) return "Tap to talk or plan";
  return "Where to tonight?";
}
