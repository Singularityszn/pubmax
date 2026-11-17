"use client";

import { FormEvent, useEffect, useState, useSyncExternalStore } from "react";

import AuthAccountBannedNotice from "@/components/auth/AuthAccountBannedNotice";
import { useAuth } from "@/components/auth/AuthProvider";
import { navigateAfterHandlePasswordSignIn } from "@/components/auth/HandlePasswordSignIn";
import { Button } from "@/components/ui/button";
import { ensureSupabaseBrowser } from "@/lib/authClient";
import { loadPhoneSignInAvailable } from "@/lib/authProviderAvailability";
import { persistSessionForResume } from "@/lib/authSessionResumeClient";
import { offlineOrMessage } from "@/lib/apiErrorMessage";
import { trackEvent } from "@/lib/analytics";
import {
  checkPhoneCode,
  displayPhoneNumber,
  parsePhoneNumber,
  PHONE_CODE_RESEND_SECONDS,
  PHONE_NUMBER_INVALID_MESSAGE,
  requestPhoneCode,
} from "@/lib/phoneSignIn";

const subscribeNever = () => () => {};

/** False on the server and through hydration, true once React owns the page. */
function useHydrated(): boolean {
  return useSyncExternalStore(subscribeNever, () => true, () => false);
}

type PhoneSignInProps = {
  disabled?: boolean;
  /** Where to land once the session is live; this form signs in in place. */
  redirectTo?: string | null;
};

type Step = "closed" | "number" | "code";

/**
 * Sign in with a code sent by text. The whole exchange happens on this page:
 * the code is checked by the browser Supabase client, which fires the ordinary
 * SIGNED_IN event, so identity binds in the one place every other door uses.
 * The door is drawn only when the dashboard has phone sign-in switched on.
 */
export default function PhoneSignIn({
  disabled = false,
  redirectTo = null,
}: PhoneSignInProps): React.JSX.Element {
  const { configured } = useAuth();
  const [available, setAvailable] = useState(false);
  const [step, setStep] = useState<Step>("closed");
  const [phone, setPhone] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [banned, setBanned] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const hydrated = useHydrated();

  useEffect(() => {
    if (!configured) return;
    let live = true;
    void loadPhoneSignInAvailable().then((open) => {
      if (live) setAvailable(open === true);
    });
    return () => {
      live = false;
    };
  }, [configured]);

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = setTimeout(() => setResendIn((left) => left - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendIn]);

  if (!configured || !available) return <></>;

  async function sendCode(number: string) {
    setError(null);
    setNotice(null);
    setBanned(false);
    if (!parsePhoneNumber(number)) {
      setError(PHONE_NUMBER_INVALID_MESSAGE);
      return;
    }
    setBusy(true);
    trackEvent("sign_in_initiated", { provider: "phone" });
    try {
      const supabase = await ensureSupabaseBrowser();
      if (!supabase) {
        setError("Sign-in is not configured on this build.");
        return;
      }
      const result = await requestPhoneCode(supabase.auth, number);
      if (result.status === "sent") {
        setSentTo(parsePhoneNumber(number));
        setStep("code");
        setCode("");
        setNotice(result.message);
        setResendIn(PHONE_CODE_RESEND_SECONDS);
        return;
      }
      setError(result.message);
    } catch {
      setError(offlineOrMessage("We could not send a code right now. Try again shortly."));
    } finally {
      setBusy(false);
    }
  }

  async function onSendCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || disabled) return;
    await sendCode(phone);
  }

  async function onCheckCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || disabled || !sentTo) return;
    setError(null);
    setBanned(false);
    setBusy(true);
    try {
      const supabase = await ensureSupabaseBrowser();
      if (!supabase) {
        setError("Sign-in is not configured on this build.");
        return;
      }
      const result = await checkPhoneCode(supabase.auth, sentTo, code);
      if (result.status === "banned") {
        setBanned(true);
        return;
      }
      if (result.status !== "signed_in") {
        setError(result.message);
        return;
      }
      void persistSessionForResume({
        access_token: result.session.access_token,
        refresh_token: result.session.refresh_token,
      });
      navigateAfterHandlePasswordSignIn(redirectTo, window.location);
    } catch {
      setError(offlineOrMessage("We could not check that code right now. Try again shortly."));
    } finally {
      setBusy(false);
    }
  }

  function close() {
    setStep("closed");
    setError(null);
    setNotice(null);
    setBanned(false);
    setCode("");
  }

  if (step === "closed") {
    return (
      <button
        type="button"
        className="loginPageQuietLink loginPageHandlePasswordToggle"
        data-testid="e2e-login-phone-toggle"
        disabled={!hydrated || disabled || busy}
        onClick={() => setStep("number")}
      >
        Sign in with your phone number
      </button>
    );
  }

  const feedback = (
    <>
      {banned ? <AuthAccountBannedNotice className="authError loginPageError" /> : null}
      {error ? (
        <p className="authError loginPageError" role="alert">
          {error}
        </p>
      ) : null}
    </>
  );

  if (step === "number" || !sentTo) {
    return (
      <form
        className="loginPageHandlePassword"
        autoComplete="on"
        onSubmit={onSendCode}
        aria-label="Sign in with your phone number"
      >
        <h2 className="loginPageHandlePasswordTitle">Sign in with your phone number</h2>
        <label className="loginPageHandlePasswordField">
          UK mobile number
          <input
            type="tel"
            name="tel"
            data-testid="e2e-login-phone"
            autoComplete="tel"
            inputMode="tel"
            placeholder="07700 900123"
            required
            disabled={busy || disabled}
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
          />
        </label>
        <p className="loginPageHandlePasswordGuidance">
          We text you a code. Normal text rates may apply.
        </p>
        <div className="loginPageHandlePasswordActions">
          <Button type="submit" variant="secondary" data-testid="e2e-login-phone-send" disabled={busy || disabled}>
            {busy ? "Sending…" : "Text me a code"}
          </Button>
          <button type="button" className="loginPageQuietLink" disabled={busy} onClick={close}>
            Back to email link
          </button>
        </div>
        {feedback}
      </form>
    );
  }

  return (
    <form
      className="loginPageHandlePassword"
      autoComplete="on"
      onSubmit={onCheckCode}
      aria-label="Enter the code from the text"
    >
      <h2 className="loginPageHandlePasswordTitle">Enter the code from the text</h2>
      {notice ? (
        <p className="loginPageHandlePasswordGuidance" role="status">
          {notice} We sent it to {displayPhoneNumber(sentTo)}.
        </p>
      ) : null}
      <label className="loginPageHandlePasswordField">
        Code
        <input
          type="text"
          name="one-time-code"
          data-testid="e2e-login-phone-code"
          autoComplete="one-time-code"
          inputMode="numeric"
          pattern="[0-9 ]{6,12}"
          maxLength={12}
          required
          disabled={busy || disabled}
          value={code}
          onChange={(event) => setCode(event.target.value)}
        />
      </label>
      <div className="loginPageHandlePasswordActions">
        <Button type="submit" variant="secondary" data-testid="e2e-login-phone-check" disabled={busy || disabled}>
          {busy ? "Signing in…" : "Sign in"}
        </Button>
        <button
          type="button"
          className="loginPageQuietLink"
          disabled={busy || resendIn > 0}
          onClick={() => void sendCode(sentTo)}
        >
          {resendIn > 0 ? `Send a new code in ${resendIn}s` : "Send a new code"}
        </button>
        <button
          type="button"
          className="loginPageQuietLink"
          disabled={busy}
          onClick={() => {
            setStep("number");
            setError(null);
            setNotice(null);
            setCode("");
          }}
        >
          Use a different number
        </button>
      </div>
      {feedback}
    </form>
  );
}
