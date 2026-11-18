import "server-only";

// Warmup GET /api/plans/generate. The ping is unauthenticated and, by contract
// (docs/API_CONTRACTS_THE_LOCAL.md), not rate limited, so repeat hits must not
// each pay a What's-On store read: one run per city per TTL window, shared by
// every concurrent caller on the instance. The venue index memoises itself
// forever inside loadConciergeVenues; this latch covers the store read, whose
// result the warmup discards.

import type { CityId } from "@/lib/cities";
import { loadConciergeVenues } from "@/lib/concierge/venues.server";
import { loadPlanGenerationBaselineWhatsOn } from "@/lib/planGeneration.server";

const PLAN_WARMUP_TTL_MS = 60_000;

const warmups = new Map<CityId, { startedAt: number; run: Promise<void> }>();

/**
 * Best-effort planning warmup. It loads only the stable public venue index and
 * the What's-On baseline, and never creates a plan, records a location, or
 * consumes a generation budget.
 */
export function warmPlanGeneration(cityId: CityId): Promise<void> {
	const now = Date.now();
	const held = warmups.get(cityId);
	if (held && now - held.startedAt < PLAN_WARMUP_TTL_MS) return held.run;

	const run = (async () => {
		await loadConciergeVenues(cityId);
		await loadPlanGenerationBaselineWhatsOn(Date.now()).catch((error) => {
			console.warn(
				"[plans/generate] What's-On warmup degraded:",
				error instanceof Error ? error.message : String(error),
			);
		});
	})();
	warmups.set(cityId, { startedAt: now, run });
	// A rejected run must not poison the latch: the next ping retries.
	run.catch(() => {
		if (warmups.get(cityId)?.run === run) warmups.delete(cityId);
	});
	return run;
}

/** Test-only: clear the warmup latch between hermetic cases. */
export function __resetPlanWarmup(): void {
	warmups.clear();
}
