"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

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
  const { token: memberToken } = parsePlanCapabilitySnapshot(capabilitySnapshot);

  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [status, setStatus] = useState("");

  useEffect(() => {
    if (memberToken) return;
    void restorePlanCapability(planId).catch(() => undefined);
  }, [memberToken, planId]);

  useEffect(() => {
    if (!memberToken) return;
    let active = true;
    fetch(`/api/plans/${planId}`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { inviteToken?: string | null } | null) => {
        if (active && typeof body?.inviteToken === "string" && body.inviteToken) {
          setInviteToken(body.inviteToken);
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [memberToken, planId]);

  if (!inviteToken) return null;

  async function copyLink() {
    const url = `${window.location.origin}/invite/${inviteToken}`;
    await navigator.clipboard?.writeText(url).catch(() => undefined);
    setStatus("Invite link copied.");
  }

  return (
    <div className="planHostInviteLink">
      <button type="button" className="planHostInviteLink__cta pressable" onClick={() => void copyLink()}>
        Copy invite link
      </button>
      {status ? (
        <p className="planHostInviteLink__status" role="status">
          {status}
        </p>
      ) : null}
    </div>
  );
}
