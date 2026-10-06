"use client";

import { useState } from "react";

import {
  useContributionGate,
  type ContributionActionResult,
} from "@/components/identity/ContributionGateDialog";
import { trackEvent } from "@/lib/analytics";
import { haptic } from "@/lib/nativeHaptics";
import { authedActionFetch } from "@/lib/authedFetch";
import { errorMessageFrom } from "@/lib/apiErrorMessage";
import { readContributionGateStatus } from "@/lib/contributionGateStatus";
import { isUkBaseVenueId, type WantedDTO } from "@/lib/wanted";

import { WANTED_GATE_COPY } from "./wantedGateCopy";

import "./wanted.css";

export default function SaveForNightButton({
  venueId,
  venueName,
  active = true,
  onActivate,
}: {
  venueId: string;
  venueName: string;
  /** False while another prompt on the sheet owns the slot, so only one reads
   *  at a time. */
  active?: boolean;
  /** Called when a tap makes this control the one that speaks. */
  onActivate?: () => void;
}): React.JSX.Element {
  const { requestContribution, contributionGateDialog } = useContributionGate(WANTED_GATE_COPY);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // Returns the gate's own status when the age or handle gate refused, so the
  // dialog can stand in front of the save and run it again once the tap is in.
  async function save(): Promise<ContributionActionResult> {
    onActivate?.();
    setBusy(true);
    setToast(null);
    try {
      const res = await authedActionFetch("/api/wanted", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          venueId,
          venueName,
          venueKind: isUkBaseVenueId(venueId) ? "uk_base" : "curated",
          rawPaste: venueName,
        }),
      }, { requiresIdentity: true });
      const body = (await res.json().catch(() => null)) as {
        wanted?: WantedDTO;
        error?: unknown;
        status?: string;
      };
      if (!res.ok || !body.wanted) {
        const gate = readContributionGateStatus(body.status);
        if (gate && gate !== "sign_in_required") {
          haptic("action-refused");
          return { status: gate, error: errorMessageFrom(body, "Could not save for a night.") };
        }
        if (gate === "sign_in_required") {
          setToast("Sign in to save for a night.");
        } else {
          setToast(errorMessageFrom(body, "Could not save for a night."));
        }
        haptic("action-refused");
        return;
      }
      trackEvent("wanted_created", {
        venueKind: body.wanted.venueKind,
        hasSourceUrl: false,
      });
      haptic("selection-kept");
      setToast("Saved for a night.");
      window.setTimeout(() => setToast(null), 2500);
    } catch {
      setToast("Could not save for a night.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="wantedSaveWrap">
      <button
        type="button"
        className="wantedSaveBtn"
        onClick={() => void requestContribution(save)}
        disabled={busy}
        aria-label={`Save ${venueName} for a night`}
      >
        {busy ? "Saving…" : "Save for a night"}
      </button>
      {toast && active ? (
        <p className="wantedCapture__status" role="status">
          {toast}
        </p>
      ) : null}
      {contributionGateDialog}
    </div>
  );
}
