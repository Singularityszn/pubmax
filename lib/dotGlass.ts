// The dot pint glass: a nonic pint drawn as a honeycomb of dots. One outline
// for every glass on the site, so the Year in Pints glass
// (lib/yearInPintsDotGlass.ts) and the empty and spilled glasses on the 404
// and error pages (components/brand/DotGlassArt.tsx) are the same pint.
//
// Points come bottom row first, so a caller that colours "the first n" fills
// the glass from the bottom, the way a pint is poured.

export type GlassPoint = { x: number; y: number };

/** The outline: a pint that widens toward the rim, with a nonic bulge below it. */
function glassWidthAt(t: number, base: number, rim: number): number {
  const taper = base + (rim - base) * t;
  const bulge = t > 0.72 && t < 0.92 ? Math.sin(((t - 0.72) / 0.2) * Math.PI) * rim * 0.05 : 0;
  return taper + bulge;
}

/** How many dots each row seats, bottom row first. */
function rowCapacities(width: number, height: number, spacing: number): number[] {
  const base = width * 0.74;
  const rim = width * 0.94;
  const rowStep = spacing * (Math.sqrt(3) / 2);
  const rows: number[] = [];
  // A row is seated only when its whole dot fits under the rim.
  for (let y = spacing / 2; y + spacing / 2 <= height; y += rowStep) {
    let n = Math.max(1, Math.floor(glassWidthAt(y / height, base, rim) / spacing));
    // Neighbouring rows differ in parity, so each centred row sits half a dot
    // across from the one below and the lattice packs as a honeycomb.
    const below = rows[rows.length - 1];
    if (below !== undefined && n % 2 === below % 2) n = n > 1 ? n - 1 : n + 1;
    rows.push(n);
  }
  return rows;
}

/** How many dots a glass of this size seats at this spacing. */
export function glassCapacity(width: number, height: number, spacing: number): number {
  return rowCapacities(width, height, spacing).reduce((sum, n) => sum + n, 0);
}

/**
 * The glass's dots, bottom row first. With `count`, it stops after that many,
 * and a part-filled top row is centred.
 */
export function glassPoints(width: number, height: number, spacing: number, count = Infinity): GlassPoint[] {
  const rowStep = spacing * (Math.sqrt(3) / 2);
  const capacities = rowCapacities(width, height, spacing);
  const points: GlassPoint[] = [];
  for (let row = 0; row < capacities.length && points.length < count; row += 1) {
    const n = Math.min(capacities[row] ?? 0, count - points.length);
    const y = height - spacing / 2 - row * rowStep;
    for (let k = 0; k < n; k += 1) {
      const x = width / 2 + (k - (n - 1) / 2) * spacing;
      points.push({ x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 });
    }
  }
  return points;
}
