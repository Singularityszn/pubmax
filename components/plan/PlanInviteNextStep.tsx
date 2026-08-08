"use client";

// Inevitable post-plan next step: Send on WhatsApp first, Copy invite second.
// Reuses plan_invite_sent / plan_invite_link_copied from the invite loop.
// ShareBar stays as overflow under "More ways to share".
//
// WhatsApp / ShareBar must carry #invite={classicToken} so guests can tap
// "I'm in" on PlanCrew after invite-only join. Copy invite stays /invite/{token}
// for the RSVP page (e2e/plan-invite.spec.ts, soft-launch runbook).

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

import PlanHostInviteLink from "@/components/plan/PlanHostInviteLink";
import { PlanInviteShareBar } from "@/components/plan/PlanVibe";
import { trackEvent } from "@/lib/analytics";
import { planCrewSharePath } from "@/lib/planCrewInviteUrl";
import {
  parsePlanCapabilitySnapshot,
  planCapabilityEvent,
  readPlanCapabilitySnapshot,
  restorePlanCapability,
} from "@/lib/planSessionCapability";
import { whatsappShareHref } from "@/lib/shareArtifacts";

type PlanInviteNextStepProps = {
  planId: string;
  title: string;
  text: string;
  initialVibeSlug: string | null;
};

function toAbsoluteUrl(url: string): string {
  if (typeof window === "undefined") return url;
  try {
    return new URL(url, window.location.origin).toString();
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
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [inviteReady, setInviteReady] = useState(false);

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
    void restorePlanCapability(planId).catch(() => undefined);
  }, [memberToken, planId]);

  useEffect(() => {
    if (!memberToken) {
      queueMicrotask(() => {
        setInviteToken(null);
        setInviteReady(false);
      });
      return;
    }
    let active = true;
    fetch(`/api/plans/${planId}`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { inviteToken?: string | null } | null) => {
        if (!active) return;
        if (typeof body?.inviteToken === "string" && body.inviteToken) {
          setInviteToken(body.inviteToken);
        } else {
          setInviteToken(null);
        }
        setInviteReady(true);
      })
      .catch(() => {
        if (active) {
          setInviteToken(null);
          setInviteReady(true);
        }
      });
    return () => {
      active = false;
    };
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
    const absolute = toAbsoluteUrl(relativeUrl);
    trackEvent("plan_invite_sent", { channel: "whatsapp" });
    window.open(whatsappShareHref(text, absolute), "_blank", "noopener,noreferrer");
  }, [inviteToken, relativeUrl, text]);

  return (
    <div className="planInviteNext" id="share">
      {inviteReady && inviteToken ? (
        <a
          className="planInviteNext__whatsapp"
          href={whatsappShareHref(text, relativeUrl)}
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
          {memberToken ? "Preparing your WhatsApp invite…" : "Restoring your invite tools…"}
        </p>
      )}
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
