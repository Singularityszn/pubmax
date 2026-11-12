import type { Route } from "next";

import shippedCodes from "@/lib/posterCodes.json";
import {
  isPosterMedium,
  POSTER_LANDING_SRC,
  posterNearHref,
  type PosterMedium,
} from "@/lib/posterLanding";

// Short links for printed posters and beer mats: pubmaxxing.com/get/<code>.
// lib/posterCodes.json is the closed list of minted codes, written by
// `npm run poster:mint`. A code goes live with the next deploy. Analytics
// records only a code from this list, so a typed or forged code cannot add a
// poster that was never printed.

export type PosterCode = {
  code: string;
  medium: PosterMedium;
  /** The pub or place the print run is for, as a slug. Sent as utm_source. */
  place: string;
  /** Optional campaign slug, for example launch-2026-11. Sent as utm_campaign. */
  campaign?: string;
};

const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
const CODE_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,22}[a-z0-9])?$/;

function isPosterSlug(value: unknown): value is string {
  return typeof value === "string" && SLUG_PATTERN.test(value);
}

function isPosterCodeShape(value: unknown): value is string {
  return typeof value === "string" && CODE_PATTERN.test(value);
}

/** Read the registry and refuse a bad one, so a hand edit fails the build. */
export function parsePosterCodes(raw: unknown): PosterCode[] {
  if (!Array.isArray(raw)) throw new Error("poster codes: the registry must be a JSON array");
  const seen = new Set<string>();
  return raw.map((entry: unknown, index) => {
    const row = (entry ?? {}) as Record<string, unknown>;
    const where = `poster codes: entry ${index}`;
    if (!isPosterCodeShape(row.code)) throw new Error(`${where}: code must be a lower-case slug of 1 to 24 characters`);
    if (seen.has(row.code)) throw new Error(`${where}: code ${row.code} is listed twice`);
    seen.add(row.code);
    if (!isPosterMedium(row.medium)) throw new Error(`${where}: medium must be poster or beermat`);
    if (!isPosterSlug(row.place)) throw new Error(`${where}: place must be a lower-case slug`);
    if (row.campaign !== undefined && !isPosterSlug(row.campaign)) {
      throw new Error(`${where}: campaign must be a lower-case slug`);
    }
    return {
      code: row.code,
      medium: row.medium,
      place: row.place,
      ...(row.campaign !== undefined ? { campaign: row.campaign as string } : {}),
    };
  });
}

const POSTER_CODES: readonly PosterCode[] = parsePosterCodes(shippedCodes);

/** A minted code, matched exactly. */
export function findPosterCode(
  code: string | null | undefined,
  codes: readonly PosterCode[] = POSTER_CODES,
): PosterCode | null {
  if (!code) return null;
  return codes.find((entry) => entry.code === code) ?? null;
}

/**
 * Where /get/<code> sends a scan. A minted code carries its utm tags. An
 * unknown code still lands on /near as a poster arrival, so a scuffed or
 * mistyped code never ends on a 404.
 */
export function posterCodeHref(
  rawCode: string,
  codes: readonly PosterCode[] = POSTER_CODES,
): Route {
  const entry = findPosterCode(rawCode.trim().toLowerCase(), codes);
  if (!entry) return posterNearHref({ src: POSTER_LANDING_SRC });
  return posterNearHref({
    src: POSTER_LANDING_SRC,
    utm_source: entry.place,
    utm_medium: entry.medium,
    ...(entry.campaign ? { utm_campaign: entry.campaign } : {}),
    utm_content: entry.code,
  });
}

export type PosterArrival = { medium: PosterMedium; code?: string };

/**
 * What a poster arrival on /near may tell analytics. The code counts only when
 * it is minted, and then its own medium wins. A long printed URL without a code
 * gives its utm_medium when that is a known medium.
 */
export function posterArrival(
  params: { get(name: string): string | null },
  codes: readonly PosterCode[] = POSTER_CODES,
): PosterArrival {
  const entry = findPosterCode(params.get("utm_content"), codes);
  if (entry) return { medium: entry.medium, code: entry.code };
  const medium = params.get("utm_medium");
  return { medium: isPosterMedium(medium) ? medium : "poster" };
}

export type PosterCodeRequest = {
  place: string;
  medium: string;
  campaign?: string;
  code?: string;
};

const MAX_MINT_ATTEMPTS = 32;

/** A new registry row. `randomCode` is only asked when no code was given. */
export function mintPosterCode(
  codes: readonly PosterCode[],
  request: PosterCodeRequest,
  randomCode: () => string,
): PosterCode {
  if (!isPosterMedium(request.medium)) throw new Error("--medium must be poster or beermat");
  if (!isPosterSlug(request.place)) {
    throw new Error("--place must be a lower-case slug, for example red-lion-se1");
  }
  if (request.campaign !== undefined && !isPosterSlug(request.campaign)) {
    throw new Error("--campaign must be a lower-case slug, for example launch-2026-11");
  }
  let code = request.code;
  if (code !== undefined) {
    if (!isPosterCodeShape(code)) throw new Error("--code must be a lower-case slug of 1 to 24 characters");
    if (findPosterCode(code, codes)) throw new Error(`code ${code} is already minted`);
  } else {
    for (let attempt = 0; attempt < MAX_MINT_ATTEMPTS && code === undefined; attempt += 1) {
      const candidate = randomCode();
      if (isPosterCodeShape(candidate) && !findPosterCode(candidate, codes)) code = candidate;
    }
    if (code === undefined) throw new Error("could not find a free code; pass --code");
  }
  return {
    code,
    medium: request.medium,
    place: request.place,
    ...(request.campaign !== undefined ? { campaign: request.campaign } : {}),
  };
}
