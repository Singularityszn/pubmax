"use client";

import { FormEvent, useState } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import { ensureSupabaseBrowser } from "@/lib/authClient";
import { persistSessionForResume } from "@/lib/authSessionResumeClient";
import { MIN_HANDLE_PASSWORD_LENGTH } from "@/lib/handlePasswordConstants";
import { trackEvent } from "@/lib/analytics";

type HandlePasswordSignInProps = {
  disabled?: boolean;
};

export default function HandlePasswordSignIn({
  disabled = false,
}: HandlePasswordSignInProps): React.JSX.Element {
  const { configured } = useAuth();
  const [open, setOpen] = useState(false);
  const [handle, setHandle] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!configured) return <></>;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || disabled) return;
    setError(null);
    setBusy(true);
    trackEvent("sign_in_initiated", { provider: "handle_password" });

    try {
      const res = await fetch("/api/auth/handle-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ handle, password }),
      });
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;

      if (!res.ok) {
        const message =
          typeof body.error === "string"
            ? body.error
            : "Handle or password is wrong.";
        setError(message);
        return;
      }

      const session =
        body.status === "signed_in" &&
        typeof body.session === "object" &&
        body.session
          ? (body.session as { access_token?: unknown; refresh_token?: unknown })
          : null;

      if (
        !session ||
        typeof session.access_token !== "string" ||
        typeof session.refresh_token !== "string"
      ) {
        setError("Sign-in did not finish. Try again.");
        return;
      }

      const supabase = await ensureSupabaseBrowser();
      if (!supabase) {
        setError("Sign-in is not configured on this build.");
        return;
      }

      const { error: sessionError } = await supabase.auth.setSession({
        access_token: session.access_token,
        refresh_token: session.refresh_token,
      });
      if (sessionError) {
        setError("Sign-in did not finish. Try again.");
        return;
      }

      void persistSessionForResume({
        access_token: session.access_token,
        refresh_token: session.refresh_token,
      });
      setPassword("");
      setOpen(false);
    } catch {
      setError("Sign-in did not finish. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        className="loginPageQuietLink loginPageHandlePasswordToggle"
        disabled={disabled || busy}
        onClick={() => setOpen(true)}
      >
        Sign in with handle and password
      </button>
    );
  }

  return (
    <form
      className="loginPageHandlePassword"
      onSubmit={onSubmit}
      aria-label="Sign in with handle and password"
    >
      <h2 className="loginPageHandlePasswordTitle">Sign in with handle and password</h2>
      <label className="loginPageHandlePasswordField">
        Handle
        <input
          type="text"
          name="handle"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          pattern="[A-Za-z0-9_]{3,30}"
          required
          disabled={busy || disabled}
          value={handle}
          onChange={(event) => setHandle(event.target.value)}
        />
      </label>
      <label className="loginPageHandlePasswordField">
        Password
        <input
          type="password"
          name="password"
          autoComplete="current-password"
          minLength={MIN_HANDLE_PASSWORD_LENGTH}
          required
          disabled={busy || disabled}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </label>
      <div className="loginPageHandlePasswordActions">
        <button type="submit" className="loginPagePrimary" disabled={busy || disabled}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
        <button
          type="button"
          className="loginPageQuietLink"
          disabled={busy}
          onClick={() => {
            setOpen(false);
            setError(null);
            setPassword("");
          }}
        >
          Back to email link
        </button>
      </div>
      {error ? (
        <p className="authError loginPageError" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
