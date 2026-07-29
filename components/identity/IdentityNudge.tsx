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
// ── The LIGHTER path (Cycle-2 locked decision: "early email capture") ────────
// Alongside account sign-in there is a lower-friction option: leave just an
// email to get the weekly pint digest. This gives a signed-out user a one-field
// alternative without an account. The wording ties the capture to ONE stated
// purpose (the digest) - honest purpose limitation, GDPR-sane. The address is
// stored
// UNCONFIRMED via /api/email-subscribers (double-opt-in); the success copy here
// is derived from the server's honest response (never a fake "check your inbox"
// when nothing was sent). Validation matches the server (lib/emailSubscribers).

import { useEffect, useState, useSyncExternalStore } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import MagicLinkForm from "@/components/auth/MagicLinkForm";
import SocialSignInButtons from "@/components/auth/SocialSignInButtons";
import { trackEvent } from "@/lib/analytics";
import { isValidEmail } from "@/lib/emailSubscribers";
import {
  IDENTITY_NUDGE_FIRST_PAINT_GRACE_MS,
  getIdentityNudgeClientSnapshot,
  getIdentityNudgeServerSnapshot,
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
    body: "Sign in and your Moments save to your account, not just this device.",
  },
};

export default function IdentityNudge(): React.JSX.Element | null {
  const trigger = useSyncExternalStore(
    subscribeIdentityNudge,
    getIdentityNudgeClientSnapshot,
    getIdentityNudgeServerSnapshot,
  );
  const {
    user,
    loading,
    configured,
    socialProviders,
    signInWithGoogle,
    signInWithApple,
    signInWithEmail,
    cancelAuthAttempt,
  } = useAuth();

  // Local email-capture state (hooks run unconditionally, before any early
  // return). `status` drives the honest, no-fake-success flow:
  //   idle → submitting → done (server-derived message) | error (retryable).
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "done" | "error">("idle");
  const [message, setMessage] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState("");

  // First-paint grace: never interrupt the very first moment on a page. The
  // nudge holds until the user has been here ~8s OR interacts, so a still-armed
  // trigger can't slam a dialog over a page the instant it loads (belt-and-
  // braces with the pending TTL in lib/identityNudge.ts). setState only fires
  // from async callbacks (timer / one-shot listeners), never the effect body.
  const [graced, setGraced] = useState(false);
  useEffect(() => {
    if (graced) return;
    const settle = () => setGraced(true);
    const timer = window.setTimeout(settle, IDENTITY_NUDGE_FIRST_PAINT_GRACE_MS);
    window.addEventListener("pointerdown", settle, { once: true });
    window.addEventListener("keydown", settle, { once: true });
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointerdown", settle);
      window.removeEventListener("keydown", settle);
    };
  }, [graced]);

  // Signed-in state is applied here (live via useAuth) rather than in the store
  // snapshot, so a sign-in in another tab instantly hides the nudge. Nothing to
  // offer when auth is unconfigured — no dead buttons. The grace gate keeps it
  // off the first paint.
  const canShow =
    Boolean(trigger) && graced && !loading && !user && configured && hasPromptBudgetFor(IDENTITY_SURFACE);

  // Claim the shared one-prompt-per-session budget at the moment it shows
  // (docs/PROMPT_ORCHESTRATION.md). Idempotent for this surface.
  useEffect(() => {
    if (canShow) claimPromptBudget(IDENTITY_SURFACE);
  }, [canShow]);

  if (!canShow || !trigger) return null;

  const copy = COPY[trigger];
  const emailValid = isValidEmail(email);
  const hasSocialProviders = socialProviders.google || socialProviders.apple;

  async function startSignIn(provider: () => Promise<{ error: string | null }>) {
    setAuthBusy(true);
    setAuthError("");
    const result = await provider();
    if (result.error) {
      setAuthError(result.error);
      setAuthBusy(false);
      return;
    }
    // Accepting is not a decline — clear the pending trigger (no cooldown) so it
    // won't re-appear on return from the OAuth redirect; a live session hides it.
    markIdentityNudgeAccepted();
  }

  // Turn the server's honest response into user-facing success copy. We never
  // claim an email was sent unless the server says one actually went out.
  function successMessage(body: {
    confirmed?: unknown;
    confirmationSent?: unknown;
  }): string {
    if (body.confirmed === true) {
      return "You're already signed up for the weekly digest.";
    }
    if (body.confirmationSent === true) {
      return "Almost there. Check your inbox to confirm your subscription.";
    }
    // Provider-gated noop today: we saved a PENDING sign-up and will send a
    // confirmation before ever adding the address to the digest (double opt-in).
    return "Thanks. We'll email you to confirm before adding you to the digest.";
  }

  async function submitEmail(event: React.FormEvent) {
    event.preventDefault();
    if (!isValidEmail(email) || status === "submitting") return;
    setStatus("submitting");
    setMessage("");
    try {
      const res = await fetch("/api/email-subscribers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), source: "identity-nudge" }),
      });
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        setStatus("error");
        setMessage(
          typeof body.error === "string"
            ? body.error
            : "Could not save your email right now. Try again in a moment.",
        );
        return;
      }
      if (body.status === "created") trackEvent("email_subscribed");
      setStatus("done");
      setMessage(successMessage(body));
    } catch {
      // Network / offline — honest retryable error, no fake success.
      setStatus("error");
      setMessage("Could not reach the server. Check your connection and try again.");
    }
  }

  function dismissAuthNudge(): void {
    cancelAuthAttempt();
    if (status === "done") markIdentityNudgeAccepted();
    else markIdentityNudgeDismissed();
  }

  return (
    <div className="claimNightBackdrop identityNudgeBackdrop" role="presentation">
      <div
        className="claimNightDialog identityNudgeDialog"
        role="dialog"
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
          className="identityNudgeProviders"
        />
        {authError ? <p className="authError" role="alert">{authError}</p> : null}
        <MagicLinkForm
          disabled={authBusy}
          hasSocialProviders={hasSocialProviders}
          signInWithEmail={signInWithEmail}
          cancelAuthAttempt={cancelAuthAttempt}
        />

        {/* The lighter path: leave just an email for the weekly pint digest.
            One field, one CTA, one stated purpose. Replaced by an honest
            success note once saved. */}
        {status === "done" ? (
          <p className="identityNudgeSuccess" role="status">
            {message}
          </p>
        ) : (
          <>
            <div className="identityNudgeDivider" aria-hidden="true">
              <span>or</span>
            </div>
            <form className="identityNudgeEmail" onSubmit={submitEmail} noValidate>
              <label className="identityNudgeEmailLabel" htmlFor="identity-nudge-email">
                Leave your email. We&apos;ll send the weekly pint digest.
              </label>
              <div className="identityNudgeEmailRow">
                <input
                  id="identity-nudge-email"
                  className="identityNudgeEmailInput"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={email}
                  disabled={status === "submitting"}
                  aria-invalid={status === "error"}
                  aria-describedby={status === "error" ? "identity-nudge-email-error" : undefined}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (status === "error") setStatus("idle");
                  }}
                />
                <button
                  type="submit"
                  className="claimNightConfirm identityNudgeEmailCta"
                  disabled={!emailValid || status === "submitting"}
                >
                  {status === "submitting" ? "Saving…" : "Get the digest"}
                </button>
              </div>
              {status === "error" ? (
                <p id="identity-nudge-email-error" className="claimNightError" role="alert">
                  {message}
                </p>
              ) : null}
            </form>
          </>
        )}

        <div className="claimNightActions identityNudgeActions">
          <button
            type="button"
            className="claimNightSkip"
            onClick={dismissAuthNudge}
          >
            {status === "done" ? "Done" : "Not now"}
          </button>
        </div>
      </div>
    </div>
  );
}
