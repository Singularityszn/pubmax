"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { LogIn } from "lucide-react";

import { useAuth } from "@/components/auth/AuthProvider";
import MagicLinkForm from "@/components/auth/MagicLinkForm";
import HandlePasswordSignIn from "@/components/auth/HandlePasswordSignIn";
import type { MagicLinkResult } from "@/lib/passwordlessAuth";
import SocialSignInButtons from "@/components/auth/SocialSignInButtons";
import { isClerkProductSessionAvailable } from "@/lib/clerkAvailability";
import { trackEvent } from "@/lib/analytics";

import "@/app/auth/auth.css";
import "./loginPage.css";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] ?? "" : "";
  return (first + last).toUpperCase() || "?";
}

function displayName(user: {
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
}): string {
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  return (
    (typeof meta.full_name === "string" && meta.full_name) ||
    (typeof meta.name === "string" && meta.name) ||
    user.email ||
    "Signed in"
  );
}

function avatarUrl(user: {
  user_metadata?: Record<string, unknown> | null;
}): string {
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  return (
    (typeof meta.avatar_url === "string" && meta.avatar_url) ||
    (typeof meta.picture === "string" && meta.picture) ||
    ""
  );
}

/**
 * Full-page sign-in surface. Owns the email-link flow as a first-class page
 * (not only the nav popover). Phone nav Sign in routes here; desktop may still
 * use the compact popover as a fast path.
 */
export default function LoginPage(): React.JSX.Element {
  const {
    user,
    loading,
    configured,
    clerkIntegrationConfigured,
    socialProviders,
    signInWithGoogle,
    signInWithApple,
    signInWithEmail,
    cancelAuthAttempt,
    signOut,
    welcomeBack,
    resumeSignIn,
  } = useAuth();
  const [busy, setBusy] = useState<"google" | "apple" | "out" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resumeStatus, setResumeStatus] = useState<
    "idle" | "sending" | MagicLinkResult["status"]
  >("idle");
  const [resumeMessage, setResumeMessage] = useState("");
  const [useDifferentAccount, setUseDifferentAccount] = useState(false);

  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) {
        cancelAuthAttempt();
        setBusy(null);
      }
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, [cancelAuthAttempt]);

  const onSignInGoogle = useCallback(async () => {
    trackEvent("sign_in_initiated", { provider: "google" });
    setBusy("google");
    setError(null);
    const { error: signInError } = await signInWithGoogle();
    if (signInError) {
      setError(signInError);
      setBusy(null);
    }
  }, [signInWithGoogle]);

  const onSignInApple = useCallback(async () => {
    trackEvent("sign_in_initiated", { provider: "apple" });
    setBusy("apple");
    setError(null);
    const { error: signInError } = await signInWithApple();
    if (signInError) {
      setError(signInError);
      setBusy(null);
    }
  }, [signInWithApple]);

  const onResume = useCallback(async () => {
    if (resumeStatus === "sending" || resumeStatus === "sent") return;
    trackEvent("sign_in_initiated", { provider: "email_resume" });
    setResumeStatus("sending");
    setResumeMessage("");
    const result = await resumeSignIn();
    setResumeStatus(result.status);
    setResumeMessage(result.message);
  }, [resumeSignIn, resumeStatus]);

  const onSignOut = useCallback(async () => {
    setBusy("out");
    await signOut();
    setBusy(null);
  }, [signOut]);

  const clerkSessionAvailable = isClerkProductSessionAvailable(
    user,
    clerkIntegrationConfigured,
  );
  const hasAuthSurface = configured || clerkSessionAvailable;

  return (
    <main className="loginPage">
      <div className="loginPageInner">
        <header className="loginPageHead">
          <p className="loginPageEyebrow">PUBMAXXING</p>
          <h1 className="loginPageTitle">
            {user ? "You are signed in" : "Sign in"}
          </h1>
          <p className="loginPageLead">
            {user
              ? "Your account is ready. Jump back into the map, or sign out of this device."
              : "Save prices, claim a handle, and keep your nights on this account."}
          </p>
        </header>

        {!hasAuthSurface && !loading ? (
          <p className="loginPageNotice" role="status">
            Sign-in is not configured on this build. You can still browse the
            map.
          </p>
        ) : null}

        {loading && !clerkSessionAvailable ? (
          <p className="loginPageNotice" role="status">
            Checking your session…
          </p>
        ) : null}

        {!loading && user ? (
          <section className="loginPageSignedIn" aria-label="Signed-in account">
            <div className="loginPageIdentity">
              {avatarUrl(user) ? (
                // eslint-disable-next-line @next/next/no-img-element -- remote IdP avatar
                <img
                  className="authAvatar loginPageAvatar"
                  src={avatarUrl(user)}
                  alt=""
                  width={48}
                  height={48}
                />
              ) : (
                <span className="authAvatarFallback loginPageAvatar" aria-hidden="true">
                  {initials(displayName(user))}
                </span>
              )}
              <div className="loginPageIdentityText">
                <p className="loginPageWho">{displayName(user)}</p>
                {user.email ? (
                  <p className="loginPageEmail">{user.email}</p>
                ) : null}
              </div>
            </div>
            <div className="loginPageActions">
              <Link href="/map" className="loginPagePrimary">
                Continue to the map
              </Link>
              <Link href="/u/you" className="loginPageSecondary">
                Your profile
              </Link>
              <button
                type="button"
                className="authSignOut loginPageSignOut"
                onClick={onSignOut}
                disabled={busy !== null}
              >
                Sign out
              </button>
            </div>
          </section>
        ) : null}

        {!loading && !user && hasAuthSurface && welcomeBack && !useDifferentAccount ? (
          <section className="loginPageWelcomeBack" aria-label="Continue signed in">
            <h2 className="loginPageWelcomeBackTitle">Welcome back</h2>
            <p className="loginPageWelcomeBackLead">
              Your session on this device ended.
              {welcomeBack.maskedEmail
                ? ` Continue as ${welcomeBack.maskedEmail}.`
                : " Continue with your saved sign-in."}
            </p>
            <button
              type="button"
              className="loginPagePrimary loginPageWelcomeBackContinue"
              onClick={onResume}
              disabled={resumeStatus === "sending" || resumeStatus === "sent"}
            >
              {resumeStatus === "sending"
                ? "Sending…"
                : resumeStatus === "sent"
                  ? "Link sent"
                  : welcomeBack.maskedEmail
                    ? `Continue as ${welcomeBack.maskedEmail}`
                    : "Email me a sign-in link"}
            </button>
            {resumeMessage ? (
              <p
                className={
                  resumeStatus === "sent"
                    ? "authMagicLinkSuccess"
                    : "authError loginPageError"
                }
                role={resumeStatus === "sent" ? "status" : "alert"}
                aria-live="polite"
              >
                {resumeMessage}
              </p>
            ) : null}
            <button
              type="button"
              className="loginPageQuietLink loginPageWelcomeBackSwitch"
              onClick={() => setUseDifferentAccount(true)}
            >
              Use a different account
            </button>
          </section>
        ) : null}

        {!loading && !user && hasAuthSurface && (!welcomeBack || useDifferentAccount) ? (
          <section className="loginPageForm" aria-label="Sign-in options">
            <div className="authOptions">
              {configured || clerkSessionAvailable ? (
                <SocialSignInButtons
                  availability={socialProviders}
                  disabled={busy !== null}
                  onGoogle={onSignInGoogle}
                  onApple={onSignInApple}
                  fullLabels
                />
              ) : null}
              {configured ? (
                <>
                  <MagicLinkForm
                    disabled={busy !== null}
                    hasSocialProviders={
                      socialProviders.google || socialProviders.apple
                    }
                    signInWithEmail={signInWithEmail}
                    cancelAuthAttempt={cancelAuthAttempt}
                  />
                  <HandlePasswordSignIn disabled={busy !== null} />
                </>
              ) : null}
            </div>
            {error ? (
              <p className="authError loginPageError" role="alert">
                {error}
              </p>
            ) : null}
          </section>
        ) : null}

        <footer className="loginPageFoot">
          <Link href="/map" className="loginPageQuietLink">
            <LogIn size={14} aria-hidden="true" />
            Browse without signing in
          </Link>
          <p className="loginPageLegal">
            By signing in you agree to the{" "}
            <Link href="/terms">terms</Link> and{" "}
            <Link href="/privacy">privacy notice</Link>.
          </p>
        </footer>
      </div>
    </main>
  );
}
