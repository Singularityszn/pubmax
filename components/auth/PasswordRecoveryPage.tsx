"use client";

import Link from "next/link";
import { useEffect, useId, useReducer, useRef, useState, type FormEvent } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import PasswordPolicyHint from "@/components/auth/PasswordPolicyHint";
import { Button } from "@/components/ui/button";
import Screen from "@/components/ui/screen";
import { captureRecoverySessionBaseline, installRecoveredSession, preloadPasswordRecoveryAuth } from "@/lib/authClient";
import { readProviderAccountSignal } from "@/lib/authProviderRevision";
import { useClientReady } from "@/lib/useClientReady";
import { parseEmail, MAX_EMAIL_LENGTH } from "@/lib/emailAddress";
import { PASSWORD_RECOVERY_MESSAGE, recoveryFormTransition, recoveryToken, type RecoveryFormState } from "@/lib/passwordRecovery";
import { createPasswordRecoveryFinisher } from "@/lib/passwordRecoveryClient";
import { checkPassword, MIN_PASSWORD_LENGTH } from "@/lib/passwordPolicy";
import { discardBody } from "@/lib/responseBody";
import "./passwordRecovery.css";

function disposeFinisher(pending: ReturnType<typeof createPasswordRecoveryFinisher> | null): void {
  void pending?.then(finisher => finisher.dispose()).catch(() => {});
}

function recoveryPresentation(state: RecoveryFormState) {
  return {
    busy: state.status === "busy",
    securing: state.status === "securing" || state.status === "busy" && state.passwordSaved === true,
    invalidField: state.status === "editing" ? state.field : undefined,
    error: state.status === "editing" || state.status === "securing" ? state.error ?? null : null,
  };
}

function focusRecoveryError(main: HTMLElement | null, field: string | undefined, reset: boolean): void {
  const target = field ? main?.querySelector<HTMLElement>(`#recovery-${field}`)
    : main?.querySelector<HTMLElement>(reset ? "[role=alert]" : "#recovery-email");
  target?.focus();
}

function RecoveryNotice({ state, reset }: { state: RecoveryFormState; reset: boolean }) {
  if (state.status === "checking") return <><p role="status">Opening your reset link…</p><noscript><p>Turn on JavaScript, then open the link in your email again.</p></noscript></>;
  if (state.status === "invalid") return <>
    <p role="alert">{state.expired ? "This reset link has expired or was already used. Ask for a new one." : "Open the link in your email again, or ask for a new one. Each link works once."}</p>
    <Button asChild><Link href="/auth/forgot-password">Email me a new link</Link></Button>
  </>;
  if (state.status === "sign-in") return <>
    <p role="status">Your password is saved. Sign in with it to continue.</p>
    <Button asChild><Link href="/login">Sign in with your new password</Link></Button>
  </>;
  if (state.status === "complete") return <>
    <p role="status">{reset ? "Your password is saved. You're signed in." : PASSWORD_RECOVERY_MESSAGE}</p>
    {!reset ? <p>Check your inbox and spam folder. Each link works once.</p> : <Button asChild><Link href="/map" prefetch={false}>Back to the map</Link></Button>}
  </>;
  return null;
}

function recoveryTitle(state: RecoveryFormState, reset: boolean, securing: boolean): string {
  if (securing) return "Finish signing in";
  if (state.status === "invalid") return "Ask for a new link";
  if (state.status === "sign-in") return "Password saved";
  if (state.status === "complete") return reset ? "Password saved" : "Check your inbox";
  return reset ? "Choose a new password" : "Forgot your password?";
}

export default function PasswordRecoveryPage({ reset = false }: { reset?: boolean }) {
  const { configured } = useAuth();
  const ready = useClientReady();
  const [state, dispatch] = useReducer(recoveryFormTransition, { status: reset ? "checking" : "editing" });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [visible, setVisible] = useState(false);
  const token = useRef<string | null>(null);
  const captured = useRef(false);
  const markedReady = useRef(false);
  const mounted = useRef(false);
  const operation = useRef<symbol | null>(null);
  const passwordSaved = useRef(false);
  const finisher = useRef<ReturnType<typeof createPasswordRecoveryFinisher> | null>(null);
  const hintId = useId();
  const titleId = useId();
  const errorId = useId();
  const main = useRef<HTMLElement | null>(null);
  const { busy, securing, error, invalidField } = recoveryPresentation(state);

  useEffect(() => {
    if (state.status === "complete" || state.status === "invalid" || state.status === "securing" || state.status === "sign-in") main.current?.focus();
  }, [state.status]);

  useEffect(() => {
    if (state.status === "editing" && error) focusRecoveryError(main.current, invalidField, reset);
  }, [state.status, error, invalidField, reset]);

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
      else {
        performance.mark?.("pubmax:password-recovery:proof-captured");
        preloadPasswordRecoveryAuth();
      }
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

  useEffect(() => {
    if (!ready || !configured || state.status !== "editing" || markedReady.current) return;
    markedReady.current = true;
    performance.mark?.(reset ? "pubmax:password-recovery:reset-ready" : "pubmax:password-recovery:request-ready");
  }, [configured, ready, reset, state.status]);

  function clearRecovery(): void {
    token.current = null;
    disposeFinisher(finisher.current);
    finisher.current = null;
    setPassword(""); setConfirm("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready || operation.current || !configured) return;
    if (!reset && !parseEmail(email)) {
      dispatch({ type: "failed", message: "Enter a valid email address.", field: "email" });
      return;
    }
    if (reset && !passwordSaved.current) {
      const check = checkPassword(password);
      if (!check.ok || password !== confirm) {
        dispatch({ type: "failed", message: check.ok ? "Passwords do not match." : check.message, field: check.ok ? "confirm" : "password" });
        return;
      }
    }
    const owner = Symbol();
    operation.current = owner;
    const operationToken = token.current;
    const ownsOperation = () => mounted.current && operation.current === owner && token.current === operationToken;
    const baseline = reset ? captureRecoverySessionBaseline() : null;
    if (reset && !baseline) {
      operation.current = null;
      if (passwordSaved.current) {
        clearRecovery();
        dispatch({ type: "sign-in" });
      } else dispatch({ type: "failed", message: "Allow browser storage to reset your password, then try again." });
      return;
    }
    const accountSignal = readProviderAccountSignal();
    dispatch({ type: "submit" });
    try {
      if (!reset) {
        const response = await fetch("/api/auth/password-recovery", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: parseEmail(email) }), signal: AbortSignal.timeout(15_000),
        });
        discardBody(response);
        if (!response.ok) throw new Error();
      } else {
        if (!token.current) { dispatch({ type: "invalid" }); return; }
        finisher.current ??= createPasswordRecoveryFinisher(token.current).catch(error => {
          finisher.current = null;
          throw error;
        });
        const result = await (await finisher.current)(password, () => ownsOperation() && !accountSignal.aborted && baseline?.matches() === true);
        if (!ownsOperation()) return;
        if (result.status === "sign-in") {
          clearRecovery();
          dispatch({ type: "sign-in" });
          return;
        }
        if (result.status === "invalid") { clearRecovery(); dispatch({ type: "invalid", expired: true }); return; }
        passwordSaved.current = result.status === "saved" || result.passwordSaved;
        if (passwordSaved.current) { setPassword(""); setConfirm(""); }
        if (result.status === "retry") {
          dispatch({ type: "failed", message: result.message, passwordSaved: result.passwordSaved, field: result.field });
          return;
        }
        if (accountSignal.aborted) throw new Error();
        const installed = await installRecoveredSession(result.session, () => ownsOperation() && !accountSignal.aborted, baseline);
        if (!ownsOperation()) return;
        if (installed === "unavailable") {
          clearRecovery();
          dispatch({ type: "sign-in" });
          return;
        }
        if (installed !== "installed") throw new Error();
      }
      if (ownsOperation()) {
        clearRecovery();
        dispatch({ type: "complete" });
      }
    } catch {
      if (ownsOperation()) dispatch({ type: "failed", passwordSaved: passwordSaved.current, message: passwordSaved.current
        ? "Your password is saved. Try again to finish signing in."
        : "Could not finish. Check your connection and try again." });
    } finally {
      if (operation.current === owner) operation.current = null;
    }
  }

  const complete = state.status === "complete";
  const showForm = ["editing", "busy", "securing"].includes(state.status);
  const showBackLink = !(reset && (complete || state.status === "sign-in"));
  const title = recoveryTitle(state, reset, securing);
  return (
    <main id="main" className="passwordRecoveryPage" ref={main} tabIndex={-1} aria-labelledby={titleId}>
      <div className="passwordRecoveryInner">
        <Screen className="passwordRecoveryHead" kicker="PUBMAXX" title={title} titleId={titleId} />
        <div className={reset ? "passwordRecoveryBody passwordRecoveryBody--reset" : "passwordRecoveryBody"}>
        {showForm ? (
          <form onSubmit={submit} noValidate method="post" aria-label={reset ? "Reset password" : "Request password reset"} aria-busy={busy}>
            {!reset ? <noscript><p>Turn on JavaScript to request a reset link.</p></noscript> : null}
            {reset && !securing ? (
              <>
                <div className="passwordRecoveryField passwordRecoveryField--password">
                <div className="passwordRecoveryLabel">
                  <label htmlFor="recovery-password">New password</label>
                  <button type="button" aria-controls="recovery-password recovery-confirm" onClick={() => setVisible(!visible)}>
                    {visible ? "Hide passwords" : "Show passwords"}
                  </button>
                </div>
                <input id="recovery-password" spellCheck={false} autoCorrect="off" autoCapitalize="none" type={visible ? "text" : "password"} autoComplete="new-password"
                  minLength={MIN_PASSWORD_LENGTH} required aria-invalid={invalidField === "password"} aria-describedby={`${hintId}${error ? ` ${errorId}` : ""}`} readOnly={busy || securing}
                  value={password} onChange={event => setPassword(event.target.value)} />
                <PasswordPolicyHint value={password} id={hintId} />
                </div>
                <div className="passwordRecoveryField">
                <label htmlFor="recovery-confirm">Confirm new password</label>
                <input id="recovery-confirm" spellCheck={false} autoCorrect="off" autoCapitalize="none" type={visible ? "text" : "password"} autoComplete="new-password"
                  minLength={MIN_PASSWORD_LENGTH} required aria-invalid={invalidField === "confirm"} aria-describedby={error ? errorId : undefined} readOnly={busy || securing}
                  value={confirm} onChange={event => setConfirm(event.target.value)} />
                </div>
              </>
            ) : null}
            {!reset ? (
              <>
                <p>We&apos;ll send a reset link to the email on your account.</p>
                <div className="passwordRecoveryField">
                <label htmlFor="recovery-email">Account email</label>
                <input id="recovery-email" name="email" type="email" autoComplete="email" autoCapitalize="none" spellCheck={false}
                  required aria-invalid={invalidField === "email"} aria-describedby={error ? errorId : undefined} maxLength={MAX_EMAIL_LENGTH} disabled={!ready} readOnly={busy} value={email} onChange={event => setEmail(event.target.value)} />
                </div>
              </>
            ) : null}
            {securing ? <p role="status">{error ?? "Your password is saved. Finishing sign-in…"}</p> : null}
            {error && !securing ? <p role="alert" tabIndex={-1} id={errorId}>{error}</p> : null}
            <Button type="submit" disabled={busy || !configured}>
              {busy ? "Working…" : securing ? "Finish signing in" : reset ? "Save new password" : "Send reset link"}
            </Button>
            {!configured ? <p role="status">Password recovery is unavailable on this build.</p> : null}
          </form>
        ) : <RecoveryNotice state={state} reset={reset} />}
        </div>
        <div className="passwordRecoveryFooter">
          {showBackLink ? <Link href="/login">{reset ? "Back to sign in" : "Sign in with an email link"}</Link> : null}
          {!reset ? <p>An account without an email cannot receive a reset.</p> : null}
        </div>
      </div>
    </main>
  );
}
