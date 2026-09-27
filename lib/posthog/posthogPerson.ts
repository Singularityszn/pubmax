import { analyticsCollectionAllowed } from "@/lib/analytics";
import { loadPosthogClientForIdentity, syncPosthogConsent } from "@/lib/posthogClient";

const INTERNAL_USER_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isInternalAnalyticsUserId(value: string): boolean {
  return INTERNAL_USER_ID.test(value);
}

/**
 * Bind consented analytics to the signed-in account using Supabase user id only.
 * Never pass email, handle, or display name. Acts only when the person the SDK
 * holds differs from the session's, so token refreshes never reset the session.
 */
export function syncPosthogPersonIdentity(userId: string | null): void {
  if (typeof window === "undefined" || !analyticsCollectionAllowed()) return;
  void loadPosthogClientForIdentity().then((client) => {
    if (!client) return;
    const currentId = client.get_distinct_id();
    if (!userId) {
      if (isInternalAnalyticsUserId(currentId)) syncPosthogConsent(true);
      return;
    }
    if (!isInternalAnalyticsUserId(userId) || currentId === userId) return;
    client.identify(userId);
  }).catch(() => undefined);
}
