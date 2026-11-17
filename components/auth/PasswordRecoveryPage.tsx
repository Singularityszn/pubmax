"use client";

import Link from "next/link";
import { useEffect, useId, useReducer, useRef, useState, type FormEvent } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import PasswordPolicyHint from "@/components/auth/PasswordPolicyHint";
import { Button } from "@/components/ui/button";
import Screen from "@/components/ui/screen";
import { ensureSupabaseBrowser } from "@/lib/authClient";
import { readProviderAccountSignal } from "@/lib/authProviderRevision";
import { persistSessionForResume } from "@/lib/authSessionResumeClient";
import { parseEmail, MAX_EMAIL_LENGTH } from "@/lib/emailAddress";
import { PASSWORD_RECOVERY_MESSAGE, recoveryFormTransition, recoveryToken } from "@/lib/passwordRecovery";
import { createPasswordRecoveryFinisher } from "@/lib/passwordRecoveryClient";
import { checkPassword, MIN_PASSWORD_LENGTH } from "@/lib/passwordPolicy";
import "./passwordRecovery.css";

export default function PasswordRecoveryPage({ reset = false }: { reset?: boolean }) {
  const { configured } = useAuth();
  const [state, dispatch] = useReducer(recoveryFormTransition, { status: "editing" });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [visible, setVisible] = useState(false);
  const token = useRef<string | null>(null);
  const captured = useRef(false);
  const mounted = useRef(false);
  const operation = useRef<symbol | null>(null);
  const passwordSaved = useRef(false);
  const finisher = useRef<ReturnType<typeof createPasswordRecoveryFinisher> | null>(null);
  const hintId = useId();
  const busy = state.status === "busy";
  const securing = state.status === "securing";
  const error = state.status === "editing" || state.status === "securing" ? state.error : null;

  useEffect(() => {
    mounted.current = true;
    const capture = () => {
      if (!reset) return;
      token.current = recoveryToken(window.location.hash);
      finisher.current = null;
      operation.current = null;
      passwordSaved.current = false;
      setPassword("");
      setConfirm("");
      window.history.replaceState(window.history.state, "", window.location.pathname);
      dispatch({ type: "link" });
      if (!token.current) dispatch({ type: "invalid" });
    };
    if (!captured.current) {
      captured.current = true;
      capture();
    }
    const newLink = () => {
      if (new URLSearchParams(window.location.hash.slice(1)).has("token_hash")) capture();
    };
    window.addEventListener("hashchange", newLink);
    return () => { mounted.current = false; operation.current = null; window.removeEventListener("hashchange", newLink); };
  }, [reset]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (operation.current || !configured) return;
    if (!reset && !parseEmail(email)) {
      dispatch({ type: "failed", message: "Enter a valid email address." });
      return;
    }
    if (reset && !passwordSaved.current) {
      const check = checkPassword(password);
      if (!check.ok || password !== confirm) {
        dispatch({ type: "failed", message: check.ok ? "Passwords do not match." : check.message });
        return;
      }
    }
    const owner = Symbol();
    operation.current = owner;
    const operationToken = token.current;
    const ownsOperation = () => mounted.current && operation.current === owner && token.current === operationToken;
    const accountSignal = readProviderAccountSignal();
    dispatch({ type: "submit" });
    try {
      if (!reset) {
        const response = await fetch("/api/auth/password-recovery", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: parseEmail(email) }), signal: AbortSignal.timeout(15_000),
        });
        if (!response.ok) throw new Error();
      } else {
        if (!token.current) { dispatch({ type: "invalid" }); return; }
        finisher.current ??= createPasswordRecoveryFinisher(token.current).catch(error => {
          finisher.current = null;
          throw error;
        });
        const result = await (await finisher.current)(password);
        if (!ownsOperation()) return;
        if (result.status === "invalid") { dispatch({ type: "invalid" }); return; }
        passwordSaved.current = result.status === "saved" || result.passwordSaved;
        if (passwordSaved.current) { setPassword(""); setConfirm(""); }
        if (result.status === "retry") {
          dispatch({ type: "failed", message: result.message, passwordSaved: result.passwordSaved });
          return;
        }
        if (accountSignal.aborted) throw new Error();
        const canonical = await ensureSupabaseBrowser();
        if (!ownsOperation() || accountSignal.aborted || !canonical) throw new Error();
        const installed = await canonical.auth.setSession(result.session);
        if (installed.error) throw new Error();
        await persistSessionForResume(result.session);
      }
      if (ownsOperation()) {
        token.current = null;
        finisher.current = null;
        dispatch({ type: "complete" });
      }
    } catch {
      if (ownsOperation()) dispatch({ type: "failed", passwordSaved: passwordSaved.current, message: passwordSaved.current
        ? "Your password is saved. Try again to finish signing in, or sign in with your new password."
        : "Could not finish. Check your connection and try again." });
    } finally {
      if (operation.current === owner) operation.current = null;
    }
  }

  const complete = state.status === "complete";
  const invalid = state.status === "invalid";
  const title = invalid ? "Ask for a new link" : complete
    ? reset ? "Password saved" : "Check your inbox"
    : reset ? "Choose a new password" : "Forgot your password?";
  return (
    <main className="passwordRecoveryPage">
      <div className="passwordRecoveryInner">
        <Screen className="passwordRecoveryHead" kicker="PUBMAXX" title={title} />
        {invalid ? (
          <>
            <p role="alert">This reset link is missing, expired or already used.</p>
            <Button asChild><Link href="/auth/forgot-password">Email me a new link</Link></Button>
          </>
        ) : complete ? (
          <>
            <p role="status">{reset ? "You're signed in. Your other sessions are signed out." : PASSWORD_RECOVERY_MESSAGE}</p>
            {!reset ? <p>Check your inbox and spam folder. Each link works once.</p> : null}
            {reset ? <Button asChild><Link href="/map">Back to the map</Link></Button> : null}
          </>
        ) : (
          <form onSubmit={submit} method="post" aria-label={reset ? "Reset password" : "Request password reset"} aria-busy={busy}>
            {reset ? (
              <>
                <div className="passwordRecoveryLabel">
                  <label htmlFor="recovery-password">New password</label>
                  <button type="button" aria-pressed={visible} aria-controls="recovery-password recovery-confirm" onClick={() => setVisible(!visible)}>
                    {visible ? "Hide passwords" : "Show passwords"}
                  </button>
                </div>
                <input id="recovery-password" type={visible ? "text" : "password"} name="new-password" autoComplete="new-password"
                  minLength={MIN_PASSWORD_LENGTH} required aria-describedby={hintId} disabled={busy || securing}
                  value={password} onChange={event => setPassword(event.target.value)} />
                <PasswordPolicyHint value={password} id={hintId} />
                <label htmlFor="recovery-confirm">Confirm new password</label>
                <input id="recovery-confirm" type={visible ? "text" : "password"} name="new-password-confirmation" autoComplete="new-password"
                  minLength={MIN_PASSWORD_LENGTH} required disabled={busy || securing}
                  value={confirm} onChange={event => setConfirm(event.target.value)} />
              </>
            ) : (
              <>
                <p>We&apos;ll send a reset link to the email on your account.</p>
                <label htmlFor="recovery-email">Account email</label>
                <input id="recovery-email" name="email" type="email" autoComplete="email" autoCapitalize="none" spellCheck={false}
                  required maxLength={MAX_EMAIL_LENGTH} disabled={busy} value={email} onChange={event => setEmail(event.target.value)} />
              </>
            )}
            <Button type="submit" disabled={busy || !configured}>
              {busy ? "Working…" : securing ? "Finish securing account" : reset ? "Save new password" : "Send reset link"}
            </Button>
            {error ? <p role="alert">{error}</p> : null}
            {!configured ? <p role="status">Password recovery is unavailable on this build.</p> : null}
          </form>
        )}
        <div className="passwordRecoveryFooter">
          <Link href="/login">Back to sign in</Link>
          {!reset ? <p>You can also use an email sign-in link. An account without an email cannot receive a reset.</p> : null}
        </div>
      </div>
    </main>
  );
}
