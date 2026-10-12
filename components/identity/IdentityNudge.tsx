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
import { useEffect, useRef, useState, useSyncExternalStore, type ComponentType } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import { hasSocialAuthProviders } from "@/lib/authProviderAvailability";
import { useViewerSession } from "@/components/auth/useViewerSession";
import type { IdentityNudgeDialogProps } from "@/components/auth/IdentityNudgeDialog";
import {
  readOtherStrictModalFocusTrap,
  serverStrictModalFocusTrap,
  subscribeStrictModalFocusTrap,
} from "@/lib/useFocusTrap";
import {
  IDENTITY_NUDGE_FIRST_PAINT_GRACE_MS,
  getIdentityNudgeClientSnapshot,
  getIdentityNudgeServerSnapshot,
  identityNudgeAuthNext,
  markIdentityNudgeAccepted,
  markIdentityNudgeDismissed,
  subscribeIdentityNudge,
} from "@/lib/identityNudge";
import { hasPromptBudgetFor } from "@/lib/promptBudget";

const IDENTITY_SURFACE = "identity-nudge";
import "./identityNudge.css";

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
  const [Dialog, setDialog] = useState<ComponentType<IdentityNudgeDialogProps> | null>(null);
  const [dialogLoadFailed, setDialogLoadFailed] = useState(false);
  const [dialogLoadAttempt, setDialogLoadAttempt] = useState(0);

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

  // Eligibility stays eager. Loading presentation must not spend a prompt or
  // trap the page, and a late result cannot outlive a sign-in or another modal.
  useEffect(() => {
    if (!canShow || !trigger || Dialog) return;
    let active = true;
    void import("@/components/auth/IdentityNudgeDialog").then(
      (module) => { if (active) setDialog(() => module.default); },
      () => { if (active) setDialogLoadFailed(true); },
    );
    return () => { active = false; };
  }, [canShow, trigger, Dialog, dialogLoadAttempt]);

  if (!canShow || !trigger) return null;

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

  if (!Dialog) {
    if (!dialogLoadFailed) return null;
    return (
      <div className="authCallbackNotice" role="status">
        <span>Sign-in couldn&apos;t load.</span>
        <button type="button" onClick={() => {
          setDialogLoadFailed(false);
          setDialogLoadAttempt((attempt) => attempt + 1);
        }}>Try again</button>
        <button type="button" onClick={dismissAuthNudge}>Not now</button>
      </div>
    );
  }

  return (
    <Dialog
      dialogRef={dialogRef}
      trigger={trigger}
      configured={configured}
      socialProviders={socialProviders}
      hasSocialProviders={hasSocialProviders}
      authBusy={authBusy}
      authError={authError}
      onGoogle={() => startSignIn(signInWithGoogle)}
      onApple={() => startSignIn(signInWithApple)}
      onMicrosoft={() => startSignIn(signInWithMicrosoft)}
      signInWithEmail={(email) => signInWithEmail(email, authNext)}
      cancelAuthAttempt={cancelAuthAttempt}
      onDismiss={dismissAuthNudge}
    />
  );
}
