"use client";

// Change the email address on the signed-in account.
//
// SIGNED-IN ONLY, for the reason SetAccountPassword gives: the change is
// `supabase.auth.updateUser({ email })`, which GoTrue binds to the caller's OWN
// session, and there is no route of ours in the path. Nothing changes until the
// new address confirms it: Supabase emails a link to the new address, and with
// secure email change on, a note to the old one too. The address never reaches
// our server and is never stored in our tables.
//
// Hidden when sign-in is not configured on this build, as the password card is.

import { FormEvent, useState } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import { Button } from "@/components/ui/button";
import { offlineOrMessage } from "@/lib/apiErrorMessage";
import { ensureSupabaseBrowser } from "@/lib/authClient";
import { isValidEmail, MAX_EMAIL_LENGTH, normalizeEmail } from "@/lib/emailAddress";

const CHANGE_EMAIL_SENT_LINE =
  "Check your inbox to confirm the change. The old address gets a note too.";
const CHANGE_EMAIL_FAILED_LINE = "Couldn't change your email. Try again.";

export default function ChangeEmailCard(): React.JSX.Element | null {
  const { configured, user } = useAuth();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!configured || !user) return null;
  const currentEmail = normalizeEmail(user.email ?? "");

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setMessage(null);
    setError(null);
    const next = normalizeEmail(email);
    if (!isValidEmail(next)) {
      setError("Enter an email address, like name@example.com.");
      return;
    }
    if (currentEmail && next === currentEmail) {
      setError("That's already your email.");
      return;
    }
    setBusy(true);
    try {
      const supabase = await ensureSupabaseBrowser();
      if (!supabase) {
        setError("Sign-in is not configured on this build.");
        return;
      }
      const { error: updateError } = await supabase.auth.updateUser({ email: next });
      if (updateError) {
        setError(offlineOrMessage(CHANGE_EMAIL_FAILED_LINE));
        return;
      }
      setEmail("");
      setMessage(CHANGE_EMAIL_SENT_LINE);
    } catch {
      setError(offlineOrMessage(CHANGE_EMAIL_FAILED_LINE));
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="accountHubPasswordChange">
      <summary>Change email</summary>
      <form className="accountHubPassword" method="post" noValidate onSubmit={onSubmit} aria-label="Change email">
        <p>
          {currentEmail
            ? `You sign in as ${currentEmail}. Nothing changes until you confirm the new address.`
            : "Nothing changes until you confirm the new address."}
        </p>
        <label>
          New email
          <input
            type="email"
            name="email"
            autoComplete="email"
            inputMode="email"
            maxLength={MAX_EMAIL_LENGTH}
            value={email}
            disabled={busy}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </label>
        <Button variant="secondary" type="submit" disabled={busy}>
          {busy ? "Sending…" : "Change email"}
        </Button>
        {message ? (
          <p className="accountHubMessage" role="status">
            {message}
          </p>
        ) : null}
        {error ? (
          <p className="accountHubMessage accountHubPasswordError" role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </details>
  );
}
