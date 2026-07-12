import type { PlanState } from "@/lib/plan";

function startLabel(startTime: string): string {
  const parsed = Date.parse(startTime);
  if (!Number.isFinite(parsed)) return "Time to be confirmed";
  return new Date(parsed).toLocaleTimeString("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function planViewModel(state: PlanState) {
  return {
    title: state.plan.title,
    startLabel: startLabel(state.plan.startTime),
    stops: state.stops.slice().sort((a, b) => a.position - b.position),
    crew: state.crew.slice().sort((a, b) => a.joinedAt.localeCompare(b.joinedAt)),
  };
}

export function shareCopyForPlan(state: PlanState): string {
  const view = planViewModel(state);
  const stopWord = view.stops.length === 1 ? "stop" : "stops";
  return `${view.title} · ${view.stops.length} ${stopWord} · Starts ${view.startLabel} — see the plan and tap I'm in.`;
}

export function stopsFromConcierge(
  venues: ReadonlyArray<{ id: string; name: string }>,
): Array<{ venueId: string; venueName: string }> {
  return venues.slice(0, 8).flatMap((venue) => {
    const venueId = venue.id.trim();
    const venueName = venue.name.trim();
    return venueId && venueName ? [{ venueId, venueName }] : [];
  });
}

// C3 — the concierge "Sort it" button posts a free-text query that can land on
// either /api/concierge response shape: ranked venues (mood queries) or
// grounded What's-On listings (occasion templates whose text names a kind —
// "pub quiz tonight", "screening live sport" — see lib/concierge/whatsOn.ts's
// detectWhatsOnIntent). lib/conciergeAskClient's answerFromBody already
// normalises both shapes into one card list; this just threads those cards
// through the same venueId/venueName stop shape as stopsFromConcierge, honestly
// dropping any card whose venueId never resolved (never invents a stop).
export function stopsFromAnswerCards(
  cards: ReadonlyArray<{ venueId: string; title: string }>,
): Array<{ venueId: string; venueName: string }> {
  return stopsFromConcierge(
    cards.map((card) => ({ id: card.venueId, name: card.title })),
  );
}
