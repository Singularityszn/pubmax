"use client";

import { FormEvent, useEffect, useState } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import { authedFetch } from "@/lib/authedFetch";
import { ensureSupabaseBrowser } from "@/lib/authClient";
import { MIN_HANDLE_PASSWORD_LENGTH } from "@/lib/handlePasswordConstants";

export default function SetAccountPassword(): React.JSX.Element | null {
  const { configured, user } = useAuth();
  const [hasHandle, setHasHandle] = useState(false);
  const [handleLoaded, setHandleLoaded] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) {
      void Promise.resolve().then(() => {
        setHasHandle(false);
        setHandleLoaded(false);
      });
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await authedFetch("/api/identity/handle/current");
        const body = (await res.json().catch(() => ({}))) as { handle?: string | null };
        if (!cancelled) {
          setHasHandle(typeof body.handle === "string" && body.handle.length > 0);
          setHandleLoaded(true);
        }
      } catch {
        if (!cancelled) {
          setHasHandle(false);
          setHandleLoaded(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  if (!configured || !user || !handleLoaded) return null;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setMessage(null);
    setError(null);

    if (!hasHandle) {
      setError("Claim a handle before setting a password.");
      return;
    }
    if (password.length < MIN_HANDLE_PASSWORD_LENGTH) {
      setError(`Use at least ${MIN_HANDLE_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }

    setBusy(true);
    try {
      const supabase = await ensureSupabaseBrowser();
      if (!supabase) {
        setError("Sign-in is not configured on this build.");
        return;
      }
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        setError("Could not set your password. Try again.");
        return;
      }
      setPassword("");
      setConfirm("");
      setMessage("Password saved. You can sign in with your handle next time.");
    } catch {
      setError("Could not set your password. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="accountHubPassword" onSubmit={onSubmit}>
      <h3>Set a password</h3>
      <p>
        After you choose a handle, you can sign in with handle and password as well as email link.
      </p>
      <label>
        New password
        <input
          type="password"
          autoComplete="new-password"
          minLength={MIN_HANDLE_PASSWORD_LENGTH}
          value={password}
          disabled={busy}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
      </label>
      <label>
        Confirm password
        <input
          type="password"
          autoComplete="new-password"
          minLength={MIN_HANDLE_PASSWORD_LENGTH}
          value={confirm}
          disabled={busy}
          onChange={(event) => setConfirm(event.target.value)}
          required
        />
      </label>
      <button type="submit" disabled={busy}>
        {busy ? "Saving…" : "Save password"}
      </button>
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
  );
}
