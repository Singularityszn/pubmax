"use client";

// Followers and Following for one handle, and who among them is a mate.
//
// Both directions read the same shape (a list of handles) from their own public
// route, and the mutual overlay is the intersection with this handle's /lot.
// That matters because the two lists look identical otherwise: a follower who
// is also followed back is a MATE, and a list that cannot say so is a list of
// strangers. The relation word comes from lib/followRelation.ts so this file
// holds no policy.
//
// Public projection only. A handle plus, when the profile read offers it, a
// display name and an owned avatar. Nothing else about a person travels here.

import Link from "next/link";
import { useEffect, useState } from "react";

import { followRelationHint, resolveFollowRelation } from "@/lib/followRelation";
import { displayHandle } from "@/lib/handleDisplay";
import { normalizeHandle } from "@/lib/profiles";

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

function initial(handle: string): string {
  const clean = normalizeHandle(handle);
  return clean ? clean.slice(0, 1).toUpperCase() : "?";
}

export default function PeopleListClient({
  handle,
  relation,
}: {
  handle: string;
  relation: PeopleRelation;
}) {
  const [status, setStatus] = useState<LoadState>("loading");
  const [handles, setHandles] = useState<string[]>([]);
  const [mutuals, setMutuals] = useState<Set<string>>(new Set());
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(() => setStatus("loading"));
    void (async () => {
      try {
        const [listResponse, lotResponse] = await Promise.all([
          fetch(`/api/profiles/${encodeURIComponent(handle)}/${relation}`, {
            cache: "no-store",
            signal: controller.signal,
          }),
          fetch(`/api/profiles/${encodeURIComponent(handle)}/lot`, {
            cache: "no-store",
            signal: controller.signal,
          }),
        ]);
        if (!listResponse.ok) throw new Error("List unavailable");
        const body = (await listResponse.json()) as Record<string, unknown>;
        const rows = body[relation];
        if (!Array.isArray(rows)) throw new Error("List malformed");
        setHandles(
          rows.filter((row): row is string => typeof row === "string" && row.length > 0),
        );
        if (lotResponse.ok) {
          const lotBody = (await lotResponse.json()) as { lot?: unknown };
          setMutuals(
            new Set(Array.isArray(lotBody.lot) ? (lotBody.lot as string[]) : []),
          );
        }
        setStatus("ready");
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setHandles([]);
        setStatus("error");
      }
    })();
    return () => controller.abort();
  }, [attempt, handle, relation]);

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
          <p>Could not load this list. That is us, not you.</p>
          <button
            type="button"
            className="peopleDir__button"
            onClick={() => setAttempt((value) => value + 1)}
          >
            Try again
          </button>
        </div>
      ) : handles.length === 0 ? (
        <p className="peopleDir__body" role="status">
          {EMPTY[relation]}
        </p>
      ) : (
        <ul className="peopleDir__grid">
          {handles.map((entry) => {
            const clean = normalizeHandle(entry);
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
                    {initial(clean)}
                  </span>
                  <span className="peopleDir__names">
                    <span className="peopleDir__handle">{displayHandle(clean)}</span>
                    {hint ? <span className="peopleDir__display">{hint}</span> : null}
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
