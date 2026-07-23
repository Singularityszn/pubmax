"use client";

// Wave L3 — "Claim your night" dialog. Shown after sign-in when the device
// handle differs from the email-derived auth handle, has local activity, or
// either side is already linked to another account.

import { useCallback, useId, useState } from "react";

import type { ClaimChoice, ClaimPreview } from "@/lib/identityClaim";
import "@/app/auth/auth.css";

export type ClaimNightDialogProps = {
  preview: ClaimPreview;
  busy?: boolean;
  error?: string | null;
  onConfirm: (choice: ClaimChoice) => void | Promise<void>;
  onSkip: () => void;
};

function formatActivity(preview: ClaimPreview): string | null {
  const { drops, saves, follows } = preview.deviceActivity;
  const parts: string[] = [];
  if (drops > 0) parts.push(`${drops} pint drop${drops === 1 ? "" : "s"}`);
  if (saves > 0) parts.push(`${saves} save${saves === 1 ? "" : "s"}`);
  if (follows > 0) parts.push(`${follows} follow${follows === 1 ? "" : "s"}`);
  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0]!;
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts[0]}, ${parts[1]}, and ${parts[2]}`;
}

function defaultChoice(preview: ClaimPreview): ClaimChoice {
  const deviceBlocked = preview.deviceAlreadyLinkedToOther;
  const authBlocked = preview.authHandleAlreadyLinkedToOther;
  if (preview.sameHandle) return "device";
  if (!deviceBlocked && preview.deviceHandle) return "device";
  if (!authBlocked && preview.authHandle) return "auth";
  return "device";
}

export function ClaimNightDialog({
  preview,
  busy = false,
  error = null,
  onConfirm,
  onSkip,
}: ClaimNightDialogProps): React.JSX.Element {
  const titleId = useId();
  const descId = useId();
  const [choice, setChoice] = useState<ClaimChoice>(() => defaultChoice(preview));

  const activityLine = formatActivity(preview);
  const deviceBlocked = preview.deviceAlreadyLinkedToOther;
  const authBlocked = preview.authHandleAlreadyLinkedToOther;
  const bothBlocked = deviceBlocked && authBlocked;
  const same = preview.sameHandle;
  const deviceViable = Boolean(preview.deviceHandle) && !deviceBlocked;
  const authViable = Boolean(preview.authHandle) && !authBlocked && !same;
  const showChoices = !same && (deviceViable || authViable) && !bothBlocked;
  const onlyDevice = deviceViable && !authViable;
  const onlyAuth = authViable && !deviceViable;

  const confirm = useCallback(() => {
    if (busy || bothBlocked) return;
    const next: ClaimChoice =
      onlyAuth ? "auth" : onlyDevice || same ? "device" : choice;
    if (next === "device" && deviceBlocked) return;
    if (next === "auth" && authBlocked) return;
    void onConfirm(next);
  }, [
    authBlocked,
    bothBlocked,
    busy,
    choice,
    deviceBlocked,
    onConfirm,
    onlyAuth,
    onlyDevice,
    same,
  ]);

  return (
    <div className="claimNightBackdrop" role="presentation">
      <div
        className="claimNightDialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
      >
        <h2 id={titleId} className="claimNightTitle">
          Claim your night
        </h2>
        <p id={descId} className="claimNightLead">
          {same
            ? "Your device already uses this handle. Link it to your signed-in account so your pubs stay yours."
            : "This device has a handle from before you signed in. Keep those pubs on your account, or start fresh with your account handle."}
        </p>

        {activityLine ? (
          <p className="claimNightActivity">
            On this device: <strong>{activityLine}</strong>
            {preview.deviceHandle ? (
              <>
                {" "}
                under <span className="claimNightHandle">@{preview.deviceHandle}</span>
              </>
            ) : null}
          </p>
        ) : null}

        {(deviceBlocked || authBlocked) && (
          <p className="claimNightConflict" role="alert">
            {bothBlocked
              ? "Both handles already belong to other accounts. Skip for now. We will not overwrite either one."
              : deviceBlocked
                ? `@${preview.deviceHandle} already belongs to another account. You can start fresh with @${preview.authHandle}, or skip.`
                : `@${preview.authHandle} already belongs to another account. Keep @${preview.deviceHandle}, or skip.`}
          </p>
        )}

        {showChoices ? (
          <fieldset className="claimNightChoices" disabled={busy}>
            <legend className="claimNightLegend">Choose a handle</legend>
            {deviceViable ? (
              <label className="claimNightOption">
                <input
                  type="radio"
                  name="claim-choice"
                  value="device"
                  checked={choice === "device"}
                  onChange={() => setChoice("device")}
                />
                <span>
                  Keep <span className="claimNightHandle">@{preview.deviceHandle}</span>
                  <span className="claimNightOptionHint">Bring my pubs</span>
                </span>
              </label>
            ) : null}
            {authViable ? (
              <label className="claimNightOption">
                <input
                  type="radio"
                  name="claim-choice"
                  value="auth"
                  checked={choice === "auth"}
                  onChange={() => setChoice("auth")}
                />
                <span>
                  Use <span className="claimNightHandle">@{preview.authHandle}</span>
                  <span className="claimNightOptionHint">Start fresh with account handle</span>
                </span>
              </label>
            ) : null}
          </fieldset>
        ) : null}

        {same && deviceViable ? (
          <p className="claimNightSingle">
            Linking <span className="claimNightHandle">@{preview.deviceHandle}</span> to this
            account.
          </p>
        ) : null}

        {onlyDevice && !same ? (
          <p className="claimNightSingle">
            Keep <span className="claimNightHandle">@{preview.deviceHandle}</span> (bring my pubs).
          </p>
        ) : null}

        {onlyAuth && !same ? (
          <p className="claimNightSingle">
            Use <span className="claimNightHandle">@{preview.authHandle}</span> (start fresh).
          </p>
        ) : null}

        {error ? (
          <p className="claimNightError" role="alert">
            {error}
          </p>
        ) : null}

        <div className="claimNightActions">
          {!bothBlocked ? (
            <button
              type="button"
              className="claimNightConfirm"
              disabled={busy}
              onClick={confirm}
            >
              {busy ? "Linking…" : "Confirm"}
            </button>
          ) : null}
          <button
            type="button"
            className="claimNightSkip"
            disabled={busy}
            onClick={onSkip}
          >
            Skip for now
          </button>
        </div>
      </div>
    </div>
  );
}
