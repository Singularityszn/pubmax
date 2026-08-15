// The share-link add surface (/add/<handle>), as a policy rather than a screen.
//
// THE RULE this file exists to keep: an add link is a growth link, so the
// person opening it must end up with an ACCOUNT. Reading the device handle out
// of localStorage was the old bar, and it let a browser that had once carried
// somebody else's handle add a friend under that name. So the surface asks for
// an account first, carries the add-link path through sign-up and sign-in, and
// performs the add itself on the way back.
//
// Everything here is pure: the two doors, the one-shot auto-add predicate and
// every sentence the surface may print. The component (components/social/
// ConfirmFollow.tsx) renders it and the follow route (app/api/profiles/
// [handle]/follow) writes it - neither owns a rule.

import { arrivalDestination, type ArrivalIntent } from "@/lib/arrivalWelcome";
import { displayHandle } from "@/lib/handleDisplay";
import { safeInviteReturnTo } from "@/lib/inviteReturnTo";
import { normalizeHandle } from "@/lib/profiles";

/**
 * The one search parameter the add page reads. `?auto=1` says the person is
 * coming BACK from making an account and asked for the add before they left,
 * so the surface performs it rather than showing the button again.
 */
export const ADD_LINK_AUTO_PARAM = "auto";

/** Read `?auto=`. Only an explicit "1" counts, like every other flag here. */
export function parseAddLinkAuto(raw: string | null | undefined): boolean {
  return raw === "1";
}

/**
 * The path a sign-up or sign-in must come back to. It carries `?auto=1`, which
 * is why `safeInviteReturnTo` admits that ONE parameter: without it the person
 * lands back on the same button they already pressed.
 */
export function addLinkReturnTo(handle: string): string | null {
  const target = normalizeHandle(handle);
  if (!target) return null;
  return safeInviteReturnTo(`/add/${target}?${ADD_LINK_AUTO_PARAM}=1`);
}

/** Where the two doors point. `mode` is the login page's own door parameter. */
function loginHref(mode: "signup" | "signin", returnTo: string): string {
  const params = new URLSearchParams({ mode, from: returnTo });
  return `/login?${params.toString()}`;
}

export type AddLinkDoors = {
  /** Make an account, then land back and add them. */
  createHref: string;
  /** Already has an account. Same landing. */
  signInHref: string;
};

/** Both doors for one target, or null when the handle is not a handle. */
export function addLinkDoors(handle: string): AddLinkDoors | null {
  const returnTo = addLinkReturnTo(handle);
  if (!returnTo) return null;
  return {
    createHref: loginHref("signup", returnTo),
    signInHref: loginHref("signin", returnTo),
  };
}

/**
 * Where a completed sign-in lands, with an add link allowed to survive it.
 *
 * A SIGN-UP always finishes on the claim surface, so `arrivalDestination` drops
 * the page the person came from - correctly, because a brand new account has no
 * handle yet. An add link may not be dropped with it: the claim surface and the
 * onboarding sheet both hand a person back to their `?returnTo=`, so threading
 * it through is what brings a stranger back to the friend they came to add.
 * A `from` that is not an add link changes nothing.
 */
export function addLinkAwareDestination(
  intent: ArrivalIntent,
  from: string | null,
  accountPath: string,
): string {
  const inviteReturnTo = safeInviteReturnTo(from);
  const claimNext = inviteReturnTo
    ? `${accountPath}?returnTo=${encodeURIComponent(inviteReturnTo)}`
    : accountPath;
  return arrivalDestination(intent, from, claimNext);
}

/**
 * Whether the surface should perform the add on this render.
 *
 * ONCE is the whole point, so `attempted` is the guard the component holds in a
 * ref: a re-render, a re-focus or a second effect pass may not write a second
 * time. Identity is TRI-STATE like everywhere else here - an unresolved session
 * answers nothing, and a viewer with no handle has nothing to add anybody with.
 */
export function shouldAutoAdd(input: {
  auto: boolean;
  identityResolved: boolean;
  viewerHandle: string | null;
  target: string;
  attempted: boolean;
}): boolean {
  if (!input.auto || input.attempted || !input.identityResolved) return false;
  const viewer = normalizeHandle(input.viewerHandle ?? "");
  const target = normalizeHandle(input.target);
  if (!viewer || !target) return false;
  return viewer !== target;
}

/**
 * What the analytics rail is told. Never a handle, only which door was taken
 * and how the add went. Both sets are in the registry's own closed value list.
 */
export type AddLinkDoorOutcome = "create" | "signin";
export type AddLinkAddOutcome = "added" | "failed";

export const ADD_LINK_SURFACE = "add-link";

/** Every sentence the add surface may print. */
export const ADD_LINK_COPY = {
  eyebrow: "Your lot",
  /** The line under the friend's name for somebody with no account yet. */
  accountNeeded:
    "PUBMAXX keeps your lot to your own account, so make one and they go straight in.",
  /** The line for a signed-in drinker who has not added them yet. */
  signedIn:
    "A lot is mutual. Add them, and once they add you back their nights, drops and check-ins land in Your lot.",
  /** While the add runs on arrival. */
  adding: "Adding them to your lot.",
  /** The session has not answered yet, so nobody is offered a door. */
  checking: "Checking your session.",
  secondaryCta: "I have an account, sign in",
  handleNeeded: "Choose a handle, and they go into your lot.",
  handleCta: "Choose a handle to add them",
} as const;

/** "Create account and add @karan" - the one primary action for a stranger. */
export function addLinkCreateCta(handle: string): string {
  return `Create account and add ${displayHandle(handle)}`;
}

/** The receipt heading. */
export function addLinkReceiptTitle(handle: string): string {
  return `${displayHandle(handle)} is in your lot.`;
}

/** The receipt line under it. */
export const ADD_LINK_RECEIPT_BODY =
  "When they add you back, you are each other's lot and their nights show up in Your lot.";

export type AddLinkNextStep = { href: string; label: string };

/**
 * Where a receipt sends somebody next. Three doors on purpose: the map is the
 * product, a pint is the thing they came for, and the friend they just added is
 * the reason they are here. The message door is the person's OWN profile,
 * because that is where the message control lives - opening a conversation is a
 * write (`POST /api/messages`), never a link.
 */
export function addLinkNextSteps(handle: string): AddLinkNextStep[] {
  const target = normalizeHandle(handle);
  return [
    { href: "/map", label: "Open the map" },
    { href: "/near", label: "Find a pint" },
    ...(target
      ? [{ href: `/u/${target}`, label: "Send them a message" }]
      : []),
  ];
}
