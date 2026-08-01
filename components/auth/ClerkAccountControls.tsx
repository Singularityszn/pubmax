"use client";

// Clerk account creation and sign-in, rendered INSIDE the existing auth surface
// (components/auth/SignInButton.tsx) rather than as its own nav control.
//
// WHY IT IS NOT A SEPARATE BUTTON IN THE NAV:
// the phone nav row is a measured budget, not a free surface — the bell, the
// messages link, the theme toggle and the sign-in disclosure already share the
// 164px guarantee that e2e/mobile-map-chrome-fit.spec.ts holds. A second
// top-level pill would spend that budget and would also put two competing
// answers to one question ("how do I get an account?") side by side. So Clerk
// joins the popover that already asks that question, and the reader sees one
// surface with one more way in.
//
// WHY <Show> AND NOT <SignedIn> / <SignedOut>:
// those two components are removed in @clerk/nextjs v7. `Show` is the current
// control component and takes the state as a prop.
//
// HONESTY (CONTEXT.md, "PUBMAXX User ID" / "PUBMAXX Handle"):
// a Clerk account is its own account. It is not a PUBMAXX User ID, and it
// carries no PUBMAXX Handle, because contribution ownership still keys on the
// Supabase `auth.uid()` that nine row-level-security migrations depend on. The
// caption says so. Do not remove it before that migration lands, and do not
// soften it into a promise the account cannot keep.

import { Show, SignInButton, SignUpButton, UserButton } from "@clerk/nextjs";

import { isClerkConfigured } from "@/lib/clerkIdentity";

export default function ClerkAccountControls({
  /**
   * Standalone hosts (signed-out empty states) have room for the caption; the
   * compact nav popover shows it too, because a caption that only appears on
   * wide screens is a disclosure that phone readers never get.
   */
  className,
}: {
  className?: string;
}): React.JSX.Element | null {
  // No key, no dead control. Mirrors SignInButton's `configured` gate exactly,
  // so an unconfigured deployment shows nothing rather than a button that fails.
  if (!isClerkConfigured()) return null;

  const classes = ["clerkAccount", className].filter(Boolean).join(" ");

  return (
    <div className={classes}>
      <Show when="signed-out">
        <div className="clerkAccountActions">
          {/* Create-account leads: it is the action the reader cannot already
              do, and sign-in is one tap away inside the same dialog. */}
          <SignUpButton mode="modal">
            <button type="button" className="authSignIn clerkAccountPrimary">
              Create account
            </button>
          </SignUpButton>
          <SignInButton mode="modal">
            <button type="button" className="authSignIn">
              Sign in with a PUBMAXX account
            </button>
          </SignInButton>
        </div>
        <p className="clerkAccountNote">
          A new account does not carry a PUBMAXX Handle yet.
        </p>
      </Show>
      <Show when="signed-in">
        <div className="clerkAccountActions clerkAccountSignedIn">
          <UserButton />
          <span className="clerkAccountNote clerkAccountNoteInline">
            Signed in to your PUBMAXX account.
          </span>
        </div>
      </Show>
    </div>
  );
}
