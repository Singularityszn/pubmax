"use client";

import { useCallback, useId, useState } from "react";
import { Mail } from "lucide-react";

import { trackEvent } from "@/lib/analytics";
import type { MagicLinkResult } from "@/lib/passwordlessAuth";

function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export default function MagicLinkForm({
  disabled,
  hasSocialProviders,
  signInWithEmail,
  cancelAuthAttempt,
  label,
  submitLabel,
  primaryAction = false,
}: {
  disabled: boolean;
  hasSocialProviders: boolean;
  signInWithEmail: (email: string) => Promise<MagicLinkResult>;
  cancelAuthAttempt: () => void;
  /** Overrides the field label so a sign-up door does not read as a sign-in. */
  label?: string;
  /** Overrides the idle button label for the same reason. */
  submitLabel?: string;
  /**
   * On /login this submit is the page's ONE painted control, so it carries the
   * launch-screen marker; the nav popover mounts the same form beside a page
   * that already has a primary and passes nothing.
   */
  primaryAction?: boolean;
}): React.JSX.Element {
  const inputId = useId();
  const messageId = useId();
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | MagicLinkResult["status"]>("idle");
  const [message, setMessage] = useState("");
  const valid = looksLikeEmail(email);
  // /login server-renders this field, so a reader can type into it before
  // hydration. React keeps that DOM value but not the state, and the next
  // render would reset the field to "". Adopt it as the field attaches.
  const adoptTypedEmail = useCallback((input: HTMLInputElement | null) => {
    if (input?.value) setEmail(input.value);
  }, []);

  const submit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (!valid || disabled || status === "sending" || status === "sent") return;
      trackEvent("sign_in_initiated", { provider: "email" });
      setStatus("sending");
      setMessage("");
      const result = await signInWithEmail(email);
      setStatus(result.status);
      setMessage(result.message);
    },
    [disabled, email, signInWithEmail, status, valid],
  );

  const cancel = useCallback(() => {
    cancelAuthAttempt();
    setStatus("idle");
    setMessage("");
    setEmail("");
  }, [cancelAuthAttempt]);

  return (
    <form className="authMagicLink" onSubmit={submit} noValidate>
      <label className="authMagicLinkLabel" htmlFor={inputId}>
        {label ?? (hasSocialProviders ? "Or continue with email" : "Continue with email")}
      </label>
      <div className="authMagicLinkRow">
        <input
          ref={adoptTypedEmail}
          id={inputId}
          className="authMagicLinkInput"
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          disabled={disabled || status === "sending" || status === "sent"}
          aria-invalid={status === "error"}
          aria-describedby={message ? messageId : undefined}
          onChange={(event) => {
            setEmail(event.target.value);
            if (status === "error" || status === "rate_limited") {
              setStatus("idle");
              setMessage("");
            }
          }}
        />
        <button
          type="submit"
          className="authSignIn authMagicLinkButton"
          data-primary-action={primaryAction ? "" : undefined}
          disabled={!valid || disabled || status === "sending" || status === "sent"}
        >
          <Mail size={18} aria-hidden="true" />
          {status === "sending"
            ? "Sending…"
            : status === "sent"
              ? "Link sent"
              : submitLabel ?? "Email me a link"}
        </button>
        {status === "sent" ? (
          <button
            type="button"
            className="authMagicLinkCancel"
            onClick={cancel}
          >
            Cancel sign-in
          </button>
        ) : null}
      </div>
      {message ? (
        <p
          id={messageId}
          className={status === "sent" ? "authMagicLinkSuccess" : "authError"}
          role={status === "sent" ? "status" : "alert"}
          aria-live="polite"
        >
          {message}
        </p>
      ) : null}
    </form>
  );
}
