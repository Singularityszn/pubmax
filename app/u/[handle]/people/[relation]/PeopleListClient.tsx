"use client";

// Followers and Following for one handle, and who among them is a mate.
//
// Both directions read the same shape (a list of `FollowListEntry` rows) from
// their own public route, through the ONE parser in lib/followList.ts, and the
// mutual overlay is the intersection with this handle's /lot.
// That matters because the two lists look identical otherwise: a follower who
// is also followed back is a MATE, and a list that cannot say so is a list of
// strangers. The relation word comes from lib/followRelation.ts so this file
// holds no policy.
//
// Public projection only. A handle plus, when the profile read offers it, a
// display name and an owned avatar. Nothing else about a person travels here.

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import { useViewerSession } from "@/components/auth/useViewerSession";
import { readProviderIdentityRevision } from "@/lib/authProviderRevision";
import { waitUnlessAborted } from "@/lib/abortableDelay";
import { discardBody } from "@/lib/responseBody";
import { authedFetch } from "@/lib/authedFetch";
import { followRelationHint, resolveFollowRelation } from "@/lib/followRelation";
import { displayHandle } from "@/lib/handleDisplay";
import { type FollowListEntry, parseFollowListEntry } from "@/lib/followList";
import { normalizeHandle } from "@/lib/profiles";
import { SURFACE_CACHE_RETRY_BACKOFF_MS } from "@/lib/surfaceDataCache";
import { useReconnectRecovery } from "@/lib/useReconnectRecovery";
import { useSocialFriendsLaunch } from "@/lib/useSocialFriendsLaunch";
import { SocialAccessBoundary } from "@/app/social/SocialPageClient";

import "@/components/social/peopleDirectory.css";

export type PeopleRelation = "followers" | "following";

type LoadState = "loading" | "ready" | "error";

const TITLE: Record<PeopleRelation, string> = {
  followers: "Followers",
  following: "Following",
};

const EMPTY: Record<PeopleRelation, string> = {
  followers: "Nobody follows this handle yet.",
  following: "This handle follows nobody yet.",
};

const OFFLINE_ERROR = "You look offline. We will retry when you are back.";

type PeopleListResponse = Record<string, unknown>;
type PeopleLotResponse = { lot?: unknown };
type PeopleRead = {
  key: string;
  status: LoadState;
  people: FollowListEntry[];
  mutuals: Set<string>;
};

function emptyRead(key: string, status: LoadState = "loading"): PeopleRead {
  return { key, status, people: [], mutuals: new Set() };
}

function initial(handle: string): string {
  const clean = normalizeHandle(handle);
  return clean ? clean.slice(0, 1).toUpperCase() : "?";
}

// Owner-sensitive answers are never shared or held past this request.
// Preserve the existing one transient retry and abortable backoff.
async function readPeopleJson<T>(
  url: string,
  signal: AbortSignal,
  requiresIdentity: boolean,
  validate: (value: T) => boolean,
): Promise<T | undefined> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (signal.aborted) return undefined;
    try {
      const response = await authedFetch(url, { signal, cache: "no-store" }, { requiresIdentity });
      if (!response.ok) {
        const retryable = [408, 425, 429].includes(response.status) || response.status >= 500;
        discardBody(response);
        if (!retryable) return undefined;
      } else {
        const body = (await response.json()) as T;
        if (signal.aborted) return undefined;
        if (validate(body)) return body;
      }
    } catch {
      if (signal.aborted) return undefined;
    }
    if (attempt === 0 && !await waitUnlessAborted(SURFACE_CACHE_RETRY_BACKOFF_MS, signal)) return undefined;
  }
  return undefined;
}

export default function PeopleListClient({
  handle,
  relation,
}: {
  handle: string;
  relation: PeopleRelation;
}) {
  const socialFriendsLaunchEnabled = useSocialFriendsLaunch();
  const { accountRevision } = useAuth();
  const { phase } = useViewerSession();
  const [attempt, setAttempt] = useState(0);
  const readKey = JSON.stringify([accountRevision, phase, handle, relation, attempt]);
  const [storedRead, setStoredRead] = useState<PeopleRead | null>(null);
  // Mask the previous viewer's answer in the first new-viewer render, before
  // effect cleanup or a replacement response can run.
  const { status, people, mutuals } = storedRead?.key === readKey
    ? storedRead
    : emptyRead(readKey);

  useEffect(() => {
    if (!socialFriendsLaunchEnabled) return;
    const controller = new AbortController();
    const isCurrent = () => !controller.signal.aborted && readProviderIdentityRevision() === accountRevision;
    const requiresIdentity = phase === "signed-in";
    void (async () => {
      const listKey = `/api/profiles/${encodeURIComponent(handle)}/${relation}`;
      const lotKey = `/api/profiles/${encodeURIComponent(handle)}/lot`;
      const listPromise = readPeopleJson<PeopleListResponse>(
        listKey, controller.signal, requiresIdentity,
        (body) => Array.isArray(body?.[relation]),
      ).then((body) => {
        if (!isCurrent()) return;
        setStoredRead((current) => {
          if (!isCurrent()) return current;
          const owned = current?.key === readKey ? current : emptyRead(readKey);
          if (!body) return { ...owned, status: "error", people: [] };
          const rows = body[relation] as unknown[];
          return {
            ...owned,
            status: "ready",
            people: rows.map(parseFollowListEntry).filter((row): row is FollowListEntry => row !== null),
          };
        });
      });
      const lotPromise = readPeopleJson<PeopleLotResponse>(
        lotKey, controller.signal, requiresIdentity,
        (body) => Boolean(body && typeof body === "object"),
      ).then((body) => {
        if (!isCurrent() || !Array.isArray(body?.lot)) return;
        const mutuals = new Set(body.lot.filter((entry): entry is string => typeof entry === "string"));
        setStoredRead((current) => isCurrent() ? {
          ...(current?.key === readKey ? current : emptyRead(readKey)),
          mutuals,
        } : current);
      });
      await Promise.all([listPromise, lotPromise]);
    })();
    return () => controller.abort();
  }, [accountRevision, phase, readKey, handle, relation, socialFriendsLaunchEnabled]);

  const retry = useCallback(() => {
    if (!socialFriendsLaunchEnabled) return;
    setAttempt((value) => value + 1);
  }, [socialFriendsLaunchEnabled]);

  useReconnectRecovery(status === "error", retry);

  const offline = typeof window !== "undefined" && window.navigator?.onLine === false;

  if (!socialFriendsLaunchEnabled) {
    return <SocialAccessBoundary state="preview" friendsLaunchEnabled={false} />;
  }

  return (
    <section className="peopleDir" aria-labelledby="people-list-title">
      <h1 id="people-list-title" className="peopleDir__title">
        {TITLE[relation]}
      </h1>
      <p className="peopleDir__body">
        <Link className="peopleDir__handle" href={`/u/${encodeURIComponent(handle)}`}>
          {displayHandle(handle)}
        </Link>
      </p>

      {status === "loading" ? (
        <div className="peopleDir__skeletons" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      ) : status === "error" ? (
        <div className="peopleDir__notice" role="alert">
          <p>{offline ? OFFLINE_ERROR : "Could not load this list. That is us, not you."}</p>
          <button
            type="button"
            className="peopleDir__button"
            onClick={retry}
          >
            Try again
          </button>
        </div>
      ) : people.length === 0 ? (
        <p className="peopleDir__body" role="status">
          {EMPTY[relation]}
        </p>
      ) : (
        <ul className="peopleDir__grid">
          {people.map((entry) => {
            const clean = entry.handle;
            // Seen from THIS profile: a row in Followers already follows it, a
            // row in Following is already followed by it, and /lot decides the
            // other edge.
            const rowRelation = resolveFollowRelation({
              viewerFollowing:
                relation === "following" || mutuals.has(clean),
              followsViewer: relation === "followers" || mutuals.has(clean),
            });
            const hint = followRelationHint(rowRelation);
            return (
              <li key={clean} className="peopleDir__card">
                <Link
                  className="peopleDir__identity"
                  href={`/u/${encodeURIComponent(clean)}`}
                >
                  <span className="peopleDir__avatar" aria-hidden="true">
                    {entry.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element -- owned avatar path
                      <img src={entry.avatarUrl} alt="" loading="lazy" decoding="async" />
                    ) : (
                      initial(clean)
                    )}
                  </span>
                  <span className="peopleDir__names">
                    <span className="peopleDir__handle">{displayHandle(clean)}</span>
                    {entry.displayName ? (
                      <span className="peopleDir__display">{entry.displayName}</span>
                    ) : hint ? (
                      <span className="peopleDir__display">{hint}</span>
                    ) : null}
                  </span>
                </Link>
                {mutuals.has(clean) ? (
                  <span className="peopleDir__self">Mates</span>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
