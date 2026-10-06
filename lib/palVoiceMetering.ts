import { PAL_VOICE_MAX_SESSION_SECONDS } from "@/lib/palVoiceCap.mjs";

export { PAL_VOICE_MAX_SESSION_SECONDS };

/** Monthly voice allowance in whole minutes (keyless and Supabase). */
export const PAL_VOICE_MONTHLY_MINUTES = 30;

/**
 * Minutes charged when a signed URL is issued: the whole session cap. The
 * server pays for the grant up front and the provider's own call duration
 * settles it afterwards, so the browser never reports a figure that is billed.
 */
export const PAL_VOICE_GRANT_MINUTES = Math.ceil(PAL_VOICE_MAX_SESSION_SECONDS / 60);

export type PalVoiceMeterState = {
  month: string;
  usedMinutes: number;
};

export function remainingVoiceMinutes(meter: PalVoiceMeterState): number {
  return Math.max(0, PAL_VOICE_MONTHLY_MINUTES - meter.usedMinutes);
}

/** Mirrors `settle_pub_pal_voice_conversation`: one billed minute per started minute. */
export function billableVoiceMinutes(durationSeconds: number): number {
  if (durationSeconds <= 0) return 0;
  return Math.max(1, Math.ceil(durationSeconds / 60));
}

/** A session is admitted while the month is under the limit, as in SQL. */
export function canPrepayVoiceGrant(meter: PalVoiceMeterState): boolean {
  return meter.usedMinutes < PAL_VOICE_MONTHLY_MINUTES;
}
