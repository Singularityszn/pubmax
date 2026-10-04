// Whether both Resend delivery keys are present.
//
// scripts/send_weekly_digest.mjs cannot import lib/emailProvider.ts, so this
// plain ESM module is the one configured-check. The script calls
// isEmailProviderConfigured. lib/emailProvider.ts isResendConfigured is the
// typed view over the same function. Both keys must be set. An API key with
// no From address is not configured. Nothing here sends mail.

/** True only when RESEND_API_KEY and EMAIL_FROM are both non-empty. */
export function isEmailProviderConfigured() {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}
