"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { normalizeHandle } from "@/lib/profiles";
import type { ListType, SavedPubDTO } from "@/lib/savedPubs";

type SavedListCounts = {
  followers: number;
  savedPubs: number;
};

type SavedListDetailProps = {
  ownerHandle: string;
  listType: ListType;
  pubs: SavedPubDTO[];
  initialCounts: SavedListCounts;
  initialFollowing?: boolean;
  viewerHandle?: string;
};

function formatCount(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function readCounts(value: unknown): SavedListCounts | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as { followers?: unknown; savedPubs?: unknown };
  const followers =
    typeof raw.followers === "number" && Number.isFinite(raw.followers) && raw.followers > 0
      ? raw.followers
      : 0;
  const savedPubs =
    typeof raw.savedPubs === "number" && Number.isFinite(raw.savedPubs) && raw.savedPubs > 0
      ? raw.savedPubs
      : 0;
  return { followers, savedPubs };
}

function ownerProfileUrl(ownerHandle: string): string {
  return `/u/${encodeURIComponent(ownerHandle)}`;
}

export default function SavedListDetail({
  ownerHandle,
  listType,
  pubs,
  initialCounts,
  initialFollowing = false,
  viewerHandle = "",
}: SavedListDetailProps) {
  const owner = normalizeHandle(ownerHandle);
  const [viewer, setViewer] = useState(normalizeHandle(viewerHandle));
  const [following, setFollowing] = useState(initialFollowing);
  const [counts, setCounts] = useState(initialCounts);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canFollow = viewer !== "" && viewer !== owner;

  useEffect(() => {
    if (viewerHandle) return;
    let active = true;

    async function loadViewerHandle() {
      try {
        const handle = normalizeHandle(window.localStorage.getItem("pubmax_handle") ?? "");
        if (active) setViewer(handle);
      } catch {
        if (active) setViewer("");
      }
    }

    void loadViewerHandle();
    return () => {
      active = false;
    };
  }, [viewerHandle]);

  useEffect(() => {
    if (!canFollow) return;
    const controller = new AbortController();

    async function loadState() {
      try {
        const res = await fetch(
          `/api/saved-pubs/list-follows?follower=${encodeURIComponent(viewer)}&owner=${encodeURIComponent(
            owner,
          )}&listType=${encodeURIComponent(listType)}`,
          { signal: controller.signal },
        );
        if (!res.ok) return;
        const body = (await res.json()) as { following?: unknown; counts?: unknown };
        if (!controller.signal.aborted) {
          if (typeof body.following === "boolean") setFollowing(body.following);
          const nextCounts = readCounts(body.counts);
          if (nextCounts) setCounts(nextCounts);
        }
      } catch {
        // Follow state is additive UI; the static page remains useful if it fails.
      }
    }

    void loadState();
    return () => controller.abort();
  }, [canFollow, listType, owner, viewer]);

  async function toggleFollow() {
    if (busy || !canFollow) return;
    setBusy(true);
    setError(null);

    const next = !following;
    const previousCounts = counts;
    setFollowing(next);
    setCounts({
      ...counts,
      followers: Math.max(0, counts.followers + (next ? 1 : -1)),
    });

    try {
      const res = await fetch("/api/saved-pubs/list-follows", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          follower: viewer,
          owner,
          listType,
          action: next ? "follow" : "unfollow",
        }),
      });
      const body: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        setFollowing(!next);
        setCounts(previousCounts);
        const message =
          body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string"
            ? (body as { error: string }).error
            : "Couldn't update this list. Try again.";
        setError(message);
        return;
      }

      if (body && typeof body === "object") {
        const b = body as { following?: unknown; counts?: unknown };
        if (typeof b.following === "boolean") setFollowing(b.following);
        const nextCounts = readCounts(b.counts);
        if (nextCounts) setCounts(nextCounts);
      }
    } catch {
      setFollowing(!next);
      setCounts(previousCounts);
      setError("Network error. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section className="listDetailHero" aria-labelledby="listDetailHeading">
        <div className="listDetailTitleBlock">
          <p className="listDetailEyebrow">Saved list</p>
          <h1 id="listDetailHeading" className="listDetailTitle">
            {listType}
          </h1>
          <Link className="listDetailAuthor" href={ownerProfileUrl(owner)}>
            By @{owner}
          </Link>
        </div>
        <div className="listDetailMeta" aria-label="List counts">
          <span>{formatCount(counts.savedPubs, "pub", "pubs")}</span>
          <span>{formatCount(counts.followers, "follower", "followers")}</span>
        </div>
        {canFollow ? (
          <div className="listFollowControl">
            <button
              type="button"
              className={`followBtn${following ? " isFollowing" : ""}`}
              aria-pressed={following}
              disabled={busy}
              onClick={toggleFollow}
            >
              {following ? "Following list" : "Follow list"}
            </button>
            {error ? (
              <span className="followError" role="status">
                {error}
              </span>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="savedSection" aria-labelledby="listPubsHeading">
        <h2 id="listPubsHeading" className="savedHeading">
          Pubs in this list
        </h2>
        {pubs.length === 0 ? (
          <p className="profileEmpty">@{owner} has not saved any pubs to this list yet.</p>
        ) : (
          <ul className="savedListItems listDetailItems">
            {pubs.map((pub) => (
              <li className="savedItem listDetailItem" key={`${pub.venueId}:${pub.listType}`}>
                <Link className="savedItemVenue" href={pub.venueMapUrl}>
                  {pub.venueName}
                </Link>
                {pub.note ? <span className="savedItemNote">{pub.note}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
