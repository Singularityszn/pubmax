import {
  filterTonightPubSurfaceRows,
  type TonightOutAnswer,
} from "@/lib/tonightOutListings";

/** The public Out answer serialized into Tonight's initial document. */
export function initialTonightOutAnswer(
  answer: TonightOutAnswer,
  now: number,
): TonightOutAnswer {
  if (!answer.body) return answer;
  const { body } = answer;
  const kept = new Set(filterTonightPubSurfaceRows(body.events, now));
  // The client uses one unmatched row to show its existing notice.
  const unmatched = body.events.find((row) => !row.venueId);
  if (unmatched) kept.add(unmatched);
  return {
    ...answer,
    body: { ...body, events: body.events.filter((row) => kept.has(row)) },
  };
}
