// The edges of one Pub Pal voice call: the warning before the cap, how a call
// that ended is carried on, and the minutes left to carry it on with.
//
// The cap and the monthly allowance are owned by lib/palVoiceMetering.ts.

import { PAL_VOICE_MONTHLY_MINUTES } from "@/lib/palVoiceMetering";
import type { PalVoiceLine } from "@/lib/palVoiceTranscript";
import type { PalAnimationState } from "@/lib/pubPal";

/** The last stretch of a call: the agent is told to wrap up and the screen counts down. */
export const PAL_VOICE_WRAP_UP_SECONDS = 30;

export function palVoiceSecondsLeft(endsAt: number, now: number): number {
  return Math.max(0, Math.ceil((endsAt - now) / 1_000));
}

export function palVoiceWrapUpUpdate(endsAt: number, now: number): string {
  return `About ${palVoiceSecondsLeft(endsAt, now)} seconds are left in this call. Finish the answer in one short sentence.`;
}

/** The resume greeting is used only when an earlier-asks summary reaches the new call. */
export const PAL_VOICE_RESUME_GREETING = "Right, where were we?";

/** Why a connected call ended in a way the person can carry on from. */
export type PalVoiceEndedWhy = "away" | "cap" | "pal";

export type PalVoiceEnded = {
  why: PalVoiceEndedWhy;
  minutesLeft: number | null;
};

/** The person's own lines, oldest first: what a carried-on call is told they asked. */
export function palVoiceAsks(lines: readonly PalVoiceLine[]): string[] {
  return lines.filter((line) => line.speaker === "you").map((line) => line.text);
}

export function palVoiceMinutesLeft(usedMinutes: number): number {
  return Math.max(0, PAL_VOICE_MONTHLY_MINUTES - usedMinutes);
}

export function palVoiceEndedWithUsage(ended: PalVoiceEnded | null, usedMinutes: number | null): PalVoiceEnded | null {
  return ended ? { ...ended, minutesLeft: usedMinutes === null ? null : palVoiceMinutesLeft(usedMinutes) } : null;
}

/** Leads the earlier-asks summary a carried-on call sends when it connects (PAL_VOICE_SESSION_SUMMARY_RULE). */
export const PAL_VOICE_RESUME_UPDATE_LEAD = "This call carries on from the person's last one, which ended.";

/** What the call says about itself once it has ended. */
export function palVoiceEndedStatus(why: PalVoiceEndedWhy, palName: string): string {
  if (why === "away") return `${palName} hung up while you were away`;
  return why === "cap" ? "Time's up for this call" : `${palName} ended the call`;
}

function palVoiceMinutesLeftLine(minutes: number): string {
  return `At least ${minutes} ${minutes === 1 ? "minute" : "minutes"} of voice left this month`;
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

export function palVoiceFaceState(starting: boolean, live: boolean, speaking: boolean, awaitingPal: boolean): PalAnimationState {
  if (starting) return "noticing";
  if (!live) return "idle";
  if (speaking) return "speaking";
  return awaitingPal ? "thinking" : "listening";
}
