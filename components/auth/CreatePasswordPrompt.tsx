"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import { readAuthedIdentity } from "@/lib/currentIdentityRead";
import {
  claimPromptBudget,
  hasPromptBudgetFor,
  promptBudgetHolder,
  releasePromptBudget,
  routeOwnsScreenFoot,
  subscribePromptBudget,
} from "@/lib/promptBudget";
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
  const [statusAccountId, setStatusAccountId] = useState<string | null>(null);
  const [answeredLocallyFor, setAnsweredLocallyFor] = useState<string | null>(null);
  const promptRendered = useRef(false);

  const subscribeForAccount = useCallback(
    (onStoreChange: () => void) =>
      subscribePasswordPrompt(onStoreChange, accountId),
    [accountId],
  );

  const persistedAnswer = useSyncExternalStore(
    subscribeForAccount,
    () => readPasswordPromptAnswered(accountId),
    () => false,
  );
  const answered = persistedAnswer || answeredLocallyFor === accountId;

  useEffect(() => {
    if (!configured || !user || !identityResolved) {
      void Promise.resolve().then(() => {
        setHandle(null);
        setHasPassword(null);
        setStatusAccountId(null);
      });
      return;
    }
    const requestedAccountId = accountId;
    const controller = new AbortController();
    void (async () => {
      try {
        // One read per page, shared with every other surface that asks who
        // this is (lib/currentIdentityRead.ts), so it carries no signal of its
        // own: this effect checks its own below.
        const res = await readAuthedIdentity(user.id);
        if (!res.ok) {
          if (!controller.signal.aborted) {
            setHandle(null);
            setHasPassword(null);
            setStatusAccountId(requestedAccountId);
          }
          return;
        }
        const body = (res.body ?? {}) as {
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
        setStatusAccountId(requestedAccountId);
      } catch {
        if (!controller.signal.aborted) {
          setHandle(null);
          setHasPassword(null);
          setStatusAccountId(requestedAccountId);
        }
      }
    })();
    return () => controller.abort();
  }, [accountId, configured, identityResolved, user]);

  const pathname = usePathname();
  const hasBudget = useSyncExternalStore(
    subscribePromptBudget,
    () => !routeOwnsScreenFoot(pathname, window.innerWidth)
      && hasPromptBudgetFor(PASSWORD_PROMPT_SURFACE),
    () => false,
  );
  const budgetHolder = useSyncExternalStore(
    subscribePromptBudget,
    () => promptBudgetHolder(),
    () => null,
  );
  const owed = shouldOfferPasswordPrompt({
    configured,
    accountId,
    identityResolved,
    handle: statusAccountId === accountId ? handle : null,
    hasPassword: statusAccountId === accountId ? hasPassword : null,
    answered,
  });
  const eligible = owed && hasBudget;

  // The claim is a side effect on shared state, so it belongs in an effect and
  // its ANSWER decides whether this card may paint. Both the claim result and
  // the "did we actually paint" mark are settled here rather than during
  // render: a ref written while rendering is read back inconsistently once
  // React can retry or discard a render, and a setState in the effect BODY
  // schedules a second pass before the first has committed.
  useEffect(() => {
    if (!eligible) return;
    const claimed = claimPromptBudget(PASSWORD_PROMPT_SURFACE);
    return () => {
      // Release only a claim this card never spent on a visible prompt. If it
      // painted, the answer path owns the release, or the person is still
      // looking at it.
      if (claimed && !promptRendered.current) {
        releasePromptBudget(PASSWORD_PROMPT_SURFACE);
      }
      promptRendered.current = false;
    };
  }, [eligible]);

  // Whether WE hold the budget is already published by the same store the
  // eligibility read subscribes to, so it is DERIVED rather than copied into
  // component state. Copying it meant a setState in the effect body, which
  // schedules a second render pass before the first has committed, and it gave
  // the same fact two owners that could disagree.
  const canShow = eligible && budgetHolder === PASSWORD_PROMPT_SURFACE;

  useEffect(() => {
    if (canShow) promptRendered.current = true;
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
            onClick={() => {
              setAnsweredLocallyFor(accountId);
              markPasswordPromptAnswered(accountId);
            }}
          >
            {PASSWORD_PROMPT_DECLINE_LABEL}
          </button>
          <Link
            prefetch={false}
            href={PASSWORD_PROMPT_DESTINATION}
            className="nativePushPrompt__enable pressable"
            onClick={() => {
              setAnsweredLocallyFor(accountId);
              markPasswordPromptAnswered(accountId);
            }}
          >
            {PASSWORD_PROMPT_ACCEPT_LABEL}
          </Link>
        </div>
      </div>
    </div>
  );
}
