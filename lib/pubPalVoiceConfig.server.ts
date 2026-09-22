import "server-only";

export type PubPalVoiceReadiness = {
  available: boolean;
  reason?: "provider_unconfigured" | "durable_quota_store_required" | "reconciliation_unconfigured" | "spend_ceiling_unverified";
};

export function palVoiceConfigured(): boolean {
  return Boolean(
    process.env.ELEVENLABS_API_KEY?.trim() &&
    process.env.ELEVENLABS_PUB_PAL_AGENT_ID?.trim(),
  );
}

/** One deployment-wide readiness decision shared by token GET and POST. */
export function pubPalVoiceReadiness(supabaseConfigured: boolean): PubPalVoiceReadiness {
  if (!palVoiceConfigured()) {
    return { available: false, reason: "provider_unconfigured" };
  }
  if (process.env.NODE_ENV === "production" && !supabaseConfigured) {
    return { available: false, reason: "durable_quota_store_required" };
  }
  if (process.env.NODE_ENV === "production" && (
    !process.env.ELEVENLABS_PUB_PAL_WEBHOOK_SECRET?.trim() ||
    process.env.ELEVENLABS_PUB_PAL_WEBHOOK_CONFIGURED !== "true"
  )) {
    return { available: false, reason: "reconciliation_unconfigured" };
  }
  if (process.env.NODE_ENV === "production" && process.env.ELEVENLABS_PUB_PAL_SPEND_CEILING_CONFIRMED !== "true") {
    return { available: false, reason: "spend_ceiling_unverified" };
  }
  return { available: true };
}
