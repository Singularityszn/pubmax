"use client";

import { useEffect, useState } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import { errorMessageFrom, offlineOrMessage } from "@/lib/apiErrorMessage";
import { authedActionFetch } from "@/lib/authedFetch";
import { normalizeHandle } from "@/lib/profiles";

// Mute and block on someone's profile, the one place a person is named in full.
// Both are the viewer's own choices about Social and nothing else: a mute is
// one-way and silent (their posts leave your lanes), a block is two-way (you
// stop seeing each other's posts and they can't react to yours). Neither is a
// report and neither moves a price. The server answers only what THIS viewer
// set (`read_social_relationship`), never whether the other account blocked
// them. A viewer Social does not admit gets nothing here: the relationship read
// refuses, and the control does not render.

type Relationship = { blocked: boolean; muted: boolean };
type Kind = "mute" | "block";

const FAILED = "Couldn't change that. Try again.";

function parseRelationship(value: unknown): Relationship | null {
  if (!value || typeof value !== "object") return null;
  const relationship = (value as { relationship?: unknown }).relationship;
  if (!relationship || typeof relationship !== "object") return null;
  const { blocked, muted } = relationship as Record<string, unknown>;
  return typeof blocked === "boolean" && typeof muted === "boolean" ? { blocked, muted } : null;
}

export default function ProfileMuteBlock({
  targetHandle,
  viewerHandle,
}: {
  targetHandle: string;
  viewerHandle: string;
}): React.JSX.Element | null {
  const { user, handle: authHandle } = useAuth();
  const viewer = normalizeHandle(authHandle ?? "") || normalizeHandle(viewerHandle);
  const target = normalizeHandle(targetHandle);
  const eligible = Boolean(user) && Boolean(viewer) && Boolean(target) && target !== viewer;
  const [loaded, setLoaded] = useState<{ target: string; relationship: Relationship } | null>(null);
  const [busy, setBusy] = useState<Kind | null>(null);
  const [confirmingBlock, setConfirmingBlock] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!eligible) return;
    const controller = new AbortController();
    authedActionFetch(
      `/api/social/interactions?view=relationship&handle=${encodeURIComponent(target)}`,
      { cache: "no-store", credentials: "same-origin", signal: controller.signal },
      { requiresIdentity: true },
    )
      .then(async (response) => (response.ok ? parseRelationship(await response.json()) : null))
      .then((relationship) => {
        if (relationship) setLoaded({ target, relationship });
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [eligible, target]);

  const relationship = eligible && loaded?.target === target ? loaded.relationship : null;
  if (!relationship) return null;
  const current = relationship;

  async function change(kind: Kind, active: boolean) {
    setBusy(kind);
    setError("");
    try {
      const response = await authedActionFetch("/api/social/interactions", {
        method: active ? "PUT" : "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: kind, targetHandle: target }),
      }, { requiresIdentity: true });
      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);
        setError(offlineOrMessage(errorMessageFrom(body, FAILED)));
        return;
      }
      setLoaded({
        target,
        relationship: kind === "mute"
          ? { blocked: current.blocked, muted: active }
          : { blocked: active, muted: current.muted },
      });
      setConfirmingBlock(false);
    } catch {
      setError(offlineOrMessage(FAILED));
    } finally {
      setBusy(null);
    }
  }

  return (
    <details className="profileMuteBlock">
      <summary>Mute or block</summary>
      <div className="profileMuteBlockBody">
        <p>
          {relationship.muted
            ? `You've muted @${target}. Their posts stay out of your Social lanes.`
            : `Mute @${target} and their posts leave your Social lanes. They won't be told.`}
        </p>
        <button
          type="button"
          className="profileMuteBlockAction"
          disabled={busy !== null}
          onClick={() => void change("mute", !relationship.muted)}
        >
          {relationship.muted ? `Unmute @${target}` : `Mute @${target}`}
        </button>
        <p>
          {relationship.blocked
            ? `You've blocked @${target}. You won't see each other's posts on Social.`
            : `Block @${target} and you won't see each other's posts on Social, and they can't react to yours.`}
        </p>
        {relationship.blocked ? (
          <button
            type="button"
            className="profileMuteBlockAction"
            disabled={busy !== null}
            onClick={() => void change("block", false)}
          >
            {`Unblock @${target}`}
          </button>
        ) : confirmingBlock ? (
          <span className="profileMuteBlockConfirm">
            <button
              type="button"
              className="profileMuteBlockAction"
              data-tone="strong"
              disabled={busy !== null}
              onClick={() => void change("block", true)}
            >
              {`Yes, block @${target}`}
            </button>
            <button
              type="button"
              className="profileMuteBlockAction"
              disabled={busy !== null}
              onClick={() => setConfirmingBlock(false)}
            >
              Keep them
            </button>
          </span>
        ) : (
          <button
            type="button"
            className="profileMuteBlockAction"
            disabled={busy !== null}
            onClick={() => setConfirmingBlock(true)}
          >
            {`Block @${target}`}
          </button>
        )}
        {error ? (
          <p className="profileMuteBlockError" role="status">
            {error}
          </p>
        ) : null}
      </div>
    </details>
  );
}
