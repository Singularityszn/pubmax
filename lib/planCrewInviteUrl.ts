// Crew-join share URLs for a Plan. The classic multi-use invite_token is a
// bearer capability (not the plan UUID), so every share carries it and a bare
// plan id never joins (the IDOR close). Hosts share `/invite/{token}`; the old
// `/plan/{id}#invite=` shape still works for links already sent. Collaboration
// one-use invites keep the hash shape (PlanCollaborationPanel).

import type { Route } from "next";
import { isPlanId } from "@/lib/plan";
import { siteOrigin } from "@/lib/siteUrl";

/** Classic plans.invite_token (32 hex). Distinct from 64-hex collaboration invites. */
export const CLASSIC_PLAN_INVITE_TOKEN_PATTERN = /^[0-9a-f]{32}$/;

export function isClassicPlanInviteToken(raw: unknown): raw is string {
  if (typeof raw !== "string") return false;
  return CLASSIC_PLAN_INVITE_TOKEN_PATTERN.test(raw.trim().toLowerCase());
}

/**
 * ONE LINK (launch review 3.5). Every host share surface (Send on WhatsApp,
 * Copy invite link, More ways to share, the usual-lot re-invite) sends the
 * public invite page for the classic token, so a guest meets one door and one
 * capability. The page names the host and the night, and a Going RSVP seats
 * the guest in the crew with the same rights a join gives. Null when the
 * token is not a classic one, so no surface shares a bare plan id.
 */
export function planInviteSharePath(inviteToken: unknown): Route | null {
  if (!isClassicPlanInviteToken(inviteToken)) return null;
  return `/invite/${encodeURIComponent(inviteToken.trim().toLowerCase())}` as Route;
}

/**
 * The same link with a host, because it leaves the site. The origin is the
 * canonical one in production (`siteOrigin` in lib/siteUrl.ts, which reads
 * NEXT_PUBLIC_SITE_URL) and the current one anywhere else.
 */
export function planInviteShareUrl(inviteToken: unknown, currentUrl: string): string | null {
  const path = planInviteSharePath(inviteToken);
  if (!path) return null;
  const origin = siteOrigin(currentUrl);
  if (!origin) return null;
  return new URL(path, origin).toString();
}

/**
 * LEGACY: the old crew-join path, `/plan/{id}#invite={token}`. No host surface
 * shares it any more, but links already sent still open and still join (the
 * join route grants the same capability), so PlanCrew keeps reading the hash.
 * Site-relative plan path a guest can open and tap "I'm in" on.
 * Query (e.g. ?vibe=) stays before the hash so crawlers and ShareBar agree.
 */
export function planCrewSharePath(
  planId: string,
  inviteToken: string,
  vibeSlug?: string | null,
): Route {
  if (!isPlanId(planId) || !isClassicPlanInviteToken(inviteToken)) {
    return isPlanId(planId) ? (`/plan/${planId}` as Route) : "/plan";
  }
  const token = inviteToken.trim().toLowerCase();
  const query = vibeSlug ? `?vibe=${encodeURIComponent(vibeSlug)}` : "";
  return `/plan/${planId}${query}#invite=${encodeURIComponent(token)}` as Route;
}
