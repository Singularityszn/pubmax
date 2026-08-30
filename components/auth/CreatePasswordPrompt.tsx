"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import { authedActionFetch } from "@/lib/authedFetch";
import { claimPromptBudget, hasPromptBudgetFor } from "@/lib/promptBudget";
import {
  PASSWORD_PROMPT_ACCEPT_LABEL,
  PASSWORD_PROMPT_BODY,
  PASSWORD_PROMPT_DECLINE_LABEL,
  PASSWORD_PROMPT_DESTINATION,
  PASSWORD_PROMPT_SURFACE,
  PASSWORD_PROMPT_TITLE,
  markPasswordPromptAnswered,
  readPasswordPromptAnswered,
  shouldOfferPasswordPrompt,
  subscribePasswordPrompt,
} from "@/lib/passwordPrompt";
import { discardBody } from "@/lib/responseBody";
import "@/components/native/nativePushPrompt.css";

/**
 * The ask that was missing. An account signing in by email link was never told
 * a handle sign-in existed, because the create form is mounted only inside the
 * account hub's settings grid.
 *
 * This surface ASKS and hands over. It does not set a password: that is
 * `SetAccountPassword`, bound to the caller's own GoTrue session, and it stays
 * the single place a password is created. Two reasons it is a link rather than
 * an inline form. The form's styling lives in the profile route's own
 * stylesheet, so embedding it here would either pull that sheet into every
 * route or grow a second copy of it that drifts. And this card is fixed to the
 * viewport, which is the one shape the soft keyboard covers (lib/softKeyboard.ts
 * exists for that), so text inputs do not belong in it.
 *
 * `hasPassword` is TRI-STATE. A read that could not answer offers nothing —
 * telling an owner who has a password to create one is the defect the
 * tri-state prevents. Every refusal lives in `shouldOfferPasswordPrompt`.
 */
export default function CreatePasswordPrompt(): React.JSX.Element | null {
  const { configured, user, identityResolved } = useAuth();
  const accountId = user?.id ?? null;
  const [handle, setHandle] = useState<string | null>(null);
  const [hasPassword, setHasPassword] = useState<boolean | null>(null);

  const answered = useSyncExternalStore(
    subscribePasswordPrompt,
    () => readPasswordPromptAnswered(accountId),
    () => false,
  );

  useEffect(() => {
    if (!configured || !user || !identityResolved) {
      void Promise.resolve().then(() => {
        setHandle(null);
        setHasPassword(null);
      });
      return;
    }
    const controller = new AbortController();
    void (async () => {
      try {
        const res = await authedActionFetch("/api/identity/handle/current", {
          signal: controller.signal,
        });
        if (!res.ok) {
          // Between learning a status and leaving, the body is let go.
          discardBody(res);
          if (!controller.signal.aborted) {
            setHandle(null);
            setHasPassword(null);
          }
          return;
        }
        const body = (await res.json().catch(() => ({}))) as {
          handle?: string | null;
          hasPassword?: boolean | null;
        };
        if (controller.signal.aborted) return;
        setHandle(
          typeof body.handle === "string" && body.handle.length > 0
            ? body.handle
            : null,
        );
        setHasPassword(
          typeof body.hasPassword === "boolean" ? body.hasPassword : null,
        );
      } catch {
        if (!controller.signal.aborted) {
          setHandle(null);
          setHasPassword(null);
        }
      }
    })();
    return () => controller.abort();
  }, [configured, identityResolved, user]);

  const owed = shouldOfferPasswordPrompt({
    configured,
    accountId,
    identityResolved,
    handle,
    hasPassword,
    answered,
  });
  const canShow = owed && hasPromptBudgetFor(PASSWORD_PROMPT_SURFACE);

  useEffect(() => {
    if (canShow) claimPromptBudget(PASSWORD_PROMPT_SURFACE);
  }, [canShow]);

  if (!canShow) return null;

  return (
    <div className="nativePushPrompt">
      <div
        className="nativePushPrompt__card"
        role="dialog"
        aria-modal="false"
        aria-labelledby="create-password-prompt-title"
        aria-describedby="create-password-prompt-body"
      >
        <p id="create-password-prompt-title" className="nativePushPrompt__title">
          {PASSWORD_PROMPT_TITLE}
        </p>
        <p id="create-password-prompt-body" className="nativePushPrompt__body">
          {PASSWORD_PROMPT_BODY}
        </p>
        <div className="nativePushPrompt__actions">
          <button
            type="button"
            className="nativePushPrompt__later pressable"
            onClick={() => markPasswordPromptAnswered(accountId)}
          >
            {PASSWORD_PROMPT_DECLINE_LABEL}
          </button>
          <Link
            prefetch={false}
            href={PASSWORD_PROMPT_DESTINATION}
            className="nativePushPrompt__enable pressable"
            onClick={() => markPasswordPromptAnswered(accountId)}
          >
            {PASSWORD_PROMPT_ACCEPT_LABEL}
          </Link>
        </div>
      </div>
    </div>
  );
}
