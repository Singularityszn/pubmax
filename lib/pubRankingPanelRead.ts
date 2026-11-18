// What the Social panel's two reads say together for "Yours": the compared
// ranking and the star reviews it falls back to. Valid compared pubs answer
// at once, whatever the reviews are doing. An empty ranking needs the reviews
// before it can say anything. A definite refusal from either read wins, even
// after the rows are up.

export type PanelPart<T> = { kind: "pending" } | { kind: "refused" } | { kind: "unavailable" } | { kind: "ok"; value: T };

export type PanelMineOutcome<Compared, Star> =
  | { kind: "wait" }
  | { kind: "refused" }
  | { kind: "unavailable" }
  | { kind: "compared"; entries: Compared[] }
  | { kind: "stars"; stars: Star[] };

export function panelMineOutcome<Compared, Star>(
  rankings: PanelPart<Compared[]>,
  reviews: PanelPart<Star[]>,
): PanelMineOutcome<Compared, Star> {
  if (rankings.kind === "refused" || reviews.kind === "refused") return { kind: "refused" };
  if (rankings.kind === "pending") return { kind: "wait" };
  if (rankings.kind === "ok" && rankings.value.length > 0) return { kind: "compared", entries: rankings.value };
  // An empty or failed ranking waits for the reviews, so a refusal there still wins.
  if (reviews.kind === "pending") return { kind: "wait" };
  if (rankings.kind === "unavailable" || reviews.kind === "unavailable") return { kind: "unavailable" };
  return { kind: "stars", stars: reviews.value };
}
