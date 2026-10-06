/**
 * Server secret env var names whose values must be scrubbed from log strings.
 * Keep in sync with production-only keys in .env.example / lib/serverEnv.ts.
 */
export const PRODUCTION_SECRET_ENV_NAMES: readonly string[] = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "OPENROUTER_API_KEY",
  "TFL_APP_KEY",
  "TYPESAFE_API_KEY",
  "ADMIN_TOKEN",
  "CRON_SECRET",
  "RATE_LIMIT_SALT",
  "PLAN_IDEMPOTENCY_SECRET",
  "CLERK_SECRET_KEY",
  "ELEVENLABS_API_KEY",
  "ELEVENLABS_LLM_SHARED_SECRET",
  "APNS_PRIVATE_KEY",
  "FCM_PRIVATE_KEY",
  "SOCIAL_CONNECTION_ENCRYPTION_KEY",
  "VAPID_PRIVATE_KEY",
  "PUBMAX_ALERT_WEBHOOK_URL",
];
