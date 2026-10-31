"use client";

import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import { useViewerSession } from "@/components/auth/useViewerSession";
import { authedActionFetch } from "@/lib/authedFetch";
import { errorMessageFrom, offlineOrMessage } from "@/lib/apiErrorMessage";
import { normalizeHandle } from "@/lib/profiles";

import "@/app/messages/messages.css";
import { useMessageAdultGate } from "./useMessageAdultGate";

// The "Message" control on a profile (PRD E4 / Wave I2). Opens (or finds) the
// conversation via POST /api/messages {action:"open"} with Bearer JWT, then
// navigates to the thread. Signed-out viewers see one quiet "Sign in to
// message" link to /login - but ONLY once the live session has answered nobody
// (useViewerSession). A null user on its own is not sign-out, and painting the
// door on it put a "Continue with email" form on a signed-in drinker's own
// profile. It used to BE that whole form (Google, Microsoft, email) in the
// profile hero, which pushed the bio below the fold on a phone (taste plan,
// 18 Oct 2026); the sign-in page owns the form.

export default function ProfileMessageButton({
  targetHandle,
  viewerHandle,
}: {
  targetHandle: string;
  viewerHandle: string;
}): React.JSX.Element | null {
  const router = useRouter();
  const { user, handle: authHandle, configured } = useAuth();
  const viewerSession = useViewerSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { fromRefusal, adultGateDialog } = useMessageAdultGate();

  const effectiveViewer = normalizeHandle(authHandle ?? "") || normalizeHandle(viewerHandle);
  if (!targetHandle || targetHandle === effectiveViewer) return null;

  if (!user) {
    if (!configured) return null;
    // The session has not answered: name nothing, offer nothing.
    if (!viewerSession.signedOut) return null;
    const back = `/u/${encodeURIComponent(targetHandle)}`;
    const href = `/login?mode=signin&from=${encodeURIComponent(back)}` as Route;
    return (
      <Link className="profileMessageSignIn" href={href}>
        Sign in to message
      </Link>
    );
  }

  if (!effectiveViewer) return null;

  async function open() {
    setBusy(true);
    setError("");
    try {
      const res = await authedActionFetch("/api/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "open",
          handle: effectiveViewer,
          other: targetHandle,
        }),
      }, { requiresIdentity: true });
      if (!res.ok) {
        const body: unknown = await res.json().catch(() => null);
        if (fromRefusal(body, () => void open())) return;
        setError(
          offlineOrMessage(errorMessageFrom(body, "Could not open messages. Try again."))
        );
        return;
      }
      const body = (await res.json()) as { conversationId?: string };
      if (body.conversationId) {
        router.push(`/messages/${encodeURIComponent(body.conversationId)}`);
      } else {
        setError("Could not open messages. Try again.");
      }
    } catch {
      setError(
        offlineOrMessage("Could not open messages. Try again.")
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="profileMessageBtn"
        onClick={() => void open()}
        disabled={busy}
      >
        Message
      </button>
      {error ? (
        <p className="profileMessageError" role="status">
          {error}
        </p>
      ) : null}
      {adultGateDialog}
    </>
  );
}
