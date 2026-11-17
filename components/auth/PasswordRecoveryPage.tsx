"use client";

import Link from "next/link";
import { useEffect, useId, useReducer, useRef, useState, type FormEvent } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import PasswordPolicyHint from "@/components/auth/PasswordPolicyHint";
import { Button } from "@/components/ui/button";
import Screen from "@/components/ui/screen";
import { installRecoveredSession, preloadPasswordRecoveryAuth } from "@/lib/authClient";
import { readProviderAccountSignal } from "@/lib/authProviderRevision";
import { parseEmail, MAX_EMAIL_LENGTH } from "@/lib/emailAddress";
import { PASSWORD_RECOVERY_MESSAGE, recoveryFormTransition, recoveryToken, type RecoveryFormState } from "@/lib/passwordRecovery";
import { createPasswordRecoveryFinisher } from "@/lib/passwordRecoveryClient";
import { checkPassword, MIN_PASSWORD_LENGTH } from "@/lib/passwordPolicy";
import "./passwordRecovery.css";

function disposeFinisher(pending: ReturnType<typeof createPasswordRecoveryFinisher> | null): void {
  void pending?.then(finisher => finisher.dispose()).catch(() => {});
}

function recoveryTitle(state: RecoveryFormState, reset: boolean): string {
  if (state.status === "invalid") return "Ask for a new link";
  if (state.status === "complete") return reset ? "Password saved" : "Check your inbox";
  return reset ? "Choose a new password" : "Forgot your password?";
}

export default function PasswordRecoveryPage({ reset = false }: { reset?: boolean }) {
  const { configured } = useAuth();
  const [state, dispatch] = useReducer(recoveryFormTransition, { status: reset ? "checking" : "editing" });
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
  const titleId = useId();
  const errorId = useId();
  const main = useRef<HTMLElement | null>(null);
  const busy = state.status === "busy";
  const securing = state.status === "securing";
  const error = state.status === "editing" || state.status === "securing" ? state.error : null;

  useEffect(() => {
    if (state.status === "complete" || state.status === "invalid") main.current?.focus();
  }, [state.status]);

  useEffect(() => {
    mounted.current = true;
    const capture = () => {
      if (!reset) return;
      token.current = recoveryToken(window.location.hash);
      disposeFinisher(finisher.current);
      finisher.current = null;
      operation.current = null;
      passwordSaved.current = false;
      setPassword("");
      setConfirm("");
      window.history.replaceState(window.history.state, "", window.location.pathname);
      dispatch({ type: "link" });
      if (!token.current) dispatch({ type: "invalid" });
      else preloadPasswordRecoveryAuth();
    };
    if (!captured.current) {
      captured.current = true;
      capture();
    }
    const newLink = () => {
      if (new URLSearchParams(window.location.hash.slice(1)).has("token_hash")) capture();
    };
    window.addEventListener("hashchange", newLink);
    return () => {
      mounted.current = false;
      operation.current = null;
      disposeFinisher(finisher.current);
      finisher.current = null;
      window.removeEventListener("hashchange", newLink);
    };
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
        if (result.status === "invalid") { dispatch({ type: "invalid", expired: true }); return; }
        passwordSaved.current = result.status === "saved" || result.passwordSaved;
        if (passwordSaved.current) { setPassword(""); setConfirm(""); }
        if (result.status === "retry") {
          dispatch({ type: "failed", message: result.message, passwordSaved: result.passwordSaved });
          return;
        }
        if (accountSignal.aborted) throw new Error();
        const installed = await installRecoveredSession(result.session, () => ownsOperation() && !accountSignal.aborted);
        if (!installed) throw new Error();
      }
      if (ownsOperation()) {
        token.current = null;
        disposeFinisher(finisher.current);
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
  const title = recoveryTitle(state, reset);
  return (
    <main className="passwordRecoveryPage" ref={main} tabIndex={-1} aria-labelledby={titleId}>
      <div className="passwordRecoveryInner">
        <Screen className="passwordRecoveryHead" kicker="PUBMAXX" title={title} titleId={titleId} />
        {state.status === "checking" ? <p role="status">Checking your reset link…</p> : invalid ? (
          <>
            <p role="alert">{state.status === "invalid" && state.expired
              ? "This reset link has expired or was already used. Ask for a new one."
              : "Open the link in your email again, or ask for a new one. Each link works once."}</p>
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
                  <button type="button" aria-controls="recovery-password recovery-confirm" onClick={() => setVisible(!visible)}>
                    {visible ? "Hide passwords" : "Show passwords"}
                  </button>
                </div>
                <input id="recovery-password" type={visible ? "text" : "password"} autoComplete="new-password"
                  minLength={MIN_PASSWORD_LENGTH} required aria-describedby={`${hintId}${error ? ` ${errorId}` : ""}`} disabled={busy || securing}
                  value={password} onChange={event => setPassword(event.target.value)} />
                <PasswordPolicyHint value={password} id={hintId} />
                <label htmlFor="recovery-confirm">Confirm new password</label>
                <input id="recovery-confirm" type={visible ? "text" : "password"} autoComplete="new-password"
                  minLength={MIN_PASSWORD_LENGTH} required aria-describedby={error ? errorId : undefined} disabled={busy || securing}
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
            {error ? <p role="alert" id={errorId}>{error}</p> : null}
            {!configured ? <p role="status">Password recovery is unavailable on this build.</p> : null}
          </form>
        )}
        <div className="passwordRecoveryFooter">
          {reset && complete ? null : <Link href="/login">{reset ? "Back to sign in" : "Sign in with an email link"}</Link>}
          {!reset ? <p>An account without an email cannot receive a reset.</p> : null}
        </div>
      </div>
    </main>
  );
}
