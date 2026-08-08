"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

import { trackEvent } from "@/lib/analytics";
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

  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [inviteLoad, setInviteLoad] = useState<"idle" | "loading" | "ready" | "missing">("idle");
  const [status, setStatus] = useState("");
  const [rotating, setRotating] = useState(false);

  useEffect(() => {
    if (memberToken) return;
    void restorePlanCapability(planId).catch(() => undefined);
  }, [memberToken, planId]);

  useEffect(() => {
    if (!memberToken) {
      queueMicrotask(() => setInviteLoad("idle"));
      return;
    }
    let active = true;
    queueMicrotask(() => setInviteLoad("loading"));
    fetch(`/api/plans/${planId}`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { inviteToken?: string | null } | null) => {
        if (!active) return;
        if (typeof body?.inviteToken === "string" && body.inviteToken) {
          setInviteToken(body.inviteToken);
          setInviteLoad("ready");
          return;
        }
        setInviteLoad("missing");
      })
      .catch(() => {
        if (active) setInviteLoad("missing");
      });
    return () => {
      active = false;
    };
  }, [memberToken, planId]);

  if (!memberToken) {
    return (
      <div className="planHostInviteLink" aria-busy="true">
        <p className="planHostInviteLink__status" role="status">
          Restoring your invite tools…
        </p>
      </div>
    );
  }

  if (inviteLoad === "loading" || inviteLoad === "idle") {
    return (
      <div className="planHostInviteLink" aria-busy="true">
        <p className="planHostInviteLink__status" role="status">
          Fetching your invite link…
        </p>
      </div>
    );
  }

  if (!inviteToken || inviteLoad === "missing") {
    return (
      <div className="planHostInviteLink">
        <p className="planHostInviteLink__status" role="status">
          Invite link not ready yet. Try refreshing in a moment.
        </p>
      </div>
    );
  }

  async function copyLink() {
    const url = `${window.location.origin}/invite/${inviteToken}`;
    await navigator.clipboard?.writeText(url).catch(() => undefined);
    setStatus("Invite link copied.");
    trackEvent("plan_invite_link_copied");
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
        setStatus("Couldn't make a new link.");
        return;
      }
      const data = (await res.json()) as { inviteToken?: string };
      if (data.inviteToken) {
        setInviteToken(data.inviteToken);
        setStatus("New link ready. The old one stopped working.");
        trackEvent("plan_invite_link_rotated");
      }
    } catch {
      setStatus("Couldn't make a new link.");
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
