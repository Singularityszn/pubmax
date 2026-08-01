"use client";

// Google, Apple, and passwordless email sign-in, plus signed-in account controls.
// sign-out control.
//
// ──────────────────────────────────────────────────────────────────────────
// OWNER MANUAL STEPS (required for either button to actually log anyone in):
//
// Full checklist: docs/DEPLOYMENT.md, "Browser sign-in".
// IdP redirect URI is always https://<project-ref>.supabase.co/auth/v1/callback.
// Canonical callback and Supabase URL allowlist are owned by that checklist.
//
// Provider buttons appear only after Supabase's public settings endpoint says
// that provider is enabled. The selected provider is checked again on click,
// so stale capability state cannot strand someone on a raw Supabase error.
// ──────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { LogIn } from "lucide-react";

import { useAuth } from "@/components/auth/AuthProvider";
import ClerkAccountControls from "@/components/auth/ClerkAccountControls";
import MagicLinkForm from "@/components/auth/MagicLinkForm";
import SocialSignInButtons from "@/components/auth/SocialSignInButtons";
import { isClerkConfigured } from "@/lib/clerkIdentity";
import { trackEvent } from "@/lib/analytics";
import {
  AUTH_MENU_FOCUSABLE_SELECTOR,
  authMenuFocusBoundary,
} from "@/lib/authFocus";

/** Best-effort initials for the avatar fallback when the IdP gives us no photo. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] ?? "" : "";
  return (first + last).toUpperCase() || "?";
}

export default function SignInButton({
  compact = false,
}: {
  /**
   * Nav-host mode (SiteNav + landing top bar). The two full "Continue with …"
   * provider buttons only fit alongside a full link row on very wide screens —
   * below that they crowded the nav links into unreadable fragments (1440px)
   * or overflowed the bar at 390px. Compact hosts render a single "Sign in"
   * disclosure that opens the labelled provider buttons in a small popover;
   * the inline pair returns only where it genuinely fits (auth.css ≥1680px).
   * Standalone hosts (signed-out empty states) keep the full pair as before.
   */
  compact?: boolean;
}): React.JSX.Element | null {
  const {
    user,
    loading,
    configured,
    socialProviders,
    signInWithGoogle,
    signInWithApple,
    signInWithEmail,
    cancelAuthAttempt,
    signOut,
  } = useAuth();
  const [busy, setBusy] = useState<"google" | "apple" | "out" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const wasOpenRef = useRef(false);
  const menuId = useId();

  // A successful provider start normally navigates away before its promise
  // settles, leaving `busy` set. If Back restores this page from the BFCache,
  // React state is restored too, so explicitly re-enable the provider buttons.
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

  // Light-dismiss for the compact popover: outside pointer-down or Escape.
  // Listeners only exist while the menu is open, so this costs nothing when
  // closed and never runs for the non-compact (standalone) variant. Tab/
  // Shift+Tab are trapped between the two provider buttons while the popover
  // is open, so keyboard focus can't silently escape into the nav links
  // behind it (issue #215).
  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const root = rootRef.current;
      if (root && event.target instanceof Node && !root.contains(event.target)) {
        setMenuOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        return;
      }
      if (event.key === "Tab") {
        const focusables = menuRef.current?.querySelectorAll<HTMLElement>(
          AUTH_MENU_FOCUSABLE_SELECTOR,
        );
        if (!focusables || focusables.length === 0) return;
        const target = authMenuFocusBoundary(
          Array.from(focusables),
          document.activeElement instanceof HTMLElement ? document.activeElement : null,
          event.shiftKey,
        );
        if (target) {
          event.preventDefault();
          target.focus();
        }
      }
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  // Initial focus: move into the popover (first provider button) the moment
  // it opens, so keyboard/AT users land somewhere useful instead of on an
  // invisible menu (issue #215).
  useEffect(() => {
    if (!menuOpen) return;
    const first = menuRef.current?.querySelector<HTMLElement>("button, [href]");
    first?.focus();
  }, [menuOpen]);

  // Return focus to the trigger whenever the popover closes — but only if
  // nothing else already claimed focus (e.g. the user clicked a nav link to
  // dismiss it, which focuses that link and should keep it). Without this,
  // Escape/outside-dismiss while focus was on a provider button leaves focus
  // stranded on <body> once the menu unmounts (issue #215).
  useEffect(() => {
    if (wasOpenRef.current && !menuOpen) {
      const active = document.activeElement;
      if (!active || active === document.body) {
        triggerRef.current?.focus();
      }
    }
    wasOpenRef.current = menuOpen;
  }, [menuOpen]);

  const onSignInGoogle = useCallback(async () => {
    trackEvent("sign_in_initiated", { provider: "google" });
    setBusy("google");
    setError(null);
    const { error: signInError } = await signInWithGoogle();
    // On success the browser redirects to Google, so we usually never get here;
    // if signInWithOAuth returned an error instead, surface it and re-enable.
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

  const onSignOut = useCallback(async () => {
    setBusy("out");
    await signOut();
    setBusy(null);
  }, [signOut]);

  // Hide entirely when NEITHER identity system is configured — no dead button.
  // Clerk is checked as well as Supabase because the two are independent: a
  // deployment with a Clerk key and no Supabase env used to render nothing at
  // all, which left a signed-out reader with no way to make an account.
  const clerkConfigured = isClerkConfigured();
  if (!configured && !clerkConfigured) return null;

  // Avoid a flash of the wrong state while the first getSession() resolves.
  if (loading) return null;

  if (user) {
    const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
    const name =
      (typeof meta.full_name === "string" && meta.full_name) ||
      (typeof meta.name === "string" && meta.name) ||
      user.email ||
      "Signed in";
    const avatar =
      (typeof meta.avatar_url === "string" && meta.avatar_url) ||
      (typeof meta.picture === "string" && meta.picture) ||
      "";

    return (
      <div className="authUser">
        {avatar ? (
          // eslint-disable-next-line @next/next/no-img-element -- remote IdP avatar; no next/image loader configured for it
          <img className="authAvatar" src={avatar} alt="" width={28} height={28} />
        ) : (
          <span className="authAvatarFallback" aria-hidden="true">
            {initials(name)}
          </span>
        )}
        <span className="authName">{name}</span>
        <button
          type="button"
          className="authSignOut"
          onClick={onSignOut}
          disabled={busy !== null}
        >
          Sign out
        </button>
      </div>
    );
  }

  const hasSocialProviders = socialProviders.google || socialProviders.apple;
  // The Supabase half renders only while Supabase is configured. Without that
  // guard, relaxing the gate above would surface a magic-link form whose submit
  // can only answer "Sign-in is not configured." — a dead control, which is
  // exactly what the original `!configured` early return existed to prevent.
  const supabaseOptions = configured ? (
    <>
      <SocialSignInButtons
        availability={socialProviders}
        disabled={busy !== null}
        onGoogle={onSignInGoogle}
        onApple={onSignInApple}
      />
      <MagicLinkForm
        disabled={busy !== null}
        hasSocialProviders={hasSocialProviders}
        signInWithEmail={signInWithEmail}
        cancelAuthAttempt={cancelAuthAttempt}
      />
    </>
  ) : null;
  const options = (
    <div className="authOptions">
      {supabaseOptions}
      <ClerkAccountControls />
    </div>
  );

  if (!compact) {
    return (
      <div className="authUser">
        {options}
        {error ? (
          <span className="authError" role="alert">
            {error}
          </span>
        ) : null}
      </div>
    );
  }

  // Compact nav host: this single disclosure is the whole sign-in footprint,
  // so the nav links never get crowded or clipped.
  return (
    <div className="authUser authUserNav" ref={rootRef}>
      <div className="authCompact">
        <button
          type="button"
          ref={triggerRef}
          className="authCompactTrigger"
          onClick={() => setMenuOpen((open) => !open)}
          aria-expanded={menuOpen}
          aria-controls={menuId}
          aria-haspopup="true"
          aria-label="Sign in"
        >
          <LogIn size={16} strokeWidth={2} aria-hidden="true" />
          {/* Visually hidden on the densest tablet band (auth.css ≤900px);
              the aria-label above keeps the accessible name either way. */}
          <span className="authCompactLabel" aria-hidden="true">
            Sign in
          </span>
        </button>
        {menuOpen ? (
          <div className="authMenu" id={menuId} aria-label="Sign in options" ref={menuRef}>
            {configured ? (
              <>
                <SocialSignInButtons
                  availability={socialProviders}
                  disabled={busy !== null}
                  onGoogle={onSignInGoogle}
                  onApple={onSignInApple}
                  fullLabels
                />
                <MagicLinkForm
                  disabled={busy !== null}
                  hasSocialProviders={hasSocialProviders}
                  signInWithEmail={signInWithEmail}
                  cancelAuthAttempt={cancelAuthAttempt}
                />
              </>
            ) : null}
            <ClerkAccountControls />
          </div>
        ) : null}
      </div>
      {error ? (
        <span className="authError" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}
