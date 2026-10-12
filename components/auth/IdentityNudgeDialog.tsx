"use client";

import { useEffect, type RefObject } from "react";
import MagicLinkForm from "@/components/auth/MagicLinkForm";
import SocialSignInButtons from "@/components/auth/SocialSignInButtons";
import type { SocialAuthProviderAvailability } from "@/lib/authProviderAvailability";
import type { IdentityNudgeTrigger } from "@/lib/identityNudge";
import type { MagicLinkResult } from "@/lib/passwordlessAuth";
import { claimPromptBudget, hasPromptBudgetFor } from "@/lib/promptBudget";
import { useDismissOnEscape } from "@/lib/useDismissOnEscape";
import { useFocusTrap } from "@/lib/useFocusTrap";

const COPY: Record<IdentityNudgeTrigger, { title: string; body: string }> = {
  plan: {
    title: "Keep your nights",
    body: "Save this plan to your account and get your crew back together next time.",
  },
  moment: {
    title: "Own your memories",
    body: "Sign in and save your Moments to your account across devices.",
  },
};

export type IdentityNudgeDialogProps = {
  dialogRef: RefObject<HTMLDivElement | null>;
  trigger: IdentityNudgeTrigger;
  configured: boolean;
  socialProviders: SocialAuthProviderAvailability;
  hasSocialProviders: boolean;
  authBusy: boolean;
  authError: string;
  onGoogle: () => Promise<void>;
  onApple: () => Promise<void>;
  onMicrosoft: () => Promise<void>;
  signInWithEmail: (email: string) => Promise<MagicLinkResult>;
  cancelAuthAttempt: () => void;
  onDismiss: () => void;
};

export default function IdentityNudgeDialog({
  dialogRef, trigger, configured, socialProviders, hasSocialProviders,
  authBusy, authError, onGoogle, onApple, onMicrosoft,
  signInWithEmail, cancelAuthAttempt, onDismiss,
}: IdentityNudgeDialogProps): React.JSX.Element | null {
  const canShow = hasPromptBudgetFor("identity-nudge");
  useDismissOnEscape(canShow, onDismiss);
  useFocusTrap(canShow, dialogRef, "strict-modal");
  useEffect(() => {
    if (!canShow || !claimPromptBudget("identity-nudge")) return;
    dialogRef.current?.focus({ preventScroll: true });
  }, [canShow, dialogRef]);
  if (!canShow) return null;
  const copy = COPY[trigger];

  return (
    <div className="claimNightBackdrop identityNudgeBackdrop" role="presentation">
      <div
        ref={dialogRef}
        className="claimNightDialog identityNudgeDialog"
        role="dialog"
        tabIndex={-1}
        aria-modal="true"
        aria-labelledby="identity-nudge-title"
        aria-describedby="identity-nudge-body"
      >
        <h2 id="identity-nudge-title" className="claimNightTitle">{copy.title}</h2>
        <p id="identity-nudge-body" className="claimNightLead">{copy.body}</p>
        <SocialSignInButtons
          availability={socialProviders}
          disabled={authBusy}
          onGoogle={onGoogle}
          onApple={onApple}
          onMicrosoft={onMicrosoft}
          className="identityNudgeProviders"
        />
        {authError ? <p className="authError" role="alert">{authError}</p> : null}
        {configured ? (
          <MagicLinkForm
            disabled={authBusy}
            hasSocialProviders={hasSocialProviders}
            signInWithEmail={signInWithEmail}
            cancelAuthAttempt={cancelAuthAttempt}
          />
        ) : null}
        <div className="claimNightActions identityNudgeActions">
          <button type="button" className="claimNightSkip" onClick={onDismiss}>Not now</button>
        </div>
      </div>
    </div>
  );
}
