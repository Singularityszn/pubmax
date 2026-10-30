// Sunrise and sunset maths adapted from SunCalc 1.9.0
// (https://github.com/mourner/suncalc), inlined so stored weather rows need no
// sunset fields. SunCalc licence (BSD-2-Clause):
//
// Copyright (c) 2014, Vladimir Agafonkin
// All rights reserved.
//
// Redistribution and use in source and binary forms, with or without
// modification, are permitted provided that the following conditions are met:
//
//    1. Redistributions of source code must retain the above copyright notice,
//       this list of conditions and the following disclaimer.
//
//    2. Redistributions in binary form must reproduce the above copyright
//       notice, this list of conditions and the following disclaimer in the
//       documentation and/or other materials provided with the distribution.
//
// THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
// AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
// IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
// ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE
// LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
// CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
// SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
// INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
// CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
// ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
// POSSIBILITY OF SUCH DAMAGE.

import type { NightAreaSlug } from "@/lib/nightAreas";
import { coordsForNightArea } from "@/lib/weatherAreaCoords";

const PI = Math.PI;
const sin = Math.sin;
const cos = Math.cos;
const asin = Math.asin;
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
};

function daylightAt(latDeg: number, lngDeg: number, at: Date): DaylightAt {
  const { sunrise, sunset } = sunTimes(at, latDeg, lngDeg);
  const t = at.getTime();
  const isDay = t >= sunrise.getTime() && t < sunset.getTime();
  return { isDay, sunsetAt: sunset };
}

export function daylightForNightArea(slug: NightAreaSlug, at: Date): DaylightAt | null {
  const coords = coordsForNightArea(slug);
  if (!coords) return null;
  return daylightAt(coords[0], coords[1], at);
}

/**
 * Sunset and day or night for one map point at `at`. Null when the point is
 * not a usable coordinate or the calculation gives no valid sunset, so a
 * caller makes no sunset claim rather than a wrong one.
 */
export function daylightForPoint(latDeg: unknown, lngDeg: unknown, at: Date): DaylightAt | null {
  if (typeof latDeg !== "number" || typeof lngDeg !== "number") return null;
  if (!Number.isFinite(latDeg) || !Number.isFinite(lngDeg)) return null;
  if (Math.abs(latDeg) > 90 || Math.abs(lngDeg) > 180) return null;
  if (!Number.isFinite(at.getTime())) return null;
  const daylight = daylightAt(latDeg, lngDeg, at);
  return Number.isFinite(daylight.sunsetAt.getTime()) ? daylight : null;
}

// Sun position, from the same SunCalc 1.9.0 source and licence as above.
// SunCalc measures azimuth from south, positive to the west; this leaf turns it
// into a compass bearing (0 is north, 90 is east) because that is what a map
// reader and a ray cast both want. No atmospheric refraction is applied, so
// the altitude is the geometric one: within half a degree near the horizon.

function rightAscension(l: number, b: number): number {
  return Math.atan2(sin(l) * cos(e) - Math.tan(b) * sin(e), cos(l));
}

function siderealTime(d: number, lw: number): number {
  return rad * (280.16 + 360.9856235 * d) - lw;
}

export type SunPosition = {
  /** Compass bearing to the sun in degrees: 0 north, 90 east, 180 south. */
  azimuthDeg: number;
  /** Angle of the sun above the horizon in degrees; negative below it. */
  altitudeDeg: number;
};

/**
 * Where the sun stands in the sky over one point at one instant. Null when the
 * point or the instant is not usable, so a caller makes no sun claim at all.
 */
export function sunPosition(latDeg: unknown, lngDeg: unknown, at: Date): SunPosition | null {
  if (typeof latDeg !== "number" || typeof lngDeg !== "number") return null;
  if (!Number.isFinite(latDeg) || !Number.isFinite(lngDeg)) return null;
  if (Math.abs(latDeg) > 90 || Math.abs(lngDeg) > 180) return null;
  if (!Number.isFinite(at.getTime())) return null;
  const lw = rad * -lngDeg;
  const phi = rad * latDeg;
  const d = toDays(at);
  const M = solarMeanAnomaly(d);
  const L = eclipticLongitude(M);
  const dec = declination(L, 0);
  const H = siderealTime(d, lw) - rightAscension(L, 0);
  const azimuthFromSouth = Math.atan2(sin(H), cos(H) * sin(phi) - Math.tan(dec) * cos(phi));
  const altitude = asin(sin(phi) * sin(dec) + cos(phi) * cos(dec) * cos(H));
  const azimuthDeg = (((azimuthFromSouth / rad + 180) % 360) + 360) % 360;
  return { azimuthDeg, altitudeDeg: altitude / rad };
}
