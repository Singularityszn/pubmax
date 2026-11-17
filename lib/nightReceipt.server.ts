import "server-only";

// The Night Receipt is private to the ACCOUNT that holds a Plan's host seat,
// not to the device that holds its capability cookie. Two accounts can share
// one device and one cookie, so the cookie alone proves nothing about the
// account. The read needs all of: a verified account, the host capability from
// its HttpOnly cookie (never the Authorization header, which carries the
// account token here), and that host seat's existing user_id equal to the
// verified account. Any doubt is a refusal.

import { verifyCallerAuth } from "@/lib/authServer";
import { projectNightReceipt, type NightReceipt } from "@/lib/nightReceipt";
import { planHostUserId } from "@/lib/planCrewIdentity";
import { planMemberCookieCapability } from "@/lib/planMemberCapability";
import { planMemberIdentityResult, planStateResult } from "@/lib/planStore";

export type OwnedNightReceiptRead =
  | { status: "owner"; receipt: NightReceipt | null }
  | { status: "refused" }
  | { status: "unavailable" };

const REFUSED: OwnedNightReceiptRead = { status: "refused" };
const UNAVAILABLE: OwnedNightReceiptRead = { status: "unavailable" };

export async function readOwnedNightReceipt(request: Request, planId: string): Promise<OwnedNightReceiptRead> {
  const auth = await verifyCallerAuth(request);
  if (auth.status === "unavailable") return UNAVAILABLE;
  if (auth.status !== "verified") return REFUSED;
  const capability = planMemberCookieCapability(request, planId);
  if (!capability) return REFUSED;
  try {
    const seat = await planMemberIdentityResult(planId, capability);
    if (!seat.ok) return UNAVAILABLE;
    if (seat.identity?.role !== "host") return REFUSED;
    // An unclaimed host seat, or one we cannot read, is never this account's.
    if ((await planHostUserId(planId)) !== auth.identity.id) return REFUSED;
    const lookup = await planStateResult(planId);
    if (!lookup.ok) return UNAVAILABLE;
    if (!lookup.plan) return REFUSED;
    const projection = projectNightReceipt({ state: lookup.plan, role: "host" });
    return { status: "owner", receipt: projection.kind === "receipt" ? projection.receipt : null };
  } catch {
    return UNAVAILABLE;
  }
}
