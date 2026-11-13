/** The most mates one read ranks, so a large follow graph stays a bounded read. */
export const MATES_BOARD_MAX_MATES = 50;

export type MatesBoardRow = {
  handle: string;
  /** True for the reader's own row. */
  self: boolean;
  total: number;
  level: number;
};

export type MatesBoardAnswer = {
  /** "degraded" when somebody's records did not all load, so a total may be low. */
  status: "ready" | "degraded";
  /** True when the reader has more mates than one read ranks. */
  capped: boolean;
  rows: MatesBoardRow[];
};

export type RankedMatesBoardRow = MatesBoardRow & { place: number; points: number };

/**
 * The rows in board order: most points first, then by handle.
 * Equal points share a place, and the next place skips, so 1, 1, 3.
 */
export function rankMatesBoard(rows: readonly MatesBoardRow[]): RankedMatesBoardRow[] {
  const sorted = rows
    .map((row) => ({ ...row, points: row.total }))
    .sort((a, b) => b.points - a.points || a.handle.localeCompare(b.handle, "en-GB"));
  let place = 0;
  return sorted.map((row, index) => {
    if (index === 0 || row.points !== sorted[index - 1]!.points) place = index + 1;
    return { ...row, place };
  });
}

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function parseRow(value: unknown): MatesBoardRow | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const total = count(row.total);
  const level = count(row.level);
  if (typeof row.handle !== "string" || !row.handle || total === null || level === null) {
    return null;
  }
  return { handle: row.handle, self: row.self === true, total, level };
}

/** The route's answer, or null when it is not one. */
export function parseMatesBoard(value: unknown): MatesBoardAnswer | null {
  if (!value || typeof value !== "object") return null;
  const answer = value as Record<string, unknown>;
  if (answer.status !== "ready" && answer.status !== "degraded") return null;
  if (!Array.isArray(answer.rows)) return null;
  const rows = answer.rows.map(parseRow);
  if (rows.some((row) => row === null)) return null;
  return {
    status: answer.status,
    capped: answer.capped === true,
    rows: rows as MatesBoardRow[],
  };
}

export const MATES_BOARD_COPY = {
  kicker: "Points",
  title: "You and your mates",
  lede: "Ranked by points from each person's own records. Only mutual mates see each other here.",
  you: "You",
  noMatesTitle: "No mates on the board yet.",
  noMatesBody: "A mate is someone you follow who follows you back. Find your lot on Social, and they land here.",
  capped: `Showing you and your first ${MATES_BOARD_MAX_MATES} mates by handle.`,
  degraded: "Some records didn't load, so a total may be low. Try again later.",
  loading: "Reading your mates' points.",
  error: "We could not read the board.",
  signIn: "Sign in to see where you stand with your mates.",
  /** The door from the profile's points card and from Social. */
  door: "See you and your mates",
} as const;
