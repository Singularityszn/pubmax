// The edges of one Pub Pal voice call: the warning before the cap, how a call
// that ended is carried on, and the minutes left to carry it on with.
//
// The cap and the monthly allowance are owned by lib/palVoiceMetering.ts.

import {
  billableVoiceMinutes,
  PAL_VOICE_GRANT_MINUTES,
  PAL_VOICE_MAX_SESSION_SECONDS,
  PAL_VOICE_MONTHLY_MINUTES,
} from "@/lib/palVoiceMetering";
import type { PalVoiceLine } from "@/lib/palVoiceTranscript";

/** The last stretch of a call: the agent is told to wrap up and the screen counts down. */
export const PAL_VOICE_WRAP_UP_SECONDS = 30;

export const PAL_VOICE_WRAP_UP_UPDATE =
  `About ${PAL_VOICE_WRAP_UP_SECONDS} seconds are left in this call. Finish the answer in one short sentence.`;

/** What the Pal says when the person taps Carry on, in place of its opening greeting. */
export const PAL_VOICE_RESUME_GREETING = "Right, where were we?";

/** Why a connected call ended in a way the person can carry on from. */
export type PalVoiceEndedWhy = "away" | "cap" | "pal";

export type PalVoiceEnded = {
  why: PalVoiceEndedWhy;
  /** Voice minutes left this month once this call settles. Null when the server did not say. */
  minutesLeft: number | null;
};

/** The person's own lines, oldest first: what a carried-on call is told they asked. */
export function palVoiceAsks(lines: readonly PalVoiceLine[]): string[] {
  return lines.filter((line) => line.speaker === "you").map((line) => line.text);
}

/**
 * Minutes left this month once the call that just ended settles. The grant
 * prepaid the whole cap, and settlement charges one minute per started minute
 * of the call (lib/palVoiceMetering.ts), so this mirrors what the server will
 * charge. The browser's clock runs a little past the cap, so it is held to it.
 * `usedMinutes` is the month's charge the grant reported, prepay included.
 */
export function palVoiceMinutesLeft(usedMinutes: number, callSeconds: number): number {
  const settled = usedMinutes - PAL_VOICE_GRANT_MINUTES + billableVoiceMinutes(Math.min(PAL_VOICE_MAX_SESSION_SECONDS, callSeconds));
  return Math.max(0, PAL_VOICE_MONTHLY_MINUTES - settled);
}

/** Leads the earlier-asks summary a carried-on call sends when it connects (PAL_VOICE_SESSION_SUMMARY_RULE). */
export const PAL_VOICE_RESUME_UPDATE_LEAD = "This call carries on from the person's last one, which ended.";

/** What the call says about itself once it has ended. */
export function palVoiceEndedStatus(why: PalVoiceEndedWhy, palName: string): string {
  if (why === "away") return `${palName} hung up while you were away`;
  return why === "cap" ? "Time's up for this call" : `${palName} ended the call`;
}

export function palVoiceMinutesLeftLine(minutes: number): string {
  if (minutes === 0) return "No voice minutes left this month";
  return `${minutes} ${minutes === 1 ? "minute" : "minutes"} of voice left this month`;
}

/** The /pal panel's one status line for the call. */
export function palVoicePanelStatus(call: { starting: boolean; live: boolean; speaking: boolean; ended: PalVoiceEnded | null; palName: string }): string {
  if (call.starting) return "Starting voice";
  if (call.live) return call.speaking ? "Pal is talking" : "Pal is listening";
  return call.ended ? palVoiceEndedStatus(call.ended.why, call.palName) : "Voice ready when you are";
}

/** The minutes left, shown once a call has ended and before the next tap. Null while a call runs or when unknown. */
export function palVoiceEndedHint(ended: PalVoiceEnded | null, idle: boolean): string | null {
  return idle && ended?.minutesLeft != null ? palVoiceMinutesLeftLine(ended.minutesLeft) : null;
}

/** Carry on stays off while a call is starting and once the month has no minutes left. */
export function palVoiceStartDisabled(starting: boolean, ended: PalVoiceEnded | null): boolean {
  return starting || ended?.minutesLeft === 0;
}
