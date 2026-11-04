// THE SIGN FOUNDRY (wild idea 03, docs/plans/DESIGN_UX_PLAN.md section 12).
//
// A pub with no photograph gets a hanging sign drawn from its own name. The
// name is hashed, and the hash picks the board's shape, its paint, the colour
// of the lettering and the ornaments; the name's own words are then fitted to
// the board. The same name always draws the same sign, on every device, so a
// pub keeps its face.
//
// Pure and deterministic: no DOM, no clock, no randomness. The component
// (components/wild/PubSign.tsx) measures the real lettering after it paints and
// steps the size down when a reader's serif runs wider than this estimate.
//
// Honest by construction: a sign states the pub's NAME and nothing else it
// does not hold. "Since <year>" is printed only when the record carries a
// FOUNDING year (lib/heritageDate.mjs types every date), never a year that
// dates something else.

/** The board shapes, at least four by the brief. */
export const SIGN_SHAPES = ["notched", "arched", "shield", "swallowtail", "ogee"] as const;
export type SignShape = (typeof SIGN_SHAPES)[number];

/** Deep heritage paints. The hex values live in components/wild/pubSign.css. */
export const SIGN_PAINTS = ["oxblood", "bottle", "navy", "pitch", "plum", "umber", "peacock"] as const;
type SignPaint = (typeof SIGN_PAINTS)[number];

type SignInk = "gilt" | "cream";
type SignOrnament = "rules" | "diamonds" | "plain";

/** The stage every sign is drawn on, in SVG user units. */
export const SIGN_STAGE = { width: 360, height: 290 } as const;
/** The board's own box on that stage, before its shape is cut. */
export const SIGN_BOARD = { x: 60, y: 82, width: 240, height: 140 } as const;
/** Where the sign hangs from the bracket: the pivot of its swing. */
export const SIGN_PIVOT = { x: 180, y: 36 } as const;

const MAX_NAME_SIZE = 34;
/** The smallest the name is ever lettered; below it the line is squeezed instead. */
export const SIGN_MIN_NAME_SIZE = 13;
const MIN_NAME_SIZE = SIGN_MIN_NAME_SIZE;
const LINE_HEIGHT = 1.04;

type Box = { x: number; y: number; width: number; height: number };

export type SignRow = {
  kind: "the" | "name" | "since";
  text: string;
  /** Baseline, in stage units. */
  y: number;
  size: number;
  /** Letter spacing, in stage units. */
  spacing: number;
};

export type PubSignSpec = {
  /** The name as given, used for the accessible label. */
  name: string;
  shape: SignShape;
  paint: SignPaint;
  ink: SignInk;
  ornament: SignOrnament;
  /** A second fine gilt line inside the frame. */
  doubleFrame: boolean;
  caps: boolean;
  /** True when the name opened with "The", which is set small and italic. */
  the: boolean;
  /** The rest of the name in one or two lines. */
  lines: string[];
  /** The estimated name size; the component may step it down after measuring. */
  nameSize: number;
  since: string | null;
};

// FNV-1a, 32 bit. Small, stable and the same in every engine.
function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

// One xorshift step, so each choice reads its own bits rather than a slice of
// the same ones (shape and paint would otherwise move together).
function mix(seed: number): number {
  let x = seed || 0x9e3779b9;
  x ^= x << 13;
  x >>>= 0;
  x ^= x >>> 17;
  x ^= x << 5;
  return x >>> 0;
}

/** The hash a sign is drawn from: case, spacing and curly quotes do not change it. */
export function signSeed(name: string): number {
  const key = name.trim().toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, " ");
  return fnv1a(key);
}

// Advance widths of a classic text serif (Georgia's metrics, rounded), in em.
// An estimate only: the component measures what the reader's font really draws.
const WIDTHS: Record<string, number> = {
  A: 0.67, B: 0.65, C: 0.64, D: 0.73, E: 0.65, F: 0.6, G: 0.73, H: 0.82, I: 0.39, J: 0.51,
  K: 0.7, L: 0.6, M: 0.93, N: 0.77, O: 0.74, P: 0.61, Q: 0.74, R: 0.7, S: 0.56, T: 0.62,
  U: 0.76, V: 0.67, W: 1, X: 0.71, Y: 0.62, Z: 0.6,
  a: 0.5, b: 0.54, c: 0.44, d: 0.55, e: 0.48, f: 0.32, g: 0.49, h: 0.56, i: 0.29, j: 0.27,
  k: 0.51, l: 0.28, m: 0.84, n: 0.57, o: 0.53, p: 0.55, q: 0.53, r: 0.41, s: 0.42, t: 0.33,
  u: 0.56, v: 0.48, w: 0.73, x: 0.48, y: 0.48, z: 0.43,
  " ": 0.24, "&": 0.71, "'": 0.22, "’": 0.22, ".": 0.25, ",": 0.25, "-": 0.37,
};

/** The estimated width of `text` at 1 unit, letter spacing in em included. */
export function estimateTextEm(text: string, spacingEm = 0): number {
  let width = 0;
  for (const char of text) width += WIDTHS[char] ?? 0.58;
  return width + Math.max(0, [...text].length - 1) * spacingEm;
}

// Each shape loses some of its box to its own outline. The safe rectangle is
// where lettering may sit without touching the frame.
const SAFE_INSETS: Record<SignShape, { top: number; bottom: number; side: number }> = {
  notched: { top: 22, bottom: 20, side: 24 },
  arched: { top: 40, bottom: 20, side: 24 },
  shield: { top: 20, bottom: 44, side: 26 },
  swallowtail: { top: 20, bottom: 36, side: 24 },
  ogee: { top: 38, bottom: 20, side: 24 },
};

export function signSafeBox(shape: SignShape, board: Box = SIGN_BOARD): Box {
  const inset = SAFE_INSETS[shape];
  return {
    x: board.x + inset.side,
    y: board.y + inset.top,
    width: board.width - inset.side * 2,
    height: board.height - inset.top - inset.bottom,
  };
}

const CONNECTORS = new Set(["and", "&", "of", "the", "in", "on", "at", "by", "upon", "y"]);

function theSize(nameSize: number): number {
  return Math.round(Math.min(18, Math.max(11, nameSize * 0.5)));
}

const SINCE_SIZE = 10.5;
const ROW_GAP = 6;

/** Height the lettering block needs at a given name size. */
function blockHeight(lines: number, nameSize: number, the: boolean, since: boolean): number {
  let height = lines * nameSize * LINE_HEIGHT;
  if (the) height += theSize(nameSize) + ROW_GAP;
  if (since) height += SINCE_SIZE + ROW_GAP + 2;
  return height;
}

type Candidate = { lines: string[]; size: number; penalty: number };

function fitCandidate(lines: string[], caps: boolean, spacingEm: number, the: boolean, since: boolean, safe: Box): Candidate {
  const widest = Math.max(...lines.map((line) => estimateTextEm(caps ? line.toUpperCase() : line, spacingEm)));
  const byWidth = widest > 0 ? safe.width / widest : MAX_NAME_SIZE;
  let size = Math.min(MAX_NAME_SIZE, byWidth);
  // Shrink until the block fits the board's height too.
  while (size > MIN_NAME_SIZE && blockHeight(lines.length, size, the, since) > safe.height) size -= 0.5;
  const last = lines[0]?.split(" ").at(-1)?.toLowerCase() ?? "";
  // A line that ends on a connector ("Dog and / Duck") reads as broken.
  const penalty = lines.length > 1 && CONNECTORS.has(last) ? 0.12 : 0;
  return { lines, size: Math.max(MIN_NAME_SIZE, Math.floor(size * 2) / 2), penalty };
}

/**
 * The words of a name in one or two lines and the size they fit at. Two lines
 * win only when they let the name stand clearly larger than one line does.
 */
function fitSignLines(
  words: readonly string[],
  options: { caps: boolean; spacingEm: number; the: boolean; since: boolean; safe: Box },
): { lines: string[]; size: number } {
  const { caps, spacingEm, the, since, safe } = options;
  const one = fitCandidate([words.join(" ")], caps, spacingEm, the, since, safe);
  let best = one;
  for (let split = 1; split < words.length; split += 1) {
    const two = fitCandidate(
      [words.slice(0, split).join(" "), words.slice(split).join(" ")],
      caps,
      spacingEm,
      the,
      since,
      safe,
    );
    const score = two.size * (1 - two.penalty);
    const bestScore = best.size * (1 - best.penalty) * (best.lines.length === 1 ? 1.15 : 1);
    if (score > bestScore) best = two;
  }
  return { lines: best.lines, size: best.size };
}

/**
 * The founding year a sign may print, or null. Only a date typed as the pub's
 * FOUNDING and known to the year qualifies; "Built 17th century" and "Linked to
 * 1701" are not a "Since".
 */
export function signFoundingYear(
  record: { dateType?: string | null; datePrecision?: string | null; dateValue?: string | null } | null | undefined,
): string | null {
  if (!record || record.dateType !== "founding" || record.datePrecision !== "year") return null;
  const value = record.dateValue?.trim() ?? "";
  return /^\d{4}$/.test(value) ? value : null;
}

/**
 * The words a sign letters: the name without a trailing "(music venue)" or a
 * ", Shoreditch" that a listing adds to tell two pubs apart. A sign over the
 * door carries the pub's name, and the page around it still prints the rest.
 */
export function signLetteringName(name: string): string {
  let text = name.trim().replace(/\s+/g, " ");
  while (/\s*\([^()]*\)$/.test(text)) text = text.replace(/\s*\([^()]*\)$/, "").trim();
  const comma = text.indexOf(", ");
  if (comma > 0) text = text.slice(0, comma).trim();
  return text || name.trim();
}

/** Everything a sign is drawn from, decided by the name alone (plus a founding year). */
export function pubSignSpec(name: string, options: { foundingYear?: string | null } = {}): PubSignSpec {
  const full = name.trim().replace(/\s+/g, " ");
  const clean = signLetteringName(full);
  const seed = signSeed(clean);
  const a = mix(seed);
  const b = mix(a);
  const c = mix(b);
  const d = mix(c);
  const shape = SIGN_SHAPES[a % SIGN_SHAPES.length]!;
  const paint = SIGN_PAINTS[b % SIGN_PAINTS.length]!;
  const ink: SignInk = c % 4 === 0 ? "cream" : "gilt";
  const ornament = (["rules", "diamonds", "plain"] as const)[(c >>> 4) % 3]!;
  const doubleFrame = ((d >>> 3) & 1) === 1;
  const caps = ((d >>> 7) % 3) !== 0;

  const theMatch = /^the\s+(.+)$/i.exec(clean);
  const the = Boolean(theMatch);
  const rest = theMatch ? theMatch[1]! : clean;
  const words = rest.split(" ").filter(Boolean);
  const since = options.foundingYear && /^\d{4}$/.test(options.foundingYear) ? `Since ${options.foundingYear}` : null;
  const spacingEm = caps ? 0.06 : 0.01;
  const fitted = fitSignLines(words.length ? words : [clean], {
    caps,
    spacingEm,
    the,
    since: Boolean(since),
    safe: signSafeBox(shape),
  });

  return {
    name: full,
    shape,
    paint,
    ink,
    ornament,
    doubleFrame,
    caps,
    the,
    lines: fitted.lines,
    nameSize: fitted.size,
    since,
  };
}

/** The rows of lettering at a name size, centred in the board's safe box. */
export function signRows(spec: PubSignSpec, nameSize: number = spec.nameSize): SignRow[] {
  const safe = signSafeBox(spec.shape);
  const height = blockHeight(spec.lines.length, nameSize, spec.the, Boolean(spec.since));
  let y = safe.y + Math.max(0, (safe.height - height) / 2);
  const rows: SignRow[] = [];
  if (spec.the) {
    const size = theSize(nameSize);
    y += size * 0.86;
    rows.push({ kind: "the", text: "The", y, size, spacing: 0.5 });
    y += size * 0.14 + ROW_GAP;
  }
  const spacing = (spec.caps ? 0.06 : 0.01) * nameSize;
  for (const line of spec.lines) {
    y += nameSize * 0.78;
    rows.push({ kind: "name", text: spec.caps ? line.toUpperCase() : line, y, size: nameSize, spacing });
    y += nameSize * (LINE_HEIGHT - 0.78);
  }
  if (spec.since) {
    y += ROW_GAP + 2 + SINCE_SIZE * 0.8;
    rows.push({ kind: "since", text: spec.since.toUpperCase(), y, size: SINCE_SIZE, spacing: SINCE_SIZE * 0.22 });
  }
  return rows;
}

/** The widest a line of lettering may draw on this board, in stage units. */
export function signLineLimit(shape: SignShape): number {
  return signSafeBox(shape).width;
}

const f = (n: number) => Number(n.toFixed(2));

/**
 * The outline of a board, cut to its shape, inset by `inset` units (0 is the
 * board's edge; the gilt frame is drawn at a small inset).
 */
export function signBoardPath(shape: SignShape, inset = 0, board: Box = SIGN_BOARD): string {
  const x0 = board.x + inset;
  const y0 = board.y + inset;
  const x1 = board.x + board.width - inset;
  const y1 = board.y + board.height - inset;
  const w = x1 - x0;
  const h = y1 - y0;
  const cx = (x0 + x1) / 2;
  switch (shape) {
    case "notched": {
      const r = Math.max(5, 18 - inset * 0.7);
      return [
        `M${f(x0 + r)} ${f(y0)}`, `H${f(x1 - r)}`, `A${f(r)} ${f(r)} 0 0 0 ${f(x1)} ${f(y0 + r)}`,
        `V${f(y1 - r)}`, `A${f(r)} ${f(r)} 0 0 0 ${f(x1 - r)} ${f(y1)}`,
        `H${f(x0 + r)}`, `A${f(r)} ${f(r)} 0 0 0 ${f(x0)} ${f(y1 - r)}`,
        `V${f(y0 + r)}`, `A${f(r)} ${f(r)} 0 0 0 ${f(x0 + r)} ${f(y0)}`, "Z",
      ].join(" ");
    }
    case "arched": {
      const rise = board.height * 0.26 - inset * 0.4;
      const r = Math.max(3, 8 - inset * 0.5);
      return [
        `M${f(x0)} ${f(y0 + rise)}`, `A${f(w / 2)} ${f(rise)} 0 0 1 ${f(x1)} ${f(y0 + rise)}`,
        `V${f(y1 - r)}`, `Q${f(x1)} ${f(y1)} ${f(x1 - r)} ${f(y1)}`,
        `H${f(x0 + r)}`, `Q${f(x0)} ${f(y1)} ${f(x0)} ${f(y1 - r)}`, "Z",
      ].join(" ");
    }
    case "shield": {
      const c = Math.max(4, 12 - inset * 0.6);
      return [
        `M${f(x0 + c)} ${f(y0)}`, `H${f(x1 - c)}`, `L${f(x1)} ${f(y0 + c)}`,
        `V${f(y0 + h * 0.5)}`,
        `C${f(x1)} ${f(y0 + h * 0.82)} ${f(cx + w * 0.22)} ${f(y1 - h * 0.05)} ${f(cx)} ${f(y1)}`,
        `C${f(cx - w * 0.22)} ${f(y1 - h * 0.05)} ${f(x0)} ${f(y0 + h * 0.82)} ${f(x0)} ${f(y0 + h * 0.5)}`,
        `V${f(y0 + c)}`, "Z",
      ].join(" ");
    }
    case "swallowtail": {
      const c = Math.max(4, 12 - inset * 0.6);
      const notch = board.height * 0.17 - inset * 0.25;
      return [
        `M${f(x0 + c)} ${f(y0)}`, `H${f(x1 - c)}`, `L${f(x1)} ${f(y0 + c)}`,
        `V${f(y1)}`, `L${f(cx)} ${f(y1 - notch)}`, `L${f(x0)} ${f(y1)}`,
        `V${f(y0 + c)}`, "Z",
      ].join(" ");
    }
    case "ogee": {
      const crest = board.height * 0.24 - inset * 0.4;
      const r = Math.max(3, 8 - inset * 0.5);
      return [
        `M${f(x0)} ${f(y0 + crest)}`,
        `C${f(x0 + w * 0.28)} ${f(y0 + crest)} ${f(cx - w * 0.2)} ${f(y0)} ${f(cx)} ${f(y0)}`,
        `C${f(cx + w * 0.2)} ${f(y0)} ${f(x1 - w * 0.28)} ${f(y0 + crest)} ${f(x1)} ${f(y0 + crest)}`,
        `V${f(y1 - r)}`, `Q${f(x1)} ${f(y1)} ${f(x1 - r)} ${f(y1)}`,
        `H${f(x0 + r)}`, `Q${f(x0)} ${f(y1)} ${f(x0)} ${f(y1 - r)}`, "Z",
      ].join(" ");
    }
  }
}

/** Where the plaque's ring hangs: the lowest point of the board's centre line. */
export function signBottomCentre(shape: SignShape, board: Box = SIGN_BOARD): number {
  const y1 = board.y + board.height;
  if (shape === "swallowtail") return y1 - board.height * 0.17;
  return y1;
}

/** Where the two chains meet the board's top edge, so they clear an arch or a crest. */
export function signChainAnchors(shape: SignShape, board: Box = SIGN_BOARD): { left: [number, number]; right: [number, number] } {
  const inset = 34;
  const xl = board.x + inset;
  const xr = board.x + board.width - inset;
  let y = board.y + 3;
  if (shape === "arched") {
    // On the ellipse x²/a² + y²/b² = 1 at the anchor's x.
    const a = board.width / 2;
    const b = board.height * 0.26;
    const dx = (board.width / 2 - inset) / a;
    y = board.y + b - b * Math.sqrt(Math.max(0, 1 - dx * dx)) + 3;
  } else if (shape === "ogee") {
    // On the crest's left curve (signBoardPath "ogee"), found by sampling.
    const crest = board.height * 0.24;
    const p0 = [board.x, board.y + crest];
    const p1 = [board.x + board.width * 0.28, board.y + crest];
    const p2 = [board.x + board.width / 2 - board.width * 0.2, board.y];
    const p3 = [board.x + board.width / 2, board.y];
    let best = { dx: Number.POSITIVE_INFINITY, y: board.y + crest };
    for (let i = 0; i <= 200; i += 1) {
      const t = i / 200;
      const u = 1 - t;
      const at = (k: 0 | 1) => u * u * u * p0[k]! + 3 * u * u * t * p1[k]! + 3 * u * t * t * p2[k]! + t * t * t * p3[k]!;
      const dx = Math.abs(at(0) - xl);
      if (dx < best.dx) best = { dx, y: at(1) };
    }
    y = best.y + 3;
  }
  return { left: [xl, y], right: [xr, y] };
}

// ─────────────────────────────────────────────────────────────────────────────
// The swing. A board hung from one ring swings as a damped pendulum, and the
// price plaque hung under it is a second, lighter pendulum that its swing
// drives. Small angles, so the restoring force is linear. Degrees throughout.
// ─────────────────────────────────────────────────────────────────────────────

export type SignSwing = {
  /** The board's angle and its rate, degrees and degrees per second. */
  angle: number;
  velocity: number;
  /** The plaque's angle relative to the board, and its rate. */
  plaque: number;
  plaqueVelocity: number;
};

export const SIGN_AT_REST: SignSwing = { angle: 0, velocity: 0, plaque: 0, plaqueVelocity: 0 };

const BOARD_OMEGA = (2 * Math.PI) / 1.7;
const BOARD_DAMPING = 0.11;
const PLAQUE_OMEGA = (2 * Math.PI) / 0.75;
const PLAQUE_DAMPING = 0.16;
const PLAQUE_COUPLING = 0.55;
const MAX_ANGLE = 11;
const STEP = 1 / 240;

/** Advance the swing by `seconds`, in small steps so a long frame stays stable. */
export function stepSignSwing(state: SignSwing, seconds: number): SignSwing {
  const total = Math.min(Math.max(seconds, 0), 0.1);
  if (total === 0) return state;
  const steps = Math.max(1, Math.ceil(total / STEP));
  const dt = total / steps;
  let { angle, velocity, plaque, plaqueVelocity } = state;
  for (let i = 0; i < steps; i += 1) {
    const accel = -BOARD_OMEGA * BOARD_OMEGA * angle - 2 * BOARD_DAMPING * BOARD_OMEGA * velocity;
    velocity += accel * dt;
    angle += velocity * dt;
    const plaqueAccel =
      -PLAQUE_OMEGA * PLAQUE_OMEGA * plaque - 2 * PLAQUE_DAMPING * PLAQUE_OMEGA * plaqueVelocity - PLAQUE_COUPLING * accel;
    plaqueVelocity += plaqueAccel * dt;
    plaque += plaqueVelocity * dt;
  }
  angle = Math.max(-MAX_ANGLE, Math.min(MAX_ANGLE, angle));
  return { angle, velocity, plaque, plaqueVelocity };
}

/** A push: velocity added in degrees per second, its sign the direction. */
export function pushSign(state: SignSwing, impulse: number): SignSwing {
  const velocity = Math.max(-60, Math.min(60, state.velocity + impulse));
  return { ...state, velocity };
}

/** True once the sign hangs still enough to stop drawing frames. */
export function signAtRest(state: SignSwing): boolean {
  return (
    Math.abs(state.angle) < 0.03 &&
    Math.abs(state.velocity) < 0.15 &&
    Math.abs(state.plaque) < 0.03 &&
    Math.abs(state.plaqueVelocity) < 0.15
  );
}
