"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import SignInButton from "@/components/auth/SignInButton";
import { authedActionFetch } from "@/lib/authedFetch";
import { discardBody } from "@/lib/responseBody";
import { normalizeHandle } from "@/lib/profiles";

import "@/app/messages/messages.css";

// The "Message" control on a profile (PRD E4 / Wave I2). Opens (or finds) the
// conversation via POST /api/messages {action:"open"} with Bearer JWT, then
// navigates to the thread. Signed-out viewers see "Sign in to message".

export default function ProfileMessageButton({
  targetHandle,
  viewerHandle,
}: {
  targetHandle: string;
  viewerHandle: string;
}): React.JSX.Element | null {
  const router = useRouter();
  const { user, handle: authHandle, configured } = useAuth();
  const [busy, setBusy] = useState(false);

  const effectiveViewer = normalizeHandle(authHandle ?? "") || normalizeHandle(viewerHandle);
  if (!targetHandle || targetHandle === effectiveViewer) return null;

  if (!user) {
    if (!configured) return null;
    return (
      <div className="profileMessageSignIn">
        <span className="profileMessageHint">Sign in to message</span>
        <SignInButton />
      </div>
    );
  }

  if (!effectiveViewer) return null;

  async function open() {
    setBusy(true);
    try {
      const res = await authedActionFetch("/api/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "open",
          handle: effectiveViewer,
          other: targetHandle,
        }),
      });
      if (!res.ok) {
        discardBody(res);
        return;
      }
      const body = (await res.json()) as { conversationId?: string };
      if (body.conversationId) {
        router.push(`/messages/${encodeURIComponent(body.conversationId)}`);
      }
    } catch {
      // best-effort — a failed open leaves the profile as-is
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      className="profileMessageBtn"
      onClick={() => void open()}
      disabled={busy}
    >
      Message
    </button>
  );
}
