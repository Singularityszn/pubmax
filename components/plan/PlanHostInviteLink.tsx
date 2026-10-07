"use client";

import { offlineOrMessage } from "@/lib/apiErrorMessage";

import { useEffect, useState, useSyncExternalStore } from "react";

import { discardBody } from "@/lib/responseBody";
import { trackEvent } from "@/lib/analytics";
import {
  ensurePlanInviteToken,
  parsePlanInviteTokenSnapshot,
  planInviteTokenEvent,
  readPlanInviteTokenSnapshot,
  writePlanInviteToken,
} from "@/lib/planInviteTokenClient";
import {
  parsePlanCapabilitySnapshot,
  planCapabilityEvent,
  readPlanCapabilitySnapshot,
  restorePlanCapability,
} from "@/lib/planSessionCapability";

// Task: plan-invite-host-ui, deliverable 1. Copy-invite-link surface on the
// Plan management page for any member holding a live capability (host or
// guest — GET /api/plans/[id] already returns inviteToken to both, not just
// the host). Mirrors PlanCrew.tsx's own mount-upgrade idiom: the server page
// only ever holds the privacy-safe preview, so this island restores capability
// client-side and fetches the member-only projection itself. Clipboard idiom
// mirrors PlanCollaborationPanel.tsx's createInvite().
//
// F9: the "New link" rotate control is host-only, gated on the same
// capability snapshot PlanInviteRsvp.tsx already uses for its host-only
// Remove button. Confirm idiom (window.confirm) mirrors
// CrawlStoryOwnerControls.tsx's delete confirmation.
//
// The token itself is NOT this component's to keep (battle test M04): a rotate
// here retired the token the Send on WhatsApp href beside it was still
// carrying. lib/planInviteTokenClient.ts holds the one live token, this
// control writes the rotated one into it, and every share surface follows.

/** An answer: the projection carried no invite token for this reader. */
export const INVITE_TOKEN_MISSING_LINE = "Invite link not ready yet. Try refreshing in a moment.";
/** Not an answer: the read did not run, which is a different thing to say. */
export const INVITE_TOKEN_UNAVAILABLE_LINE = "Couldn't read your invite link. Try again in a moment.";

export default function PlanHostInviteLink({ planId }: { planId: string }) {
  const tokenEvent = planCapabilityEvent(planId);
  const capabilitySnapshot = useSyncExternalStore(
    (onChange) => {
      window.addEventListener(tokenEvent, onChange);
      return () => window.removeEventListener(tokenEvent, onChange);
    },
    () => readPlanCapabilitySnapshot(planId),
    () => "|0|",
  );
  const { token: memberToken, role } = parsePlanCapabilitySnapshot(capabilitySnapshot);
  const isHost = Boolean(memberToken && role === "host");

  const inviteEvent = planInviteTokenEvent(planId);
  const { state: inviteLoad, token: inviteToken } = parsePlanInviteTokenSnapshot(
    useSyncExternalStore(
      (onChange) => {
        window.addEventListener(inviteEvent, onChange);
        return () => window.removeEventListener(inviteEvent, onChange);
      },
      () => readPlanInviteTokenSnapshot(planId),
      () => "unknown|",
    ),
  );
  const [status, setStatus] = useState("");
  const [rotating, setRotating] = useState(false);
  const [sessionCheckedPlanId, setSessionCheckedPlanId] = useState<string | null>(null);

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
    if (!memberToken) return;
    void ensurePlanInviteToken(planId);
  }, [memberToken, planId]);

  if (!memberToken) {
    const sessionChecked = sessionCheckedPlanId === planId;
    return (
      <div className="planHostInviteLink" aria-busy={!sessionChecked}>
        <p className="planHostInviteLink__status" role="status">
          {sessionChecked
            ? "You're a guest on this plan. Join the crew to use the invite tools."
            : "Restoring your invite tools…"}
        </p>
      </div>
    );
  }

  if (inviteLoad === "unknown") {
    return (
      <div className="planHostInviteLink" aria-busy="true">
        <p className="planHostInviteLink__status" role="status">
          Fetching your invite link…
        </p>
      </div>
    );
  }

  if (!inviteToken) {
    return (
      <div className="planHostInviteLink">
        <p className="planHostInviteLink__status" role="status">
          {inviteLoad === "unavailable"
            ? INVITE_TOKEN_UNAVAILABLE_LINE
            : INVITE_TOKEN_MISSING_LINE}
        </p>
      </div>
    );
  }

  async function copyLink() {
    const url = `${window.location.origin}/invite/${inviteToken}`;
    setStatus("");
    try {
      if (!navigator.clipboard?.writeText) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(url);
      setStatus("Invite link copied.");
      trackEvent("plan_invite_link_copied");
    } catch {
      setStatus(
        offlineOrMessage("Could not copy invite link. Try again.")
      );
    }
  }

  async function rotateLink() {
    if (rotating) return;
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        "Make a new invite link? The old one stops working straight away, and anyone still holding it won't get in.",
      )
    ) {
      return;
    }
    setRotating(true);
    setStatus("");
    try {
      const res = await fetch(`/api/plans/${planId}/invite-rotate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ memberToken }),
      });
      if (!res.ok) {
        discardBody(res);
        setStatus("Couldn't make a new link.");
        return;
      }
      const data = (await res.json()) as { inviteToken?: string };
      if (data.inviteToken) {
        // The one write every share href on this page is watching.
        writePlanInviteToken(planId, data.inviteToken);
        setStatus("New link ready. The old one stopped working.");
        trackEvent("plan_invite_link_rotated");
      }
    } catch {
      setStatus(
        offlineOrMessage("Couldn't make a new link.")
      );
    } finally {
      setRotating(false);
    }
  }

  return (
    <div className="planHostInviteLink">
      <div className="planHostInviteLink__row">
        <button type="button" className="planHostInviteLink__cta pressable" onClick={() => void copyLink()}>
          Copy invite link
        </button>
        {isHost ? (
          <button
            type="button"
            className="planHostInviteLink__rotate pressable"
            disabled={rotating}
            onClick={() => void rotateLink()}
          >
            {rotating ? "Making new link…" : "New link"}
          </button>
        ) : null}
      </div>
      {status ? (
        <p className="planHostInviteLink__status" role="status">
          {status}
        </p>
      ) : null}
    </div>
  );
}
