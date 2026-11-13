import type { Route } from "next";
import { parseCityId } from "@/lib/cities";
import { safeInviteReturnTo } from "@/lib/inviteReturnTo";
import { isPlanId } from "@/lib/planId";
import { safeTableRequestReturnTo } from "@/lib/tableRequestIntent";

const RETURN_ORIGIN = "https://pubmax.invalid";

export function safePlanReturnTo(raw: string | null | undefined): Route | null {
  if (typeof raw !== "string") return null;
  const candidate = raw.trim();
  if (
    !candidate.startsWith("/") ||
    candidate.startsWith("//") ||
    candidate.includes("\\") ||
    candidate.includes("?") ||
    candidate.includes("#")
  ) {
    return null;
  }
  try {
    const url = new URL(candidate, RETURN_ORIGIN);
    if (url.origin !== RETURN_ORIGIN || url.search || url.hash) return null;
    const planId = url.pathname.slice("/plan/".length);
    return url.pathname.startsWith("/plan/") && isPlanId(planId)
      ? (url.pathname as Route)
      : null;
  } catch {
    return null;
  }
}

const PINT_DROP_DOOR_KEYS = new Set(["sel", "log", "price"]);

/**
 * The Pint Drop composer's own door (`pintDropDoorHref` in lib/landingHero.ts):
 * one pub, the log intent, and the figure the drinker set, in the two-decimal
 * form that builder writes. "Sign in to post" carries it, so a new account
 * returns to the same composer whichever login door it took.
 */
export function safePintDropDoorReturnTo(raw: string | null | undefined): Route | null {
  const address = /^(\/map(?:\/([a-z]+))?)\?([^#\\]*)$/.exec(raw ?? "");
  if (!address || (address[2] && !parseCityId(address[2]))) return null;
  const params = new URLSearchParams(address[3]);
  const keys = [...params.keys()];
  if (keys.some((key) => !PINT_DROP_DOOR_KEYS.has(key)) || new Set(keys).size !== keys.length) return null;
  const venueId = params.get("sel");
  const price = params.get("price");
  if (!venueId || !/^[\w:-]{1,200}$/.test(venueId) || params.get("log") !== "1") return null;
  if (price !== null && (!/^\d{1,4}\.\d{2}$/.test(price) || Number(price) <= 0)) return null;
  const door = new URLSearchParams({ sel: venueId, log: "1", ...(price === null ? {} : { price }) });
  return `${address[1]}?${door.toString()}` as Route;
}

/** A page the claim surface may hand a new account back to, or null. */
function accountClaimReturnTo(raw: string | null | undefined): Route | null {
  return safeInviteReturnTo(raw)
    ?? safePlanReturnTo(raw)
    ?? safeTableRequestReturnTo(raw)
    ?? safePintDropDoorReturnTo(raw)
    ?? safeStillTrueReturnTo(raw);
}

const STILL_TRUE_CREW_PATH = /^\/social\/crews\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * The one-pub night's return. Same shape as the Pint Drop door (#2802): the
 * page the person was on, plus the one flag that they already tapped.
 * Callers: accountClaimReturnTo, addLinkAwareDestination, handleClaimRouteAfterSignIn.
 */
export function safeStillTrueReturnTo(raw: string | null | undefined): Route | null {
  if (typeof raw !== "string") return null;
  const candidate = raw.trim();
  if (
    !candidate.startsWith("/") ||
    candidate.startsWith("//") ||
    candidate.includes("\\") ||
    candidate.includes("#")
  ) {
    return null;
  }
  try {
    const url = new URL(candidate, RETURN_ORIGIN);
    if (url.origin !== RETURN_ORIGIN || url.hash || !STILL_TRUE_CREW_PATH.test(url.pathname)) {
      return null;
    }
    if (url.search !== "?there=1") return null;
    return `${url.pathname}${url.search}` as Route;
  } catch {
    return null;
  }
}

/** True only for the return flag, with nothing else in the query. */
export function stillTrueJoinPending(search: string): boolean {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  return [...params.keys()].length === 1 && params.get("there") === "1";
}

/** Email-link door after the tap. Null when the crew id is not a crew id. */
export function stillTrueSignInHref(crewId: string): Route | null {
  const back = safeStillTrueReturnTo(`/social/crews/${crewId}?there=1`);
  if (!back) return null;
  return `/login?mode=signin&from=${encodeURIComponent(back)}` as Route;
}

export function accountClaimReturnToFromUrl(rawUrl: string): Route | null {
  try {
    return accountClaimReturnTo(new URL(rawUrl).searchParams.get("returnTo"));
  } catch {
    return null;
  }
}
