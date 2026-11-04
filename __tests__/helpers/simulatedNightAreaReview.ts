// Exercise the price-list algorithm with a simulated review decision. This
// test adapter is not a review source and does not certify production areas.
export async function simulatedNightAreas(importOriginal: () => Promise<typeof import("@/lib/nightAreas")>) {
  const actual = await importOriginal();
  const areas = actual.NIGHT_AREAS.map((area) => {
    if (!["clapham", "victoria", "canary-wharf"].includes(area.slug)) return area;
    return {
      ...area, coverageStatus: "route_ready" as const, missingEvidence: [],
      lastReviewedAt: "2026-01-01T00:00:00.000Z", reviewExpiresAt: "2027-01-01T00:00:00.000Z",
      routeReadyReasons: area.gate.checks.map((check) => check.code),
      gate: { ...area.gate, passed: true, checks: area.gate.checks.map((check) => ({ ...check, passed: true, observed: "simulated", evidenceRefs: ["test-review"] })) },
    };
  });
  const hasSimulatedReview = (area: (typeof areas)[number]) => area.coverageStatus === "route_ready"
    && area.gate.version === 1 && area.gate.passed && area.missingEvidence.length === 0
    && area.routeReadyReasons.length === 10 && area.gate.checks.length === 10
    && area.gate.checks.every((check) => check.passed && check.evidenceRefs.includes("test-review"));
  return { ...actual, NIGHT_AREAS: areas,
    getNightArea: (slug: string) => areas.find((area) => area.slug === slug),
    nightAreaHasRouteReadyProof: hasSimulatedReview,
    isNightAreaRouteReady: (area: (typeof areas)[number], now = new Date()) => hasSimulatedReview(area) && Date.parse(area.reviewExpiresAt ?? "") > now.getTime(),
  };
}
