import { jsonNoStore } from "@/lib/apiResponses";
import { publicApiError } from "@/lib/apiError";
import { DEFAULT_CITY_ID, parseCityId } from "@/lib/cities";
import { loadConciergeVenues } from "@/lib/concierge/venues.server";
import { getNightArea, isNightAreaRouteReady, publicNightAreaCoverage } from "@/lib/nightAreas";
import { haversineKm } from "@/lib/haversine";
import { cleanNightContext, cleanNightContextPatch, inferNightContext, type NightContext } from "@/lib/nightPlanning";
import type { PlanBudgetSummary, PlanningConfidence, PlanRouteTotals } from "@/lib/planIntelligence";
import { buildPlanEndingRecommendations } from "@/lib/planEndings";
import { getLateFoodForArea, normalizeLateFoodArea } from "@/lib/lateFood";
import { filterTonight, type WhatsOnRow } from "@/lib/whatsOn";
import { loadBaselineWhatsOn } from "@/lib/whatsOnStore";
import nightSignalSnapshot from "@/public/data/night_signals/latest.json";
import {
	activeNightSignalClaims,
	canAffectRoute,
	claimsForEntity,
	type NightSignalClaim,
} from "@/lib/nightSignalClaims";
import { isLimited } from "@/lib/pintDrops";
import type { PlanAccessibilityNeed } from "@/lib/planIntake";
import {
	parsePlanGenerationIntake,
	parsedPlanIntakeContextPatch,
	planCandidateAccessibility,
	planOpeningEvidenceForVenues,
	planVisitWindows,
	selectGroundedPlanRoute,
	type ParsedPlanGenerationIntake,
	type PlanConstraintReport,
	type PlanOpeningEvidence,
	type PlanStopConstraintFlag,
} from "@/lib/planRoute";
import { assertServerEnv } from "@/lib/serverEnv";
import { clientIp, hashIp, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS } from "@/lib/supabase";
import { planningWeatherForArea, type PlanningWeather } from "@/lib/weatherSnapshots";
import weatherSnapshot from "@/public/data/weather/latest.json";

assertServerEnv();

let baselineWhatsOn: WhatsOnRow[] | null = null;

function baselineTonight(now: number): WhatsOnRow[] {
  baselineWhatsOn ??= loadBaselineWhatsOn();
  return filterTonight(baselineWhatsOn, now);
}

function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
	return haversineKm([a.lng, a.lat], [b.lng, b.lat]);
}

function mergeContext(inferred: NightContext, raw: unknown): NightContext {
  const complete = cleanNightContext(raw);
  if (complete) return complete;
  const patch = cleanNightContextPatch(raw);
  return patch ? { ...inferred, ...patch } : inferred;
}

function scoreVenueForContext(
	venue: Awaited<ReturnType<typeof loadConciergeVenues>>[number],
	context: NightContext,
	distance: number,
	tonightEvents: readonly WhatsOnRow[],
	signalClaims: readonly NightSignalClaim[],
	weather: PlanningWeather | null,
): { score: number; reasons: string[] } {
	const reasons: string[] = [];
	const price = venue.cheapestPrice;
	let score = -distance * (context.daypart === "late_night" || context.daypart === "get_home" ? 3 : 2);

	if (context.budget === "value") {
		const boost = price === null ? 0 : Math.max(0, 7 - price);
		score += boost;
		if (price !== null) reasons.push(`pints from £${price.toFixed(2)}`);
	} else if (context.budget === "treat" && (venue.amenities.cocktails || venue.hasStory)) {
		score += 1.5;
		reasons.push("fits a treat-night brief");
	}
	if (context.budgetLimitPence && price !== null) {
		const perStopLimit = context.budgetLimitPence / 300;
		if (price <= perStopLimit) {
			score += 1.25;
			reasons.push("fits the explicit route budget");
		} else {
			score -= Math.min(3, price - perStopLimit);
		}
	}
	if (context.zeroProof) {
		if (venue.amenities.nonAlcoholic === true) {
			score += 3;
			reasons.push("confirmed 0.0 option in the Venue Dataset");
		} else {
			score -= 2;
		}
	}

	if (context.daypart === "after_work" && venue.canonical) {
		score += 1.25;
		reasons.push("reliable after-work anchor");
	}
	if ((context.daypart === "late_night" || context.daypart === "get_home") && venue.amenities.food) {
		score += 1.5;
		reasons.push("food-aware late stop");
	}
	if (context.partyType === "work" && venue.amenities.food) {
		score += 1;
		reasons.push("works for a group with food backup");
	}
	if ((context.groupSize ?? 0) >= 5 && venue.canonical) {
		score += 0.75;
		reasons.push("safer pick for a bigger group");
	}
	if (context.foodNeeds.length > 0 && venue.amenities.food) {
		score += 2;
		reasons.push("matched the food need at venue level");
	}
	if (context.atmosphere.includes("historic") && venue.hasStory) {
		score += 2;
		reasons.push("historic character");
	}
	if (context.atmosphere.includes("garden") && venue.amenities.beerGarden) {
		if (weather?.kind === "warm-dry") {
			score += 2;
			reasons.push(`beer garden on record; cached ${weather.source.publisher} weather supports it`);
		} else if (weather?.kind === "rainy" || weather?.kind === "cold") {
			score -= 1.5;
			reasons.push(`beer garden on record; cached weather is ${weather.kind}`);
		} else {
			score += 0.75;
			reasons.push("beer garden on record; weather evidence is unavailable or inconclusive");
		}
	}
	if (context.atmosphere.includes("sports") && venue.amenities.liveSports) {
		score += 1.5;
		reasons.push("sports-friendly");
	}
	if ((context.atmosphere.includes("music") || context.atmosphere.includes("lively")) && venue.amenities.liveMusic) {
		score += 1.25;
		reasons.push("livelier atmosphere signal");
	}
	if (context.atmosphere.includes("quiet") && (venue.amenities.liveMusic || venue.amenities.liveSports)) {
		score -= 2;
	}
	for (const event of tonightEvents) {
		const matchesBrief =
			(event.kind === "music" && (context.atmosphere.includes("music") || context.atmosphere.includes("lively"))) ||
			(event.kind === "sport" && context.atmosphere.includes("sports"));
		score += matchesBrief ? 2 : 0.5;
		reasons.push(`Tonight: ${event.title} (${event.confidence})`);
	}
	for (const signal of signalClaims) {
		if (canAffectRoute(signal)) score += signal.routeEffect === "boost" ? 2 : -3;
		reasons.push(`Reviewed signal: ${signal.claim}`);
	}

	return { score, reasons };
}

function evidenceWarning(code: string): string {
	return `Check ${code.replaceAll("_", " ")} before relying on this route.`;
}

function missingContextEvidence(context: NightContext): string[] {
	const missing = new Set<string>();
	if (context.accessibility.length > 0) missing.add("venue_accessibility");
	if (context.transportConstraints.length > 0) missing.add("per_venue_transport");
	if (context.zeroProof) missing.add("zero_proof_options");
	if (context.foodNeeds.some((need) => ["kebab", "halal", "vegan", "vegetarian"].includes(need))) {
		missing.add("food_terminal_specificity");
	}
	return [...missing];
}

/**
 * Best-effort planning warmup. It loads only the stable public venue index and
 * never creates a plan, records a location, or consumes a generation budget.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const cityId = parseCityId(url.searchParams.get("cityId") ?? "") ?? DEFAULT_CITY_ID;
  await loadConciergeVenues(cityId);
  baselineTonight(Date.now());
  return new Response(null, {
    status: 204,
    headers: { "cache-control": "no-store" },
  });
}

export async function POST(request: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; } catch { return publicApiError("Malformed request body.", "MALFORMED_REQUEST", 400); }
  const limiterKey = `plan-generate:${hashIp(clientIp(request))}`;
  if (await isLimited(limiterKey, limiterKey, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS)) return publicApiError("Too many requests.", "RATE_LIMITED", 429, { retryable: true });
	const requestNow = Date.now();
	let intake: ParsedPlanGenerationIntake | null = null;
	if (Object.prototype.hasOwnProperty.call(body, "intake")) {
		const parsed = parsePlanGenerationIntake(body.intake, new Date(requestNow));
		if (!parsed.ok) return publicApiError(parsed.message, parsed.code, 400);
		intake = parsed.value;
		if (intake.unsupportedPatch) {
			return publicApiError(
				"Exact Plan generation is not available for this Night Patch yet.",
				"NIGHT_PATCH_UNSUPPORTED",
				422,
				{ details: { patchId: intake.unsupportedPatch } },
			);
		}
	}
  const query = typeof body.query === "string" ? body.query.trim() : "";
  if (!query && !body.context && !intake?.exactNightArea) return publicApiError("Describe the night or provide Night Context.", "NIGHT_CONTEXT_REQUIRED", 400);
  const inferred = inferNightContext(query);
  const mergedContext = mergeContext(inferred.context, body.context);
  const context = intake ? { ...mergedContext, ...parsedPlanIntakeContextPatch(intake) } : mergedContext;
  if (!context.nightArea) return publicApiError("Choose an area.", "NIGHT_AREA_REQUIRED", 422);
  const cityId = typeof body.cityId === "string" ? parseCityId(body.cityId) : DEFAULT_CITY_ID;
  if (!cityId) return publicApiError("cityId is invalid.", "CITY_INVALID", 400);
  const area = getNightArea(context.nightArea);
  if (area.cityId !== cityId) return publicApiError("That area isn't in this city.", "NIGHT_AREA_CITY_MISMATCH", 422);
	const routeReady = isNightAreaRouteReady(area, new Date(requestNow));
	const coverage = publicNightAreaCoverage(area);
	if (intake?.exactNightArea && !isNightAreaRouteReady(area, new Date(requestNow))) {
		return publicApiError(
			`Grounded route generation is not ready for ${area.name} yet.`,
			"NIGHT_PATCH_ROUTE_NOT_READY",
			422,
			{ details: { patchId: intake.handoff.area?.id, nightArea: area.slug, missingEvidence: area.missingEvidence } },
		);
	}
	const visitWindows = intake ? planVisitWindows(intake) : [];
	if (visitWindows === null) {
		return publicApiError(
			"The dated time window is too short for three grounded stops.",
			"PLAN_TIME_WINDOW_INSUFFICIENT",
			422,
			{ details: { requiredMinutes: 170, windowEndIso: intake?.windowEndIso } },
		);
	}
	const planningWeather = planningWeatherForArea(weatherSnapshot, area.slug, requestNow);
	const tonightRows = baselineTonight(requestNow);
	const reviewedSignalClaims = activeNightSignalClaims(nightSignalSnapshot, requestNow);
	if (
		claimsForEntity(reviewedSignalClaims, "night_area", area.slug)
			.some((claim) => canAffectRoute(claim) && claim.routeEffect === "avoid")
	) {
		return publicApiError(
			"A reviewed active exclusion means this Night Area cannot be routed right now.",
			"NIGHT_AREA_CONSTRAINT_BLOCKED",
			422,
			{ details: { nightArea: area.slug } },
		);
	}
	const tonightByVenue = new Map<string, WhatsOnRow[]>();
	for (const row of tonightRows) {
		if (!row.venueId) continue;
		const current = tonightByVenue.get(row.venueId) ?? [];
		current.push(row);
		tonightByVenue.set(row.venueId, current);
	}
	  const candidates = (await loadConciergeVenues(cityId))
	    .map((venue) => {
	      const distance = distanceKm(area.centre, venue);
	      const tonightEvents = tonightByVenue.get(venue.id) ?? [];
	      const signalClaims = claimsForEntity(reviewedSignalClaims, "venue", venue.id);
	      const scored = scoreVenueForContext(venue, context, distance, tonightEvents, signalClaims, planningWeather);
	      return { venue, distance, tonightEvents, signalClaims, ...scored };
	    })
    .filter(({ distance, venue, signalClaims }) =>
		distance <= area.radiusKm
		&& venue.promoted !== true
		&& !signalClaims.some((claim) => canAffectRoute(claim) && claim.routeEffect === "avoid"))
    .sort((a, b) => b.score - a.score);
	type Candidate = (typeof candidates)[number];
	let chosen: Candidate[];
	let alternativesByPosition: readonly (readonly Candidate[])[] | null = null;
	let constraintReport: PlanConstraintReport | null = null;
	const selectedOpeningEvidence = new Map<string, PlanOpeningEvidence>();
	const selectedConstraintFlags = new Map<string, PlanStopConstraintFlag[]>();
	const alternativeOpeningEvidence = new Map<string, PlanOpeningEvidence>();
	const alternativeConstraintFlags = new Map<string, PlanStopConstraintFlag[]>();
	let accessibilityEnforced = false;
	if (intake) {
		const intakeAccessibilityIds = new Set<PlanAccessibilityNeed>([
			"step-free",
			"accessible-toilet",
			"seating",
			"low-noise",
		]);
		const requiredAccessibilityNeeds = [...new Set([
			...intake.handoff.accessibilityNeeds,
			...context.accessibility.filter((need): need is PlanAccessibilityNeed =>
				intakeAccessibilityIds.has(need as PlanAccessibilityNeed)),
		])];
		accessibilityEnforced = requiredAccessibilityNeeds.length > 0;
		const openingEvidence = await planOpeningEvidenceForVenues(
			candidates.map(({ venue }) => venue),
			visitWindows,
		);
		const selection = selectGroundedPlanRoute(
			candidates.map((candidate) => ({
				value: candidate,
				venueId: candidate.venue.id,
				venueName: candidate.venue.name,
				score: candidate.score,
				lat: candidate.venue.lat,
				lng: candidate.venue.lng,
				pricePence: candidate.venue.cheapestPrice === null
					? null
					: Math.round(candidate.venue.cheapestPrice * 100),
				promoted: candidate.venue.promoted === true,
				avoidedByReviewedSignal: candidate.signalClaims.some((claim) =>
					canAffectRoute(claim) && claim.routeEffect === "avoid"),
				accessibility: planCandidateAccessibility(candidate.venue.name, candidate.venue.area),
				opening: openingEvidence.get(candidate.venue.id) ?? { openAtVisit: [null, null, null], source: null },
			})),
			{
				exactArea: intake.exactNightArea,
				accessibilityNeeds: requiredAccessibilityNeeds,
				budgetLimitPence: context.budgetLimitPence,
				budgetTier: context.budget,
				groupSize: context.groupSize,
				transportConstraints: context.transportConstraints,
				visitWindows,
			},
		);
		if (!selection.ok) {
			return publicApiError(
				`No three-stop route in ${area.name} can satisfy every required constraint with the evidence available.`,
				"GROUNDED_CONSTRAINTS_UNSATISFIED",
				422,
				{ details: { nightArea: area.slug, availableVenueCount: candidates.length, ...selection } },
			);
		}
		chosen = selection.stops.map((stop) => {
			selectedOpeningEvidence.set(stop.venueId, stop.opening);
			selectedConstraintFlags.set(stop.venueId, stop.constraintFlags);
			return stop.value;
		});
		alternativesByPosition = selection.alternatives.map((alternatives, position) =>
			alternatives.map((alternative) => {
				const key = `${position}:${alternative.venueId}`;
				alternativeOpeningEvidence.set(key, alternative.opening);
				alternativeConstraintFlags.set(key, alternative.opening.openAtVisit[position] === null && visitWindows.length === 3
					? [{
						code: "opening_hours_unconfirmed",
						message: "Opening at this dated visit time is not confirmed. Check with the venue before relying on this stop.",
					}]
					: []);
				return alternative.value;
			}));
		constraintReport = selection.constraintReport;
	} else {
		chosen = candidates.slice(0, 3);
	}
  if (chosen.length < 3) return publicApiError(`Not enough grounded venues are available in ${area.name} yet.`, "GROUNDED_VENUES_INSUFFICIENT", 422, { details: { nightArea: area.slug, availableVenueCount: chosen.length } });
	const contextEvidenceGaps = missingContextEvidence(context);
	if (accessibilityEnforced) {
		const accessibilityGap = contextEvidenceGaps.indexOf("venue_accessibility");
		if (accessibilityGap >= 0) contextEvidenceGaps.splice(accessibilityGap, 1);
	}
	const operationalEvidenceGaps = intake?.exactStartIso
		&& chosen.every(({ venue }) => selectedOpeningEvidence.get(venue.id)?.openAtVisit.every((state) => state === true))
		? []
		: ["current_opening_hours"];
	if ((context.groupSize ?? 1) > 1) operationalEvidenceGaps.push("get_in_estimates");
	if (
		context.atmosphere.some((value) => ["lively", "music", "sports"].includes(value)) &&
		chosen.every(({ tonightEvents }) => tonightEvents.length === 0)
	) operationalEvidenceGaps.push("tonight_event_evidence");
	if (context.atmosphere.includes("garden") && !planningWeather) operationalEvidenceGaps.push("live_weather");
	if ((context.budgetLimitPence || context.budget === "value") && chosen.some(({ venue }) => venue.cheapestPrice === null)) {
		contextEvidenceGaps.push("price_evidence");
	}
	if (context.zeroProof && chosen.every(({ venue }) => venue.amenities.nonAlcoholic === true)) {
		const zeroProofGap = contextEvidenceGaps.indexOf("zero_proof_options");
		if (zeroProofGap >= 0) contextEvidenceGaps.splice(zeroProofGap, 1);
	}
	const missingEvidence = [...new Set([...area.missingEvidence, ...contextEvidenceGaps, ...operationalEvidenceGaps])];
	const confidenceScore = Math.max(0, Math.min(1, Math.min(inferred.confidence, coverage.coverageScore / 100)));
	const planningConfidence: PlanningConfidence = {
		level: routeReady ? (missingEvidence.length ? "medium" : "high") : "low",
		score: Number(confidenceScore.toFixed(2)),
		routeReady,
		missingEvidence,
		warnings: missingEvidence.map(evidenceWarning),
		provenance: [
			{ kind: "venue_dataset", label: "PUBMAXX Venue Dataset" },
			{ kind: "night_area_review", label: `${area.name} Night Area review`, asOf: area.lastReviewedAt },
			...(planningWeather ? [{
				kind: "night_signal" as const,
				label: `${planningWeather.source.publisher}: ${planningWeather.condition}`,
				asOf: planningWeather.observedAt,
			}] : []),
		],
	};
	const prices = chosen.map(({ venue }) => venue.cheapestPrice);
	const hasCompletePriceEvidence = prices.every((price): price is number => price !== null);
	const estimatedPerPersonPence = hasCompletePriceEvidence
		? prices.reduce((total, price) => total + Math.round(price * 100), 0)
		: null;
	const budgetSummary: PlanBudgetSummary = {
		currency: "GBP",
		limitPence: context.budgetLimitPence,
		estimatedPerPersonPence,
		estimatedCrewPence: estimatedPerPersonPence === null ? null : estimatedPerPersonPence * Math.max(1, context.groupSize ?? 1),
		withinLimit: context.budgetLimitPence === null || estimatedPerPersonPence === null ? null : estimatedPerPersonPence <= context.budgetLimitPence,
		basis: "one-recorded-pint-per-stop",
	};
	let straightLineWalkingKm = 0;
	for (let index = 0; index < chosen.length - 1; index += 1) {
		straightLineWalkingKm += distanceKm(chosen[index].venue, chosen[index + 1].venue);
	}
	const routeTotals: PlanRouteTotals = {
		stopCount: chosen.length,
		straightLineWalkingKm: Number(straightLineWalkingKm.toFixed(2)),
		estimatedWalkingMinutes: Math.ceil((straightLineWalkingKm / 4.8) * 60),
		distanceBasis: "straight-line",
	};
	const lastStop = chosen.at(-1)?.venue;
	const extensionCandidates = intake
		? context.budgetLimitPence !== null
			? []
			: [...new Map((alternativesByPosition ?? []).flat().map((candidate) => [candidate.venue.id, candidate])).values()].slice(0, 2)
		: candidates.slice(3, 5);
	const extensions = extensionCandidates.map(({ venue }) => ({
		venueId: venue.id,
		venueName: venue.name,
		distanceKm: lastStop ? distanceKm(lastStop, venue) : 0,
		estimatedPintPricePence: venue.cheapestPrice === null ? null : Math.round(venue.cheapestPrice * 100),
	}));
	const lateFoodArea = normalizeLateFoodArea(area.slug);
	const rankedLateFood = lateFoodArea ? getLateFoodForArea(lateFoodArea, context.foodNeeds, {
		from: lastStop ? { lat: lastStop.lat, lng: lastStop.lng } : null,
		now: requestNow,
	}) : [];
	const endingRecommendations = buildPlanEndingRecommendations({
		daypart: context.daypart,
		foodRequested: context.foodNeeds.length > 0,
		transportAnchor: area.transportAnchors[0] ?? area.name,
		lateFood: rankedLateFood,
		extensions,
	});
	const nightArea = { id: area.slug, ...coverage };
  return jsonNoStore({
    inferredContext: context,
    confidence: inferred.confidence,
		planningConfidence,
		budgetSummary,
		routeTotals,
		endingRecommendations,
		weatherEvidence: planningWeather,
		nightArea,
		...(constraintReport ? { constraintReport } : {}),
		// Back-compatible alias until every client has moved to Night Area.
		district: nightArea,
    explanations: inferred.reasons,
	    stops: chosen.map(({ venue, distance, reasons, tonightEvents, signalClaims }, index) => {
			const opening = selectedOpeningEvidence.get(venue.id) ?? null;
			const alternativeCandidates = alternativesByPosition?.[index]
				?? candidates.filter(({ venue: alternative }) =>
					!chosen.some(({ venue: selected }) => selected.id === alternative.id));
			return {
				venueId: venue.id,
				venueName: venue.name,
				position: index,
			distanceKm: Number(distance.toFixed(2)),
			estimatedPintPricePence: venue.cheapestPrice === null ? null : Math.round(venue.cheapestPrice * 100),
			evidence: reasons,
			constraintFlags: selectedConstraintFlags.get(venue.id) ?? [],
			operationalEvidence: {
				openingAtVisit: opening?.openAtVisit[index] ?? null,
				openingSource: opening?.source ?? null,
				visitWindow: visitWindows[index] ?? null,
				transportBasis: "compact-straight-line",
			},
			provenance: [
				{ kind: "venue_dataset", label: `PUBMAXX venue record for ${venue.name}` },
				{ kind: "night_area_review", label: `${area.name} Night Area review`, asOf: area.lastReviewedAt },
				...tonightEvents.map((event) => ({ kind: "night_signal" as const, label: `${event.source.label}: ${event.title}`, asOf: event.observedAt })),
				...signalClaims.map((signal) => ({ kind: "night_signal" as const, label: `${signal.publisher}: ${signal.claim}`, asOf: signal.observedAt })),
				...(opening?.source ? [{
					kind: "night_signal" as const,
					label: opening.source.label,
					asOf: opening.source.observedAt,
				}] : []),
				...(planningWeather ? [{
					kind: "night_signal" as const,
					label: `${planningWeather.source.publisher}: ${planningWeather.condition}`,
					asOf: planningWeather.observedAt,
				}] : []),
			],
				reason: `${distance < 0.5 ? "Close to the heart of the area" : `${distance.toFixed(1)} km from the area centre`}${reasons.length ? `, ${reasons.slice(0, 2).join(", ")}` : ""}.`,
				alternatives: alternativeCandidates
				.map(({ venue: alternative }) => {
					const key = `${index}:${alternative.id}`;
					const alternativeOpening = alternativeOpeningEvidence.get(key) ?? null;
					return {
						venueId: alternative.id,
						venueName: alternative.name,
						distanceKm: Number(distanceKm(venue, alternative).toFixed(2)),
						estimatedPintPricePence: alternative.cheapestPrice === null ? null : Math.round(alternative.cheapestPrice * 100),
						constraintFlags: alternativeConstraintFlags.get(key) ?? [],
						operationalEvidence: {
							openingAtVisit: alternativeOpening?.openAtVisit[index] ?? null,
							openingSource: alternativeOpening?.source ?? null,
							visitWindow: visitWindows[index] ?? null,
							transportBasis: "compact-straight-line",
						},
						provenance: [{ kind: "venue_dataset", label: `PUBMAXX venue record for ${alternative.name}` }],
					};
				})
				.sort((left, right) => left.distanceKm - right.distanceKm)
				.slice(0, 2),
			};
		}),
	    contextEffects: [
	      "budget",
	      "daypart",
	      ...(context.groupSize ? ["groupSize"] : []),
	      ...(context.partyType !== "friends" ? ["partyType"] : []),
	      ...(context.atmosphere.length ? ["atmosphere"] : []),
	      ...(context.foodNeeds.length ? ["foodNeeds"] : []),
			...(context.budgetLimitPence ? ["budgetLimitPence"] : []),
			...(context.zeroProof ? ["zeroProof"] : []),
			...(planningWeather ? ["weather"] : []),
	    ],
	    missingContextEvidence: contextEvidenceGaps,
	    relevantSignals: area.recentSignals,
		nightSignalClaims: reviewedSignalClaims.filter((claim) =>
			(claim.entity.type === "night_area" && claim.entity.id === area.slug) ||
			chosen.some(({ venue }) => claim.entity.type === "venue" && claim.entity.id === venue.id),
		),
	  });
}
