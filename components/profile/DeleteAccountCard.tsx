"use client";

// The in-app account-deletion door (App Store 5.1.1(v), Play's 2024 policy).
//
// TWO BEATS and one action. The first beat is a plain control; the second is the
// account of what happens, in the reader's own account surface, before anything
// is sent. The words come from `lib/accountDeletion.ts`, which is held to the
// `0078` trigger that actually does the work, so this card cannot promise a
// deletion the database does not perform.
//
// Identity is TRI-STATE like every other surface that names the viewer: nothing
// is offered until the live session answers. A confident "no account here" from
// a read that failed would hide the door a store reviewer is looking for.
//
// On success the existing sign-out path runs, so the device-identity artifact
// set and the durable resume cookie leave together. The scope is "account", not
// "device": a second account remembered on this phone did not ask to leave.

import { useRouter } from "next/navigation";
import { useState } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import { useViewerSession } from "@/components/auth/useViewerSession";
import {
  ACCOUNT_DELETION_BUSY_LINE,
  ACCOUNT_DELETION_CANCEL_LABEL,
  ACCOUNT_DELETION_CONFIRM_LABEL,
  ACCOUNT_DELETION_DONE_LINE,
  ACCOUNT_DELETION_FAILED_LINE,
  ACCOUNT_DELETION_LEAVES,
  ACCOUNT_DELETION_LEDE,
  ACCOUNT_DELETION_OPEN_LABEL,
  ACCOUNT_DELETION_SESSION_LINE,
  ACCOUNT_DELETION_STAYS,
  ACCOUNT_DELETION_TITLE,
} from "@/lib/accountDeletion";
import { errorMessageFrom } from "@/lib/apiErrorMessage";
import { AuthActionSessionError, authedActionFetch } from "@/lib/authedFetch";

type Phase = "idle" | "confirming" | "deleting" | "deleted";

export default function DeleteAccountCard(): React.JSX.Element | null {
  const { user, signOut } = useAuth();
  const viewerSession = useViewerSession();
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [notice, setNotice] = useState<string | null>(null);

  async function deleteAccount(): Promise<void> {
    setPhase("deleting");
    setNotice(ACCOUNT_DELETION_BUSY_LINE);
    try {
      const response = await authedActionFetch(
        "/api/account",
        { method: "DELETE" },
        { requiresIdentity: true },
      );
      const body = (await response.json().catch(() => ({}))) as {
        deleted?: boolean;
        error?: string;
      };
      // `deleted: true` is the answer, whatever the status: a fresh delete is
      // 200 and a repeat from a browser that never saw the first answer is 410,
      // and both mean the account is gone.
      if (body.deleted !== true) {
        setPhase("confirming");
        setNotice(errorMessageFrom(body, ACCOUNT_DELETION_FAILED_LINE));
        return;
      }
      setPhase("deleted");
      setNotice(ACCOUNT_DELETION_DONE_LINE);
      // The account is gone on the server, so this browser must not keep its
      // artifacts even if the sign-out itself stumbles. Land on the front door
      // either way rather than on a profile for an account that has left.
      try {
        await signOut("account");
      } finally {
        router.replace("/");
      }
    } catch (error) {
      setPhase("confirming");
      setNotice(
        error instanceof AuthActionSessionError
          ? ACCOUNT_DELETION_SESSION_LINE
          : ACCOUNT_DELETION_FAILED_LINE,
      );
    }
  }

  // Nothing at all until the live session answers, and nothing for a stranger.
  if (!user || viewerSession.unresolved) return null;

  return (
    <div className="accountHubDelete" id="delete-account">
      <h3>{ACCOUNT_DELETION_TITLE}</h3>
      <p>{ACCOUNT_DELETION_LEDE}</p>
      {phase === "idle" ? (
        <button
          type="button"
          className="accountHubDeleteOpen"
          onClick={() => {
            setNotice(null);
            setPhase("confirming");
          }}
        >
          {ACCOUNT_DELETION_OPEN_LABEL}
        </button>
      ) : (
        <div
          className="accountHubDeleteConfirm"
          role="group"
          aria-labelledby="delete-account-confirm-title"
        >
          <h4 id="delete-account-confirm-title">What leaves</h4>
          <ul>
            {ACCOUNT_DELETION_LEAVES.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <h4>What stays</h4>
          <ul>
            {ACCOUNT_DELETION_STAYS.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <div className="accountHubActions">
            <button
              type="button"
              className="accountHubDeleteConfirmBtn"
              disabled={phase !== "confirming"}
              onClick={() => void deleteAccount()}
            >
              {ACCOUNT_DELETION_CONFIRM_LABEL}
            </button>
            <button
              type="button"
              className="accountHubDeleteCancel"
              disabled={phase !== "confirming"}
              onClick={() => {
                setNotice(null);
                setPhase("idle");
              }}
            >
              {ACCOUNT_DELETION_CANCEL_LABEL}
            </button>
          </div>
        </div>
      )}
      {notice ? (
        <p role="status" className="accountHubDeleteNotice">
          {notice}
        </p>
      ) : null}
    </div>
  );
}
