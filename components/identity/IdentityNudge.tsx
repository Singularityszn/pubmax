"use client";

// Identity nudge sheet — the WEB account prompt shown after a high-intent
// action for a signed-out user (Cycle-2 locked owner decision: push identity
// harder after the FIRST PLAN ACTION and the FIRST MOMENT CAPTURE). Mounted
// once at the app root inside AuthProvider so any
// plan/moment success path can arm it via recordPlanNudgeTrigger() /
// recordMomentNudgeTrigger() (lib/identityNudge.ts) without owning this UI.
//
// The gate lives in lib/identityNudge.ts (shouldOfferIdentityNudge); this
// component is presentation + enabled sign-in actions + "not now". Browsing and
// map reads are unaffected. Contribution writes own their separate required
// identity gate. Reuses the shared auth-sheet styling and the SignInButton
// provider-button idiom (app/auth/auth.css).
//
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import { hasSocialAuthProviders } from "@/lib/authProviderAvailability";
import { useViewerSession } from "@/components/auth/useViewerSession";
import MagicLinkForm from "@/components/auth/MagicLinkForm";
import SocialSignInButtons from "@/components/auth/SocialSignInButtons";
import { useDismissOnEscape } from "@/lib/useDismissOnEscape";
import {
  readOtherStrictModalFocusTrap,
  serverStrictModalFocusTrap,
  subscribeStrictModalFocusTrap,
  useFocusTrap,
} from "@/lib/useFocusTrap";
import {
  IDENTITY_NUDGE_FIRST_PAINT_GRACE_MS,
  getIdentityNudgeClientSnapshot,
  getIdentityNudgeServerSnapshot,
  identityNudgeAuthNext,
  markIdentityNudgeAccepted,
  markIdentityNudgeDismissed,
  subscribeIdentityNudge,
  type IdentityNudgeTrigger,
} from "@/lib/identityNudge";
import { claimPromptBudget, hasPromptBudgetFor } from "@/lib/promptBudget";

const IDENTITY_SURFACE = "identity-nudge";
import "@/app/auth/auth.css";
import "./identityNudge.css";

// Honest, trigger-specific value copy — no dark patterns, no fake urgency.
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

export default function IdentityNudge(): React.JSX.Element | null {
  const trigger = useSyncExternalStore(
    subscribeIdentityNudge,
    getIdentityNudgeClientSnapshot,
    getIdentityNudgeServerSnapshot,
  );
  const {
    loading,
    configured,
    socialProviders,
    signInWithGoogle,
    signInWithApple,
    signInWithMicrosoft,
    signInWithEmail,
    cancelAuthAttempt,
  } = useAuth();
  const viewerSession = useViewerSession();

  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState("");
  const dialogRef = useRef<HTMLDivElement>(null);

  // First-paint grace: never interrupt the very first moment on a page. The
  // nudge holds until the user has been here ~8s OR interacts, so a still-armed
  // trigger can't slam a dialog over a page the instant it loads (belt-and-
  // braces with the pending TTL in lib/identityNudge.ts). setState only fires
  // from async callbacks (timer / one-shot listeners), never the effect body.
  //
  // A tap ends the grace once it has CLICKED, never on pointerdown. On
  // pointerdown the sheet painted between press and release, its backdrop took
  // the release, and the tap that ended the grace never reached its control:
  // a guest with a Moment draft tapped Edit and got the sign-in sheet with no
  // editor (e2e/moment-photo-editor.spec.ts). The window listener runs after
  // the page's own click handlers, so the tap lands first.
  const [graced, setGraced] = useState(false);
  useEffect(() => {
    if (graced) return;
    const settle = () => setGraced(true);
    const timer = window.setTimeout(settle, IDENTITY_NUDGE_FIRST_PAINT_GRACE_MS);
    window.addEventListener("click", settle, { once: true });
    window.addEventListener("keydown", settle, { once: true });
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("click", settle);
      window.removeEventListener("keydown", settle);
    };
  }, [graced]);

  // Signed-in state is applied here (live via useAuth) rather than in the store
  // snapshot, so a sign-in in another tab instantly hides the nudge. Nothing to
  // offer when auth is unconfigured — no dead buttons. The grace gate keeps it
  // off the first paint.
  const eligible =
    Boolean(trigger) &&
    graced &&
    !loading &&
    // Only a session that has ANSWERED nobody may be nudged to sign in.
    viewerSession.signedOut &&
    configured &&
    hasPromptBudgetFor(IDENTITY_SURFACE);

  // Never share the page with another strict modal. The tap that ends the
  // grace is often the tap that opens one (Edit on a Moment opens the photo
  // editor, a lazy chunk that mounts after the nudge has already opened), and
  // two strict traps inert each other: the reader saw an inert editor over a
  // sign-in sheet they could not reach. While any strict modal other than this
  // one holds the page the nudge steps aside, and it comes back when that modal
  // closes. A map-surface sheet or drawer is not a strict modal, so the nudge
  // still covers it.
  const otherStrictModalOpen = useSyncExternalStore(
    subscribeStrictModalFocusTrap,
    () => readOtherStrictModalFocusTrap(dialogRef.current),
    serverStrictModalFocusTrap,
  );
  const canShow = eligible && !otherStrictModalOpen;

  // Claim the shared one-prompt-per-session budget at the moment it shows
  // (docs/PROMPT_ORCHESTRATION.md). Idempotent for this surface.
  useEffect(() => {
    if (canShow) claimPromptBudget(IDENTITY_SURFACE);
  }, [canShow]);

  // A blocking dialog owes a keyboard way out. Escape does what the dismiss
  // button does, including recording that the reader was asked. Called above
  // the early return so the hook order never changes.
  useDismissOnEscape(canShow && Boolean(trigger), dismissAuthNudge);
  useFocusTrap(canShow && Boolean(trigger), dialogRef, "strict-modal");

  // Modal focus starts on its labelled dialog and returns to the exact control
  // that owned focus before the nudge opened.
  useEffect(() => {
    if (!canShow || !trigger) return;
    dialogRef.current?.focus({ preventScroll: true });
  }, [canShow, trigger]);

  if (!canShow || !trigger) return null;

  const copy = COPY[trigger];
  const authNext = trigger === "plan" ? identityNudgeAuthNext() : undefined;
  const hasSocialProviders = hasSocialAuthProviders(socialProviders);

  async function startSignIn(
    provider: (next?: string) => Promise<{ error: string | null }>,
  ) {
    setAuthBusy(true);
    setAuthError("");
    const result = await provider(authNext);
    if (result.error) {
      setAuthError(result.error);
      setAuthBusy(false);
      return;
    }
    // Accepting is not a decline — clear the pending trigger (no cooldown) so it
    // won't re-appear on return from the OAuth redirect; a live session hides it.
    markIdentityNudgeAccepted();
  }

  function dismissAuthNudge(): void {
    cancelAuthAttempt();
    markIdentityNudgeDismissed();
  }

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
        <h2 id="identity-nudge-title" className="claimNightTitle">
          {copy.title}
        </h2>
        <p id="identity-nudge-body" className="claimNightLead">
          {copy.body}
        </p>

        <SocialSignInButtons
          availability={socialProviders}
          disabled={authBusy}
          onGoogle={() => startSignIn(signInWithGoogle)}
          onApple={() => startSignIn(signInWithApple)}
          onMicrosoft={() => startSignIn(signInWithMicrosoft)}
          className="identityNudgeProviders"
        />
        {authError ? <p className="authError" role="alert">{authError}</p> : null}
        {configured ? (
          <MagicLinkForm
            disabled={authBusy}
            hasSocialProviders={hasSocialProviders}
            signInWithEmail={(email) => signInWithEmail(email, authNext)}
            cancelAuthAttempt={cancelAuthAttempt}
          />
        ) : null}

        <div className="claimNightActions identityNudgeActions">
          <button type="button" className="claimNightSkip" onClick={dismissAuthNudge}>
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}
