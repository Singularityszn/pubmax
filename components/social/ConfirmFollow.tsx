"use client";

// Confirm-follow sheet (Social Loop v1). The target of a shared "add me" link:
// /add/<handle>. It opens on a friend's card and adds them to your lot. A LOT
// is mutual - the copy says so - so this follows them, and you become each
// other's lot once they add you back.
//
// AN ADD NEEDS AN ACCOUNT. This surface used to take the device's
// `pubmax_handle` as the adder, so a browser that had once carried somebody
// else's handle could add a friend under that name, and a stranger following a
// share link met a claim form rather than a way in. Now a signed-out visitor
// gets ONE primary action - make an account - and the add-link path rides
// through sign-up and sign-in as `?auto=1`, so the add lands by itself on the
// way back. `lib/addLink.ts` owns the doors, the one-shot predicate and the
// copy; this file only renders them.
//
// When the link is the VIEWER's own handle, this becomes the share surface
// instead: copy / share your link so friends at the table can add you.

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import { useViewerHandle } from "@/components/auth/useViewerHandle";
import HandleAvatar from "@/components/profile/HandleAvatar";
import { trackEvent } from "@/lib/analytics";
import {
  ADD_LINK_COPY,
  ADD_LINK_RECEIPT_BODY,
  ADD_LINK_SURFACE,
  addLinkCreateCta,
  addLinkDoors,
  addLinkNextSteps,
  addLinkReceiptTitle,
  addLinkReturnTo,
  shouldAutoAdd,
} from "@/lib/addLink";
import { displayHandle } from "@/lib/handleDisplay";
import { normalizeHandle } from "@/lib/profiles";
import { authedActionFetch } from "@/lib/authedFetch";
import { errorMessageFrom } from "@/lib/apiErrorMessage";

type FollowState = "idle" | "working" | "done" | "error";

/**
 * The one write this surface makes, outside the component so the button and the
 * add-on-arrival share it without a memoized closure between them. The server
 * write is idempotent (lib/followWrite.server.ts); the ONCE guard is the ref in
 * the component.
 */
async function performAdd(
  target: string,
  adder: string,
  setState: (next: FollowState) => void,
  setError: (next: string) => void,
): Promise<void> {
  setState("working");
  setError("");
  try {
    const res = await authedActionFetch(`/api/profiles/${encodeURIComponent(target)}/follow`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ follower: adder }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(errorMessageFrom(data, "Could not add them."));
    setState("done");
    trackEvent("add_link_added", { surface: ADD_LINK_SURFACE, outcome: "added" });
  } catch (err) {
    setError(err instanceof Error ? err.message : "Network error. Try again.");
    setState("error");
    trackEvent("add_link_added", { surface: ADD_LINK_SURFACE, outcome: "failed" });
  }
}

export default function ConfirmFollow({
  targetHandle,
  targetAvatarUrl,
  targetName,
  auto = false,
}: {
  targetHandle: string;
  targetAvatarUrl?: string;
  targetName?: string;
  /** `?auto=1`: the person already chose this add before making an account. */
  auto?: boolean;
}) {
  const target = normalizeHandle(targetHandle);
  const { user, identityResolved } = useAuth();
  const viewerHandle = useViewerHandle();
  const [state, setState] = useState<FollowState>("idle");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [shareError, setShareError] = useState("");
  // ONCE. A re-render, a re-focus or a second effect pass may not write again.
  const autoAttempted = useRef(false);

  const isSelf = Boolean(viewerHandle) && viewerHandle === target;
  const shareUrl =
    typeof window !== "undefined" ? `${window.location.origin}/add/${target}` : `/add/${target}`;
  const doors = addLinkDoors(target);
  const inviteReturnTo = addLinkReturnTo(target);
  const claimHref = inviteReturnTo
    ? `/u/you?returnTo=${encodeURIComponent(inviteReturnTo)}`
    : "/u/you";
  const name = (targetName ?? "").trim();

  const addToLot = (adder: string) =>
    performAdd(target, adder, setState, setError);

  useEffect(() => {
    if (!target) return;
    trackEvent("add_link_viewed", { surface: ADD_LINK_SURFACE });
  }, [target]);

  // The add on arrival. The server write is idempotent (lib/followWrite.server),
  // so a repeat costs nothing; the ref is what keeps this surface from asking.
  useEffect(() => {
    if (
      !viewerHandle ||
      !shouldAutoAdd({
        auto,
        identityResolved,
        viewerHandle,
        target,
        attempted: autoAttempted.current,
      })
    ) {
      return;
    }
    autoAttempted.current = true;
    void performAdd(target, viewerHandle, setState, setError);
  }, [auto, identityResolved, target, viewerHandle]);

  async function share() {
    setShareError("");
    try {
      if (navigator.share) {
        await navigator.share({ title: "Add me on PUBMAXX", url: shareUrl });
        return;
      }
    } catch {
      // Share sheet dismissed / unavailable — fall through to clipboard.
    }
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2400);
    } catch {
      setCopied(false);
      setShareError(
        navigator.onLine === false
          ? "You look offline. Reconnect, then try again."
          : "Could not share your link. Try again.",
      );
    }
  }

  if (!target) {
    return (
      <section className="confirmFollow">
        <p className="confirmFollowError">That link is missing a handle.</p>
        <Link className="confirmFollowGhost" href="/social">
          Back to Social
        </Link>
      </section>
    );
  }

  // Self link → the share surface.
  if (isSelf) {
    return (
      <section className="confirmFollow" aria-label="Share your add link">
        <p className="confirmFollowEyebrow">{ADD_LINK_COPY.eyebrow}</p>
        <h1 className="confirmFollowTitle">Share your link</h1>
        <p className="confirmFollowBody">
          This is your add link. Share it at the table. When a friend opens it and
          adds you, and you add them back, you&rsquo;re each other&rsquo;s lot.
        </p>
        <code className="confirmFollowUrl">{shareUrl}</code>
        <button type="button" className="confirmFollowPrimary" onClick={share}>
          {copied ? "Link copied" : "Share your link"}
        </button>
        {shareError ? <p className="confirmFollowError" role="status">{shareError}</p> : null}
        <Link className="confirmFollowGhost" href="/social">
          Back to Social
        </Link>
      </section>
    );
  }

  if (state === "done") {
    return (
      <section className="confirmFollow" role="status">
        <p className="confirmFollowEyebrow">{ADD_LINK_COPY.eyebrow}</p>
        <h1 className="confirmFollowTitle">{addLinkReceiptTitle(target)}</h1>
        <p className="confirmFollowBody">{ADD_LINK_RECEIPT_BODY}</p>
        <ul className="confirmFollowNext">
          {addLinkNextSteps(target).map((step, index) => (
            <li key={step.href}>
              <Link
                className={index === 0 ? "confirmFollowPrimary" : "confirmFollowSecondary"}
                href={step.href}
              >
                {step.label}
              </Link>
            </li>
          ))}
        </ul>
      </section>
    );
  }

  const card = (
    <>
      <HandleAvatar
        handle={target}
        avatarUrl={targetAvatarUrl}
        className="confirmFollowAvatar"
        imageClassName="confirmFollowAvatar"
        size={56}
      />
      <p className="confirmFollowEyebrow">{ADD_LINK_COPY.eyebrow}</p>
      <h1 className="confirmFollowTitle">Add {name || displayHandle(target)}?</h1>
      {name ? <p className="confirmFollowMeta">{displayHandle(target)}</p> : null}
    </>
  );

  // The session has not answered yet. Nobody is named and no door is offered:
  // guessing signed-out here is what would flash a sign-up form at somebody who
  // is already signed in.
  if (!identityResolved) {
    return (
      <section className="confirmFollow" aria-label={`Add ${displayHandle(target)}`} aria-busy="true">
        {card}
        <p className="confirmFollowBody">{ADD_LINK_COPY.checking}</p>
      </section>
    );
  }

  const errorLine =
    state === "error" && error ? (
      <p className="confirmFollowError" role="alert">
        {error}
      </p>
    ) : null;

  // No account. ONE primary action, and the sign-in door under it. Both carry
  // this add link, so the add lands by itself on the way back.
  if (!user && doors) {
    return (
      <section className="confirmFollow" aria-label={`Add ${displayHandle(target)}`}>
        {card}
        <p className="confirmFollowBody">{ADD_LINK_COPY.accountNeeded}</p>
        <Link
          className="confirmFollowPrimary"
          href={doors.createHref}
          onClick={() =>
            trackEvent("add_link_signup_started", {
              surface: ADD_LINK_SURFACE,
              outcome: "create",
            })
          }
        >
          {addLinkCreateCta(target)}
        </Link>
        <Link
          className="confirmFollowSecondary"
          href={doors.signInHref}
          onClick={() =>
            trackEvent("add_link_signup_started", {
              surface: ADD_LINK_SURFACE,
              outcome: "signin",
            })
          }
        >
          {ADD_LINK_COPY.secondaryCta}
        </Link>
        <Link className="confirmFollowGhost" href="/social">
          Not now
        </Link>
      </section>
    );
  }

  // An account with no handle yet. The claim surface carries the same return.
  if (!viewerHandle) {
    return (
      <section className="confirmFollow" aria-label={`Add ${displayHandle(target)}`}>
        {card}
        <p className="confirmFollowBody">{ADD_LINK_COPY.handleNeeded}</p>
        {errorLine}
        <Link className="confirmFollowPrimary" href={claimHref}>
          {ADD_LINK_COPY.handleCta}
        </Link>
        <Link className="confirmFollowGhost" href="/social">
          Not now
        </Link>
      </section>
    );
  }

  return (
    <section className="confirmFollow" aria-label={`Add ${displayHandle(target)}`}>
      {card}
      <p className="confirmFollowBody">
        {state === "working" ? ADD_LINK_COPY.adding : ADD_LINK_COPY.signedIn}
      </p>
      {errorLine}
      <button
        type="button"
        className="confirmFollowPrimary"
        disabled={state === "working"}
        onClick={() => void addToLot(viewerHandle)}
      >
        {state === "working" ? "Adding." : `Add ${displayHandle(target)}`}
      </button>
      <Link className="confirmFollowGhost" href="/social">
        Not now
      </Link>
    </section>
  );
}
