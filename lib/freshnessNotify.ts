// Notification seam for the freshness-audit cron. TODAY this only logs — it is a
// deliberate seam so a later push/alert integration (Sol's push lane owns the
// actual delivery: lib/push*, sw.js) can hang off ONE place without the audit
// cron growing a delivery dependency now. This module MUST NOT send pushes.

import type { FreshnessResult } from "@/lib/freshness";

export type StaleFeedNotice = {
  id: string;
  label: string;
  status: FreshnessResult["status"];
  observedAt: string | null;
  ageHours: number | null;
  detail: string;
};

/**
 * Report stale/unknown feeds. Console-only by design (structured line per feed
 * so it is greppable in Vercel logs). Returns the notices it emitted so the cron
 * response can echo them. A future notifier can replace the body of this
 * function — callers and the response shape stay put.
 */
export function notifyStaleFeeds(stale: readonly FreshnessResult[]): StaleFeedNotice[] {
  const notices: StaleFeedNotice[] = stale.map((r) => ({
    id: r.id,
    label: r.label,
    status: r.status,
    observedAt: r.observedAt,
    ageHours: r.ageHours,
    detail: r.detail,
  }));

  if (notices.length === 0) {
    console.log("[freshness-audit] all tracked feeds within budget.");
    return notices;
  }

  console.warn(`[freshness-audit] ${notices.length} feed(s) breaching freshness:`);
  for (const notice of notices) {
    console.warn(
      `[freshness-audit]   ${notice.id} (${notice.status}) — ${notice.detail}` +
        (notice.observedAt ? ` observedAt=${notice.observedAt}` : ""),
    );
  }
  // Seam marker: a later alerting integration delivers `notices` from here.
  return notices;
}
