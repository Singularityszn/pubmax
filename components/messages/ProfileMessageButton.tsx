"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import "@/app/messages/messages.css";

// The "Message" control on a profile (PRD E4) — one additive button. Opens (or
// finds) the conversation between the viewer and this handle via POST
// /api/messages {action:"open"}, then navigates to the thread. The viewer's
// self-asserted handle is passed by the profile page (localStorage pubmax_handle);
// the button only renders when both handles are present and distinct, so it never
// tries to open a self-conversation.

export default function ProfileMessageButton({
  targetHandle,
  viewerHandle,
}: {
  targetHandle: string;
  viewerHandle: string;
}): React.JSX.Element | null {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  if (!targetHandle || !viewerHandle || targetHandle === viewerHandle) return null;

  async function open() {
    setBusy(true);
    try {
      const res = await fetch("/api/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "open", handle: viewerHandle, other: targetHandle }),
      });
      if (!res.ok) return;
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
