"use client";

// Identity nudge sheet — the WEB account prompt shown after a high-intent
// action for a signed-out user (Cycle-2 locked owner decision: push identity
// harder after the FIRST PLAN ACTION and the FIRST MOMENT CAPTURE). Mounted
// once at the app root (inside AuthProvider, next to ClaimNightDialog) so any
// plan/moment success path can arm it via recordPlanNudgeTrigger() /
// recordMomentNudgeTrigger() (lib/identityNudge.ts) without owning this UI.
//
// The gate lives in lib/identityNudge.ts (shouldOfferIdentityNudge); this
// component is presentation + the two OAuth actions + "not now". Browsing, map,
// and prices are never affected — this only ever appears after the user has
// already done something worth keeping. Reuses the ClaimNightDialog styling and
// the SignInButton provider-button idiom (app/auth/auth.css).
//
// ── The LIGHTER path (Cycle-2 locked decision: "early email capture") ────────
// Alongside the two OAuth buttons there is a second, lower-friction option:
// leave just an email to get the weekly pint digest. Full OAuth is the only way
// email arrives today; this gives a signed-out user a one-field alternative
// without an account. The wording ties the capture to ONE stated purpose (the
// digest) — honest purpose limitation, GDPR-sane. The address is stored
// UNCONFIRMED via /api/email-subscribers (double-opt-in); the success copy here
// is derived from the server's honest response (never a fake "check your inbox"
// when nothing was sent). Validation matches the server (lib/emailSubscribers).

import { useEffect, useState, useSyncExternalStore } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import { isValidEmail } from "@/lib/emailSubscribers";
import {
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
    body: "Sign in and your Moments save to your account — not just this device.",
  },
};

// The official multi-colour Google "G" mark (kept inline; brand colours fixed).
function GoogleMark(): React.JSX.Element {
  return (
    <svg className="authProviderMark" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path fill="#4285F4" d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z" />
      <path fill="#34A853" d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z" />
      <path fill="#FBBC05" d="M11.69 28.18c-.44-1.32-.69-2.73-.69-4.18s.25-2.86.69-4.18v-5.7H4.34C2.85 17.09 2 20.45 2 24s.85 6.91 2.34 9.88l7.35-5.7z" />
      <path fill="#EA4335" d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z" />
    </svg>
  );
}

// Microsoft four-square mark (brand colours fixed).
function MicrosoftMark(): React.JSX.Element {
  return (
    <svg className="authProviderMark" viewBox="0 0 23 23" aria-hidden="true" focusable="false">
      <path fill="#F25022" d="M1 1h10v10H1z" />
      <path fill="#7FBA00" d="M12 1h10v10H12z" />
      <path fill="#00A4EF" d="M1 12h10v10H1z" />
      <path fill="#FFB900" d="M12 12h10v10H12z" />
    </svg>
  );
}

export default function IdentityNudge(): React.JSX.Element | null {
  const trigger = useSyncExternalStore(
    subscribeIdentityNudge,
    getIdentityNudgeClientSnapshot,
    getIdentityNudgeServerSnapshot,
  );
  const { user, loading, configured, signInWithGoogle, signInWithMicrosoft } = useAuth();

  // Local email-capture state (hooks run unconditionally, before any early
  // return). `status` drives the honest, no-fake-success flow:
  //   idle → submitting → done (server-derived message) | error (retryable).
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "done" | "error">("idle");
  const [message, setMessage] = useState("");

  // Signed-in state is applied here (live via useAuth) rather than in the store
  // snapshot, so a sign-in in another tab instantly hides the nudge. Nothing to
  // offer when auth is unconfigured — no dead buttons.
  const canShow =
    Boolean(trigger) && !loading && !user && configured && hasPromptBudgetFor(IDENTITY_SURFACE);

  // Claim the shared one-prompt-per-session budget at the moment it shows
  // (docs/PROMPT_ORCHESTRATION.md). Idempotent for this surface.
  useEffect(() => {
    if (canShow) claimPromptBudget(IDENTITY_SURFACE);
  }, [canShow]);

  if (!canShow || !trigger) return null;

  const copy = COPY[trigger];
  const emailValid = isValidEmail(email);

  function startSignIn(provider: () => Promise<{ error: string | null }>) {
    // Accepting is not a decline — clear the pending trigger (no cooldown) so it
    // won't re-appear on return from the OAuth redirect; a live session hides it
    // anyway. Then hand off to the existing OAuth flow (email is captured there).
    markIdentityNudgeAccepted();
    void provider();
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
      return "Almost there — check your inbox to confirm your subscription.";
    }
    // Provider-gated noop today: we saved a PENDING sign-up and will send a
    // confirmation before ever adding the address to the digest (double opt-in).
    return "Thanks — we'll email you to confirm before adding you to the digest.";
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
      setStatus("done");
      setMessage(successMessage(body));
    } catch {
      // Network / offline — honest retryable error, no fake success.
      setStatus("error");
      setMessage("Could not reach the server. Check your connection and try again.");
    }
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

        <div className="authProviders identityNudgeProviders">
          <button
            type="button"
            className="authSignIn"
            onClick={() => startSignIn(signInWithGoogle)}
            aria-label="Continue with Google"
          >
            <GoogleMark />
            <span className="authSignInLabelFull" aria-hidden="true">
              Continue with Google
            </span>
            <span className="authSignInLabelShort" aria-hidden="true">
              Google
            </span>
          </button>
          <button
            type="button"
            className="authSignIn"
            onClick={() => startSignIn(signInWithMicrosoft)}
            aria-label="Continue with Microsoft"
          >
            <MicrosoftMark />
            <span className="authSignInLabelFull" aria-hidden="true">
              Continue with Microsoft
            </span>
            <span className="authSignInLabelShort" aria-hidden="true">
              Microsoft
            </span>
          </button>
        </div>

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
                Just leave your email — we&apos;ll send the weekly pint digest.
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
            onClick={status === "done" ? markIdentityNudgeAccepted : markIdentityNudgeDismissed}
          >
            {status === "done" ? "Done" : "Not now"}
          </button>
        </div>
      </div>
    </div>
  );
}
