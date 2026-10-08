"use client";

import { useState } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import SignInButton from "@/components/auth/SignInButton";
import { useViewerHandle } from "@/components/auth/useViewerHandle";
import { useViewerSession } from "@/components/auth/useViewerSession";
import ContributionGateDoor from "@/components/identity/ContributionGateDoor";
import { trackEvent } from "@/lib/analytics";
import { haptic } from "@/lib/nativeHaptics";
import { authedActionFetch } from "@/lib/authedFetch";
import { errorMessageFrom } from "@/lib/apiErrorMessage";
import { readContributionDoor, type ContributionDoorStatus } from "@/lib/contributionGateStatus";
import { isUkBaseVenueId, type WantedDTO } from "@/lib/wanted";

import "./wanted.css";

const SAVE_RETRY_MESSAGE = "Could not save. Check your connection and try again.";

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
  const { identityResolved } = useAuth();
  const viewerSession = useViewerSession();
  const handle = useViewerHandle();
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [door, setDoor] = useState<ContributionDoorStatus | null>(null);
  const [canRetry, setCanRetry] = useState(false);

  function tap() {
    onActivate?.();
    setCanRetry(false);
    if (viewerSession.signedOut) {
      setDoor(null);
      setToast("Sign in to save for a night.");
      return;
    }
    if (viewerSession.signedIn && identityResolved && !handle) {
      setToast(null);
      setDoor("onboarding_required");
      return;
    }
    void save();
  }

  async function save() {
    setBusy(true);
    setToast(null);
    setDoor(null);
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
        const gate = readContributionDoor(body);
        if (gate) {
          setDoor(gate);
        } else if (body.status === "sign_in_required") {
          setToast("Sign in to save for a night.");
        } else {
          setToast(errorMessageFrom(body, SAVE_RETRY_MESSAGE));
          setCanRetry(true);
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
      setToast(SAVE_RETRY_MESSAGE);
      setCanRetry(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="wantedSaveWrap">
      <button
        type="button"
        className="wantedSaveBtn"
        onClick={tap}
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
      {toast && active && viewerSession.signedOut ? <SignInButton /> : null}
      {canRetry && active ? (
        <button type="button" className="wantedCapture__secondary" onClick={tap} disabled={busy}>
          Try again
        </button>
      ) : null}
      {door && active ? (
        <ContributionGateDoor
          status={door}
          subject="keep a Wanted list"
          onAsserted={tap}
        />
      ) : null}
    </div>
  );
}
