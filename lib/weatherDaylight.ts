import type { NightAreaSlug } from "@/lib/nightAreas";
import { coordsForNightArea } from "@/lib/weatherAreaCoords";

// Sun position/times (SunCalc 1.9.0, MIT) — inlined so stored weather rows need no sunset fields.

const PI = Math.PI;
const sin = Math.sin;
const cos = Math.cos;
const tan = Math.tan;
const asin = Math.asin;
const atan = Math.atan2;
const acos = Math.acos;
const rad = PI / 180;
const dayMs = 1000 * 60 * 60 * 24;
const J1970 = 2440588;
const J2000 = 2451545;
const e = rad * 23.4397;
const J0 = 0.0009;

function toJulian(date: Date): number {
  return date.valueOf() / dayMs - 0.5 + J1970;
}

function fromJulian(j: number): Date {
  return new Date((j + 0.5 - J1970) * dayMs);
}

function toDays(date: Date): number {
  return toJulian(date) - J2000;
}

function rightAscension(l: number, b: number): number {
  return atan(sin(l) * cos(e) - tan(b) * sin(e), cos(l));
}

function declination(l: number, b: number): number {
  return asin(sin(b) * cos(e) + cos(b) * sin(e) * sin(l));
}

function solarMeanAnomaly(d: number): number {
  return rad * (357.5291 + 0.98560028 * d);
}

function eclipticLongitude(M: number): number {
  const C = rad * (1.9148 * sin(M) + 0.02 * sin(2 * M) + 0.0003 * sin(3 * M));
  const P = rad * 102.9372;
  return M + C + P + PI;
}

function sunDeclination(d: number): number {
  const M = solarMeanAnomaly(d);
  const L = eclipticLongitude(M);
  return declination(L, 0);
}

function julianCycle(d: number, lw: number): number {
  return Math.round(d - J0 - lw / (2 * PI));
}

function approxTransit(Ht: number, lw: number, n: number): number {
  return J0 + (Ht + lw) / (2 * PI) + n;
}

function solarTransitJ(ds: number, M: number, L: number): number {
  return J2000 + ds + 0.0053 * sin(M) - 0.0069 * sin(2 * L);
}

function hourAngle(h: number, phi: number, d: number): number {
  return acos((sin(h) - sin(phi) * sin(d)) / (cos(phi) * cos(d)));
}

function getSetJ(h: number, lw: number, phi: number, dec: number, n: number, M: number, L: number): number {
  const w = hourAngle(h, phi, dec);
  const a = approxTransit(w, lw, n);
  return solarTransitJ(a, M, L);
}

function sunTimes(date: Date, latDeg: number, lngDeg: number): { sunrise: Date; sunset: Date } {
  const lw = rad * -lngDeg;
  const phi = rad * latDeg;
  const d = toDays(date);
  const n = julianCycle(d, lw);
  const ds = approxTransit(0, lw, n);
  const M = solarMeanAnomaly(ds);
  const L = eclipticLongitude(M);
  const dec = sunDeclination(ds);
  const Jnoon = solarTransitJ(ds, M, L);
  const h0 = -0.833 * rad;
  const Jset = getSetJ(h0, lw, phi, dec, n, M, L);
  const Jrise = Jnoon - (Jset - Jnoon);
  return { sunrise: fromJulian(Jrise), sunset: fromJulian(Jset) };
}

export type DaylightAt = {
  isDay: boolean;
  sunsetAt: Date;
  sunriseAt: Date;
};

export function daylightAt(latDeg: number, lngDeg: number, at: Date): DaylightAt {
  const { sunrise, sunset } = sunTimes(at, latDeg, lngDeg);
  const t = at.getTime();
  const isDay = t >= sunrise.getTime() && t < sunset.getTime();
  return { isDay, sunsetAt: sunset, sunriseAt: sunrise };
}

export function daylightForNightArea(slug: NightAreaSlug, at: Date): DaylightAt | null {
  const coords = coordsForNightArea(slug);
  if (!coords) return null;
  return daylightAt(coords[0], coords[1], at);
}
