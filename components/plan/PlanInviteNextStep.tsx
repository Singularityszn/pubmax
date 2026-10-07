"use client";

import { offlineOrMessage } from "@/lib/apiErrorMessage";

// Inevitable post-plan next step: Send on WhatsApp first, Copy invite second.
// Reuses plan_invite_sent / plan_invite_link_copied from the invite loop.
// ShareBar stays as overflow under "More ways to share".
//
// WhatsApp / ShareBar must carry #invite={classicToken} so guests can tap
// "I'm in" on PlanCrew after invite-only join. Copy invite stays /invite/{token}
// for the RSVP page (e2e/plan-invite.spec.ts, soft-launch runbook).
//
// The token comes from lib/planInviteTokenClient.ts, never from a copy this
// component fetched at mount (battle test M04): "New link" in the rotate
// control below used to leave this href pointing at the retired token.

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

import PlanHostInviteLink, {
  INVITE_TOKEN_MISSING_LINE,
  INVITE_TOKEN_UNAVAILABLE_LINE,
} from "@/components/plan/PlanHostInviteLink";
import { PlanInviteShareBar } from "@/components/plan/PlanVibe";
import { trackEvent } from "@/lib/analytics";
import { planCrewSharePath } from "@/lib/planCrewInviteUrl";
import {
  clearPlanInviteToken,
  ensurePlanInviteToken,
  parsePlanInviteTokenSnapshot,
  planInviteTokenEvent,
  readPlanInviteTokenSnapshot,
} from "@/lib/planInviteTokenClient";
import {
  parsePlanCapabilitySnapshot,
  planCapabilityEvent,
  readPlanCapabilitySnapshot,
  restorePlanCapability,
} from "@/lib/planSessionCapability";
import { whatsappShareHref } from "@/lib/shareArtifacts";
import { siteOrigin } from "@/lib/siteUrl";

type PlanInviteNextStepProps = {
  planId: string;
  title: string;
  text: string;
  initialVibeSlug: string | null;
};

// A crew-join link leaves the site, so it carries a host: the canonical one
// in production (lib/siteUrl.ts), the current origin anywhere else. The anchor
// and the click path share this, because the anchor alone used to carry the
// bare path (Astra plan lane 1.7).
function toAbsoluteUrl(url: string): string {
  if (typeof window === "undefined") return url;
  try {
    const origin = siteOrigin(window.location.href) ?? window.location.origin;
    return new URL(url, origin).toString();
  } catch {
    return url;
  }
}

export default function PlanInviteNextStep({
  planId,
  title,
  text,
  initialVibeSlug,
}: PlanInviteNextStepProps) {
  const [slug, setSlug] = useState(initialVibeSlug);
  const [moreOpen, setMoreOpen] = useState(false);
  const [shareError, setShareError] = useState("");
  const [sessionCheckedPlanId, setSessionCheckedPlanId] = useState<string | null>(null);
  const inviteEvent = planInviteTokenEvent(planId);
  const { state: inviteState, token: inviteToken } = parsePlanInviteTokenSnapshot(
    useSyncExternalStore(
      (onChange) => {
        window.addEventListener(inviteEvent, onChange);
        return () => window.removeEventListener(inviteEvent, onChange);
      },
      () => readPlanInviteTokenSnapshot(planId),
      () => "unknown|",
    ),
  );

  const tokenEvent = planCapabilityEvent(planId);
  const capabilitySnapshot = useSyncExternalStore(
    (onChange) => {
      window.addEventListener(tokenEvent, onChange);
      return () => window.removeEventListener(tokenEvent, onChange);
    },
    () => readPlanCapabilitySnapshot(planId),
    () => "|0|",
  );
  const { token: memberToken } = parsePlanCapabilitySnapshot(capabilitySnapshot);

  useEffect(() => {
    if (memberToken) return;
    let active = true;
    void restorePlanCapability(planId)
      .catch(() => undefined)
      .finally(() => {
        if (active) setSessionCheckedPlanId(planId);
      });
    return () => {
      active = false;
    };
  }, [memberToken, planId]);

  useEffect(() => {
    // A capability that goes away takes the token with it, so no surface can
    // go on holding a link the reader is no longer a member for.
    if (!memberToken) {
      clearPlanInviteToken(planId);
      return;
    }
    void ensurePlanInviteToken(planId);
  }, [memberToken, planId]);

  useEffect(() => {
    const onTop = (event: Event) => {
      const detail = (event as CustomEvent<{ slug: string | null }>).detail;
      setSlug(detail?.slug ?? null);
    };
    const eventName = `pubmax:plan-vibe-top:${planId}`;
    window.addEventListener(eventName, onTop);
    return () => window.removeEventListener(eventName, onTop);
  }, [planId]);

  // Crew-join URL: classic invite in the hash. Bare /plan/{id} cannot join.
  const relativeUrl = inviteToken
    ? planCrewSharePath(planId, inviteToken, slug)
    : `/plan/${planId}`;

  const openWhatsApp = useCallback(() => {
    if (!inviteToken) return;
    setShareError("");
    const absolute = toAbsoluteUrl(relativeUrl);
    try {
      const opened = window.open(
        whatsappShareHref(text, absolute),
        "_blank",
        "noopener,noreferrer",
      );
      if (!opened) {
        setShareError(
          offlineOrMessage("Could not open WhatsApp. Try again.")
        );
        return;
      }
      trackEvent("plan_invite_sent", { channel: "whatsapp" });
    } catch {
      setShareError(
        offlineOrMessage("Could not open WhatsApp. Try again.")
      );
    }
  }, [inviteToken, relativeUrl, text]);

  // A reader with no crew session is not the host: the WhatsApp slot, the
  // link tools and the "more" controls are theirs alone. One notice, printed
  // once; the host link component below used to print the same sentence a
  // second time (battle test L01).
  if (!memberToken && sessionCheckedPlanId === planId) {
    return (
      <div className="planInviteNext" id="share">
        <p className="planInviteNext__whatsapp planInviteNext__whatsapp--pending" role="status">
          You&apos;re a guest on this plan. Join the crew to use the invite tools.
        </p>
      </div>
    );
  }

  return (
    <div className="planInviteNext" id="share">
      {inviteToken ? (
        <a
          className="planInviteNext__whatsapp"
          href={whatsappShareHref(text, toAbsoluteUrl(relativeUrl))}
          onClick={(event) => {
            event.preventDefault();
            openWhatsApp();
          }}
          target="_blank"
          rel="noreferrer"
        >
          Send on WhatsApp
        </a>
      ) : (
        <p className="planInviteNext__whatsapp planInviteNext__whatsapp--pending" role="status">
          {!memberToken
            ? "Restoring your invite tools…"
            : inviteState === "unavailable"
              ? INVITE_TOKEN_UNAVAILABLE_LINE
              : inviteState === "missing"
                ? INVITE_TOKEN_MISSING_LINE
                : "Preparing your WhatsApp invite…"}
        </p>
      )}
      {shareError ? (
        <p className="planInviteNext__error" role="status">
          {shareError}
        </p>
      ) : null}
      <PlanHostInviteLink planId={planId} />
      <button
        type="button"
        className="planInviteNext__more"
        aria-expanded={moreOpen}
        onClick={() => setMoreOpen((value) => !value)}
      >
        {moreOpen ? "Hide other ways to share" : "More ways to share"}
      </button>
      {moreOpen ? (
        <PlanInviteShareBar
          planId={planId}
          title={title}
          text={text}
          initialVibeSlug={slug}
          inviteToken={inviteToken}
        />
      ) : null}
    </div>
  );
}
