"use client";

// The viewer's own mute and block list, in account settings. Mute and block are
// set on a profile (components/social/ProfileMuteBlock.tsx); this is the one
// place to see them all and take one back. It reads only what THIS account set
// (`/api/social/interactions?view=relationships`), never who blocked it, and
// it changes a row through the same write the profile control uses.
//
// A viewer Social does not admit has no list to manage, so a refused read
// renders nothing rather than a broken card.

import { useEffect, useState } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import { Button } from "@/components/ui/button";
import { errorMessageFrom, offlineOrMessage } from "@/lib/apiErrorMessage";
import { authedActionFetch } from "@/lib/authedFetch";

type Entry = { handle: string; since: string | null };
type Lists = { blocked: Entry[]; muted: Entry[] };
type Kind = "block" | "mute";

const READ_FAILED = "Couldn't load your list. Try again.";
const CHANGE_FAILED = "Couldn't change that. Try again.";

function parseEntries(value: unknown): Entry[] | null {
  if (!Array.isArray(value)) return null;
  const entries: Entry[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const { handle, since } = item as Record<string, unknown>;
    if (typeof handle !== "string" || !handle) continue;
    entries.push({ handle, since: typeof since === "string" ? since : null });
  }
  return entries;
}

function parseLists(body: unknown): Lists | null {
  if (!body || typeof body !== "object") return null;
  const relationships = (body as { relationships?: unknown }).relationships;
  if (!relationships || typeof relationships !== "object") return null;
  const blocked = parseEntries((relationships as Record<string, unknown>).blocked);
  const muted = parseEntries((relationships as Record<string, unknown>).muted);
  return blocked && muted ? { blocked, muted } : null;
}

export default function BlockedAccountsCard(): React.JSX.Element | null {
  const { user, identityResolved } = useAuth();
  const userId = user?.id ?? null;
  const [lists, setLists] = useState<{ userId: string; lists: Lists } | null>(null);
  const [hidden, setHidden] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!userId || !identityResolved) return;
    const controller = new AbortController();
    authedActionFetch(
      "/api/social/interactions?view=relationships",
      { cache: "no-store", credentials: "same-origin", signal: controller.signal },
      { requiresIdentity: true },
    )
      .then(async (response) => {
        if (response.status === 401 || response.status === 403) {
          setHidden(true);
          return;
        }
        const parsed = response.ok ? parseLists(await response.json().catch(() => null)) : null;
        if (parsed) {
          setLists({ userId, lists: parsed });
          setHidden(false);
          setError("");
        } else {
          setError(READ_FAILED);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(offlineOrMessage(READ_FAILED));
      });
    return () => controller.abort();
  }, [userId, identityResolved, attempt]);

  if (!userId || hidden) return null;
  const current = lists?.userId === userId ? lists.lists : null;

  async function undo(kind: Kind, handle: string) {
    setBusy(`${kind}:${handle}`);
    setError("");
    try {
      const response = await authedActionFetch(
        "/api/social/interactions",
        {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: kind, targetHandle: handle }),
        },
        { requiresIdentity: true },
      );
      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);
        setError(offlineOrMessage(errorMessageFrom(body, CHANGE_FAILED)));
        return;
      }
      setLists((previous) => {
        if (!previous) return previous;
        const key = kind === "block" ? "blocked" : "muted";
        return {
          userId: previous.userId,
          lists: { ...previous.lists, [key]: previous.lists[key].filter((entry) => entry.handle !== handle) },
        };
      });
    } catch {
      setError(offlineOrMessage(CHANGE_FAILED));
    } finally {
      setBusy(null);
    }
  }

  function rows(kind: Kind, entries: Entry[]) {
    const verb = kind === "block" ? "Unblock" : "Unmute";
    return (
      <ul className="accountHubRelationshipList">
        {entries.map((entry) => (
          <li key={entry.handle}>
            <span>@{entry.handle}</span>
            <Button
              type="button"
              variant="secondary"
              disabled={busy !== null}
              aria-label={`${verb} @${entry.handle}`}
              onClick={() => void undo(kind, entry.handle)}
            >
              {verb}
            </Button>
          </li>
        ))}
      </ul>
    );
  }

  const empty = current !== null && current.blocked.length === 0 && current.muted.length === 0;

  return (
    <section className="accountHubRelationships" aria-labelledby="account-relationships-title">
      <h4 id="account-relationships-title">Blocked and muted</h4>
      {current === null && !error ? <p>Loading your list.</p> : null}
      {empty ? <p>Nobody muted or blocked.</p> : null}
      {current && current.blocked.length > 0 ? (
        <>
          <p>Blocked. You don&rsquo;t see each other&rsquo;s posts on Social.</p>
          {rows("block", current.blocked)}
        </>
      ) : null}
      {current && current.muted.length > 0 ? (
        <>
          <p>Muted. Their posts stay out of your Social lanes.</p>
          {rows("mute", current.muted)}
        </>
      ) : null}
      {error ? (
        <p className="accountHubMessage" role="alert">
          {error}
          {current === null ? (
            <>
              {" "}
              <Button type="button" variant="secondary" onClick={() => setAttempt((n) => n + 1)}>
                Load again
              </Button>
            </>
          ) : null}
        </p>
      ) : null}
    </section>
  );
}
