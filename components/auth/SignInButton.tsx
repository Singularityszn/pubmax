"use client";

// Google, Microsoft, and passwordless email sign-in — and, once signed in, the user's avatar/name + a
// sign-out control.
//
// ──────────────────────────────────────────────────────────────────────────
// OWNER MANUAL STEPS (required for either button to actually log anyone in):
//
// Full checklist: docs/DEPLOYMENT.md → "Browser sign-in (Google + Microsoft)".
// IdP redirect URI is always https://<project-ref>.supabase.co/auth/v1/callback.
// Site callback (<site>/auth/callback) is allowlisted in Supabase URL Configuration.
//
// Until those dashboard steps are done the buttons open the IdP and then FAIL
// the redirect — that failure is EXPECTED and is not a bug in this code.
// ──────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { LogIn } from "lucide-react";

import { useAuth } from "@/components/auth/AuthProvider";
import MagicLinkForm from "@/components/auth/MagicLinkForm";
import { trackEvent } from "@/lib/analytics";
import {
  AUTH_MENU_FOCUSABLE_SELECTOR,
  authMenuFocusBoundary,
} from "@/lib/authFocus";

// The official multi-colour Google "G" mark. Kept inline so it renders in both
// themes without an asset request; brand colours are fixed (never tokenized).
function GoogleMark(): React.JSX.Element {
  return (
    <svg className="authProviderMark" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path
        fill="#4285F4"
        d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z"
      />
      <path
        fill="#34A853"
        d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z"
      />
      <path
        fill="#FBBC05"
        d="M11.69 28.18c-.44-1.32-.69-2.73-.69-4.18s.25-2.86.69-4.18v-5.7H4.34C2.85 17.09 2 20.45 2 24s.85 6.91 2.34 9.88l7.35-5.7z"
      />
      <path
        fill="#EA4335"
        d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z"
      />
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
    signInWithGoogle,
    signInWithMicrosoft,
    signInWithEmail,
    cancelAuthAttempt,
    signOut,
  } = useAuth();
  const [busy, setBusy] = useState<"google" | "microsoft" | "out" | null>(null);
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

  const onSignInMicrosoft = useCallback(async () => {
    trackEvent("sign_in_initiated", { provider: "microsoft" });
    setBusy("microsoft");
    setError(null);
    const { error: signInError } = await signInWithMicrosoft();
    if (signInError) {
      setError(signInError);
      setBusy(null);
    }
  }, [signInWithMicrosoft]);

  const onSignOut = useCallback(async () => {
    setBusy("out");
    await signOut();
    setBusy(null);
  }, [signOut]);

  // Hide entirely when the public env is missing — no dead button.
  if (!configured) return null;

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

  const options = (
    <div className="authOptions">
      <div className="authProviders">
        <button
          type="button"
          className="authSignIn"
          onClick={onSignInGoogle}
          disabled={busy !== null}
          aria-label="Continue with Google"
        >
          <GoogleMark />
          {/* Full label on room-to-spare widths; a short label takes over at
              narrow viewports (see auth.css) so two provider buttons never
              crowd/clip the nav at 390px. aria-label is what screen readers
              announce regardless of which label is visually shown. */}
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
          onClick={onSignInMicrosoft}
          disabled={busy !== null}
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
      <MagicLinkForm
        disabled={busy !== null}
        signInWithEmail={signInWithEmail}
        cancelAuthAttempt={cancelAuthAttempt}
      />
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
            <button
              type="button"
              className="authSignIn"
              onClick={onSignInGoogle}
              disabled={busy !== null}
            >
              <GoogleMark />
              Continue with Google
            </button>
            <button
              type="button"
              className="authSignIn"
              onClick={onSignInMicrosoft}
              disabled={busy !== null}
            >
              <MicrosoftMark />
              Continue with Microsoft
            </button>
            <MagicLinkForm
              disabled={busy !== null}
              signInWithEmail={signInWithEmail}
              cancelAuthAttempt={cancelAuthAttempt}
            />
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
