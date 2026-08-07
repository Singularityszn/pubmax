"use client";

// Inevitable post-plan next step: Send on WhatsApp first, Copy invite second.
// Reuses plan_invite_sent / plan_invite_link_copied from the invite loop.
// ShareBar stays as overflow under "More ways to share".

import { useCallback, useEffect, useState } from "react";

import PlanHostInviteLink from "@/components/plan/PlanHostInviteLink";
import { PlanInviteShareBar } from "@/components/plan/PlanVibe";
import { trackEvent } from "@/lib/analytics";
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

  useEffect(() => {
    const onTop = (event: Event) => {
      const detail = (event as CustomEvent<{ slug: string | null }>).detail;
      setSlug(detail?.slug ?? null);
    };
    const eventName = `pubmax:plan-vibe-top:${planId}`;
    window.addEventListener(eventName, onTop);
    return () => window.removeEventListener(eventName, onTop);
  }, [planId]);

  // Match PlanInviteShareBar URL shape so WhatsApp and the stamp strip agree.
  const relativeUrl = slug
    ? `/plan/${planId}?vibe=${encodeURIComponent(slug)}`
    : `/plan/${planId}`;

  const openWhatsApp = useCallback(() => {
    const absolute = toAbsoluteUrl(relativeUrl);
    trackEvent("plan_invite_sent", { channel: "whatsapp" });
    window.open(whatsappShareHref(text, absolute), "_blank", "noopener,noreferrer");
  }, [relativeUrl, text]);

  return (
    <div className="planInviteNext" id="share">
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
        />
      ) : null}
    </div>
  );
}
