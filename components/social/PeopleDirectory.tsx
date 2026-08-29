"use client";

// See who has joined. The browse half of finding your lot.
//
// FindYourLot answers "is @sam here" and needs you to know the handle already.
// This answers "who is here" for somebody who knows nobody, which is the only
// state a new account starts in. It reads /api/profiles/directory: the same
// claimed-and-live row set as the handle search, the same four public fields,
// and nothing more. No email, no date of birth, no user id ever reaches it.
//
// Follow is the same one-sided edge as everywhere else. A lot is mutual, so the
// row says what the edge is worth (lib/followRelation.ts) rather than implying
// a friendship one tap cannot make.
//
// And this is DISCOVERY, so an account the viewer already follows is not on it:
// the read is asked for the viewer by name and answers without them, and a tap
// that lands takes its own card off the list. A spent "Mates" button under a
// heading offering people to follow is a receipt, not a suggestion. The rule and
// both empty lines live in lib/peopleDirectory.ts, once. The starter packs are a
// separate lane and keep their followed members on purpose: a pack is a named
// bundle, so seeing where you already stand in one is the point.

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { authedActionFetch } from "@/lib/authedFetch";
import { errorMessageFrom } from "@/lib/apiErrorMessage";
import { followListHandleSet } from "@/lib/followList";
import {
  followActionDescription,
  followActionLabel,
  followPendingLabel,
  resolveFollowRelation,
  type FollowRelation,
} from "@/lib/followRelation";
import { directoryEmptyLine } from "@/lib/peopleDirectory";
import { discardBody } from "@/lib/responseBody";
import { displayHandle } from "@/lib/handleDisplay";
import { normalizeHandle } from "@/lib/profiles";
import { useSocialFriendsLaunch } from "@/lib/useSocialFriendsLaunch";

import "./peopleDirectory.css";

type Person = {
  id: string;
  handle: string;
  displayName?: string;
  avatarUrl?: string;
};

type LoadState = "loading" | "ready" | "error";

function initial(handle: string): string {
  const clean = normalizeHandle(handle);
  return clean ? clean.slice(0, 1).toUpperCase() : "?";
}

export default function PeopleDirectory({
  myHandle,
  limit = 12,
}: {
  myHandle?: string | null;
  limit?: number;
}) {
  const socialFriendsLaunchEnabled = useSocialFriendsLaunch();
  const [status, setStatus] = useState<LoadState>("loading");
  const [people, setPeople] = useState<Person[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [lot, setLot] = useState<Set<string>>(new Set());
  const [followed, setFollowed] = useState<Set<string>>(new Set());
  const [working, setWorking] = useState<string | null>(null);
  const [problem, setProblem] = useState("");
  const [storedHandle, setStoredHandle] = useState("");
  const [handleRead, setHandleRead] = useState(false);
  const [alreadyFollowing, setAlreadyFollowing] = useState(0);

  useEffect(() => {
    if (!socialFriendsLaunchEnabled) return;
    void Promise.resolve().then(() => {
      try {
        setStoredHandle(
          normalizeHandle(window.localStorage.getItem("pubmax_handle") ?? ""),
        );
      } catch {
        setStoredHandle("");
      } finally {
        setHandleRead(true);
      }
    });
  }, []);
  const viewer = normalizeHandle(myHandle ?? "") || storedHandle;

  useEffect(() => {
    // Ask once the viewer is known. A read fired before then comes back with
    // the people this reader already follows in it, and swapping that list out
    // a moment later is worse than the skeleton it replaced.
    if (!handleRead) return;
    const controller = new AbortController();
    void Promise.resolve().then(() => setStatus("loading"));
    const viewerParam = viewer ? `&viewer=${encodeURIComponent(viewer)}` : "";
    fetch(`/api/profiles/directory?limit=${limit}${viewerParam}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          discardBody(response);
          throw new Error("Directory unavailable");
        }
        const body = (await response.json()) as {
          people?: Person[];
          nextCursor?: string | null;
          alreadyFollowing?: number;
        };
        if (!Array.isArray(body.people)) throw new Error("Directory malformed");
        return body;
      })
      .then((body) => {
        setPeople(body.people ?? []);
        setCursor(body.nextCursor ?? null);
        setAlreadyFollowing(
          typeof body.alreadyFollowing === "number" ? body.alreadyFollowing : 0,
        );
        setStatus("ready");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setPeople([]);
        setStatus("error");
      });
    return () => controller.abort();
  }, [attempt, handleRead, limit, socialFriendsLaunchEnabled, viewer]);

  // Who already follows you back, so a row can say "Mates" instead of guessing.
  useEffect(() => {
    if (!socialFriendsLaunchEnabled || !viewer) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const [lotResponse, followingResponse] = await Promise.all([
          fetch(`/api/profiles/${encodeURIComponent(viewer)}/lot`, {
            cache: "no-store",
            signal: controller.signal,
          }),
          fetch(`/api/profiles/${encodeURIComponent(viewer)}/following`, {
            cache: "no-store",
            signal: controller.signal,
          }),
        ]);
        if (lotResponse.ok) {
          const body = (await lotResponse.json()) as { lot?: unknown };
          setLot(new Set(Array.isArray(body.lot) ? (body.lot as string[]) : []));
        }
        if (followingResponse.ok) {
          const body = (await followingResponse.json()) as { following?: unknown };
          setFollowed(followListHandleSet(body.following));
        }
      } catch {
        // The directory still lists people without the relation overlay.
      }
    })();
    return () => controller.abort();
  }, [socialFriendsLaunchEnabled, viewer]);

  const loadMore = useCallback(async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const viewerParam = viewer ? `&viewer=${encodeURIComponent(viewer)}` : "";
      const response = await fetch(
        `/api/profiles/directory?limit=${limit}&after=${encodeURIComponent(cursor)}${viewerParam}`,
        { cache: "no-store" },
      );
      if (!response.ok) {
        discardBody(response);
        throw new Error("Directory unavailable");
      }
      const body = (await response.json()) as {
        people?: Person[];
        nextCursor?: string | null;
        alreadyFollowing?: number;
      };
      setPeople((current) => {
        const byId = new Map(current.map((person) => [person.id, person]));
        for (const person of body.people ?? []) byId.set(person.id, person);
        return [...byId.values()];
      });
      setCursor(body.nextCursor ?? null);
      if (typeof body.alreadyFollowing === "number") {
        const dropped = body.alreadyFollowing;
        setAlreadyFollowing((current) => current + dropped);
      }
    } catch {
      setProblem("Could not load more people.");
    } finally {
      setLoadingMore(false);
    }
  }, [cursor, limit, loadingMore, viewer]);

  const relationFor = (handle: string): FollowRelation => {
    const clean = normalizeHandle(handle);
    return resolveFollowRelation({
      viewerFollowing: followed.has(clean),
      followsViewer: lot.has(clean) || false,
    });
  };

  if (!socialFriendsLaunchEnabled) return null;

  async function follow(handle: string) {
    const clean = normalizeHandle(handle);
    if (!viewer) {
      setProblem("Sign in and claim a handle first.");
      return;
    }
    if (clean === viewer || working) return;
    setWorking(clean);
    setProblem("");
    try {
      const response = await authedActionFetch(
        `/api/profiles/${encodeURIComponent(clean)}/follow`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ follower: viewer }),
        },
      );
      const body = (await response.json().catch(() => ({}))) as {
        following?: boolean;
        error?: string;
      };
      if (!response.ok) throw new Error(errorMessageFrom(body, "Could not follow them."));
      const nowFollowing = body.following !== false;
      setFollowed((current) => {
        const next = new Set(current);
        if (nowFollowing) next.add(clean);
        else next.delete(clean);
        return next;
      });
      // Discovery is what is left to do. A tap that landed is done, so the card
      // goes with it rather than sitting there wearing its own answer.
      if (nowFollowing) {
        setPeople((current) =>
          current.filter((person) => normalizeHandle(person.handle) !== clean),
        );
        setAlreadyFollowing((current) => current + 1);
      }
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "Could not follow them.");
    } finally {
      setWorking(null);
    }
  }

  // Nobody left to offer, and the reason is that this reader has followed them
  // all. The invitation below the heading is spent too, so it goes with them.
  const allFollowed =
    status === "ready" && people.length === 0 && alreadyFollowing > 0;

  return (
    <section className="peopleDir" aria-labelledby="people-dir-title">
      <h2 id="people-dir-title" className="peopleDir__title">
        People on PUBMAXX
      </h2>
      {allFollowed ? null : (
        <p className="peopleDir__body">
          Everyone here chose a public handle. Follow a few; a lot forms when
          they follow you back.
        </p>
      )}

      {status === "loading" ? (
        <div className="peopleDir__skeletons" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      ) : status === "error" ? (
        <div className="peopleDir__notice" role="alert">
          <p>Could not load the directory. That is us, not you.</p>
          <button
            type="button"
            className="peopleDir__button"
            onClick={() => setAttempt((value) => value + 1)}
          >
            Try again
          </button>
        </div>
      ) : people.length === 0 ? (
        <p className="peopleDir__body" role="status">
          {directoryEmptyLine({
            alreadyFollowing,
            moreToLoad: cursor !== null,
          })}
        </p>
      ) : (
        <ul className="peopleDir__grid">
          {people.map((person) => {
            const clean = normalizeHandle(person.handle);
            const isSelf = Boolean(viewer) && clean === viewer;
            const relation = relationFor(person.handle);
            return (
              <li key={person.id} className="peopleDir__card">
                <Link
                  className="peopleDir__identity"
                  href={`/u/${encodeURIComponent(person.handle)}`}
                >
                  <span className="peopleDir__avatar" aria-hidden="true">
                    {person.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element -- owned avatar path
                      <img src={person.avatarUrl} alt="" loading="lazy" decoding="async" />
                    ) : (
                      initial(person.handle)
                    )}
                  </span>
                  <span className="peopleDir__names">
                    <span className="peopleDir__handle">
                      {displayHandle(person.handle)}
                    </span>
                    {person.displayName ? (
                      <span className="peopleDir__display">{person.displayName}</span>
                    ) : null}
                  </span>
                </Link>
                {isSelf ? (
                  <span className="peopleDir__self">You</span>
                ) : (
                  <button
                    type="button"
                    className="peopleDir__button"
                    aria-label={followActionDescription(relation, clean)}
                    disabled={!viewer || working === clean}
                    onClick={() => void follow(person.handle)}
                  >
                    {working === clean
                      ? followPendingLabel(relation)
                      : followActionLabel(relation)}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {problem ? (
        <p className="peopleDir__problem" role="alert">
          {problem}
        </p>
      ) : null}

      {status === "ready" && cursor ? (
        <button
          type="button"
          className="peopleDir__button peopleDir__more"
          disabled={loadingMore}
          onClick={() => void loadMore()}
        >
          {loadingMore ? "Loading…" : "Show more people"}
        </button>
      ) : null}
    </section>
  );
}
