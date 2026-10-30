"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import {
  AuthActionSessionError,
  authedActionFetch,
} from "@/lib/authedFetch";
import type { SocialTagKind } from "@/lib/pintDropWithTags";
import type { SocialPostVisibility } from "@/lib/socialPosts";
import { discardBody } from "@/lib/responseBody";
import { venueMapUrl } from "@/lib/venueMapUrl";

import {
  SocialViewerState,
  type SocialViewerPhase,
} from "@/components/social/SocialViewerState";

// Two kinds of tag land here, and both are proposals the person tagged
// decides. "photo" is a Social post photo tag. "with" is a Pint Drop's "With"
// handle tag (lib/pintDropWithTags.ts): until it is approved the drop says
// "with 1 person", and a decline or a withdrawal takes it off the drop. A
// "with" tag can also sit on a diary entry (0201), which only its owner reads.

type PhotoProposal = {
  kind?: "photo";
  id: string;
  postId: string;
  mediaId: string | null;
  authorHandle: string;
  state: "proposed" | "approved";
  visibility: SocialPostVisibility;
  photoAltText: string | null;
  reviewRevision: number;
  audienceAtApproval: {
    visibility: SocialPostVisibility;
    revision: number;
    shownAt: string;
  } | null;
};
type WithProposal = {
  kind: "with";
  /** Absent from a server older than 0201, which only tagged drops. */
  subject?: "drop" | "diary";
  id: string;
  dropId: string | null;
  taggerHandle: string;
  venueId: string | null;
  venueName: string | null;
  state: "proposed" | "approved";
};
type Proposal = PhotoProposal | WithProposal;
type Lane = "proposed" | "approved";
type LaneKey = `${SocialTagKind}:${Lane}`;
type LaneState = {
  items: Proposal[];
  nextCursor: string | null;
  loading: boolean;
  error: string | null;
  retryCursor: string | null;
};

const EMPTY_LANE: LaneState = {
  items: [],
  nextCursor: null,
  loading: false,
  error: null,
  retryCursor: null,
};
const LANE_LABEL: Record<Lane, string> = {
  proposed: "Tags to review",
  approved: "Approved tags",
};
const KIND_LABEL: Record<SocialTagKind, string> = {
  photo: "Photo tags",
  with: "Pint Drop tags",
};
const AUDIENCE_LABEL: Record<SocialPostVisibility, string> = {
  private: "Private audience",
  friends: "Friends audience",
  public: "Public audience",
};
const LANE_KEYS: readonly LaneKey[] = ["photo:proposed", "photo:approved", "with:proposed", "with:approved"];

function laneLabel(key: LaneKey): string {
  const [kind, lane] = key.split(":") as [SocialTagKind, Lane];
  return kind === "photo" ? LANE_LABEL[lane] : `${KIND_LABEL[kind]}: ${LANE_LABEL[lane].toLowerCase()}`;
}

function mergeProposals(current: Proposal[], incoming: Proposal[]): Proposal[] {
  const byId = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming) byId.set(item.id, item);
  return [...byId.values()];
}

function isWith(item: Proposal): item is WithProposal {
  return item.kind === "with";
}

export default function SocialTagInbox() {
  const { identityResolved, user } = useAuth();
  const viewerPhase: SocialViewerPhase =
    !identityResolved ? "unresolved" : user ? "resolved" : "signed-out";
  const [lanes, setLanes] = useState<Record<LaneKey, LaneState>>({
    "photo:proposed": EMPTY_LANE,
    "photo:approved": EMPTY_LANE,
    "with:proposed": EMPTY_LANE,
    "with:approved": EMPTY_LANE,
  });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadLane = useCallback(
    async (key: LaneKey, cursor: string | null = null) => {
      const [kind, lane] = key.split(":") as [SocialTagKind, Lane];
      setLanes((current) => ({
        ...current,
        [key]: { ...current[key], loading: true, error: null },
      }));
      const params = new URLSearchParams({ lane, limit: "20" });
      if (kind === "with") params.set("kind", "with");
      if (cursor) params.set("cursor", cursor);
      try {
        const response = await authedActionFetch(`/api/social/tags?${params}`, {
          cache: "no-store",
        }, { requiresIdentity: true });
        if (!response.ok) {
          discardBody(response);
          throw new Error("Tag lane read failed");
        }
        const value = (await response.json()) as {
          proposals?: Proposal[];
          nextCursor?: string | null;
        };
        const incoming = (value.proposals ?? []).map((item) =>
          kind === "with" ? { ...item, kind: "with" as const } : item,
        ) as Proposal[];
        setLanes((current) => ({
          ...current,
          [key]: {
            items: cursor ? mergeProposals(current[key].items, incoming) : incoming,
            nextCursor: value.nextCursor ?? null,
            loading: false,
            error: null,
            retryCursor: null,
          },
        }));
      } catch (caught) {
        setLanes((current) => ({
          ...current,
          [key]: {
            ...current[key],
            loading: false,
            error:
              caught instanceof AuthActionSessionError
                ? caught.message
                : `${laneLabel(key)} are unavailable right now.`,
            retryCursor: cursor,
          },
        }));
      }
    },
    [],
  );

  const loadAll = useCallback(
    () => Promise.all(LANE_KEYS.map((key) => loadLane(key))),
    [loadLane],
  );

  useEffect(() => {
    if (viewerPhase !== "resolved") return;
    void Promise.resolve().then(loadAll);
  }, [loadAll, viewerPhase]);

  async function act(
    item: Proposal,
    action: "approve" | "decline" | "withdraw",
  ) {
    setBusyId(item.id);
    setError(null);
    const body = isWith(item)
      ? { kind: "with", proposalId: item.id, action }
      : {
          proposalId: item.id,
          action,
          ...(action === "approve"
            ? { expectedAudienceRevision: item.reviewRevision }
            : {}),
        };
    try {
      const response = await authedActionFetch("/api/social/tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }, { requiresIdentity: true });
      if (!response.ok) {
        discardBody(response);
        if (action === "approve") {
          setError(isWith(item) ? "That tag changed. Review it again." : "Photo tag changed. Review it again.");
          await loadAll();
        } else {
          setError("Couldn't save that tag choice.");
        }
        return;
      }
      await loadAll();
    } catch (caught) {
      setError(
        caught instanceof AuthActionSessionError
          ? caught.message
          : "Couldn't save that tag choice.",
      );
    } finally {
      setBusyId(null);
    }
  }

  const hasLaneContent = LANE_KEYS.some((key) =>
    lanes[key].items.length > 0 || lanes[key].loading || lanes[key].error,
  );
  if (viewerPhase !== "resolved") {
    return (
      <section className="socialTagInbox" aria-labelledby="social-tags-title">
        <h2 id="social-tags-title">Tags</h2>
        <SocialViewerState
          phase={viewerPhase}
          loadingLabel="Loading tags"
          inviteMessage="Review who tagged you."
        />
      </section>
    );
  }
  if (!hasLaneContent && !error) return null;
  return (
    <section className="socialTagInbox" aria-labelledby="social-tags-title">
      <h2 id="social-tags-title">Tags</h2>
      {error ? <p role="alert">{error}</p> : null}
      {LANE_KEYS.map((key) => {
        const state = lanes[key];
        const lane = key.split(":")[1] as Lane;
        if (state.items.length === 0 && !state.loading && !state.error) return null;
        const label = laneLabel(key);
        return (
          <section
            key={key}
            className="socialTagLane"
            aria-label={label}
            aria-busy={state.loading}
          >
            {state.loading ? <p role="status">Loading {label.toLowerCase()}…</p> : null}
            {state.error ? <p role="alert">{state.error}</p> : null}
            {state.items.map((item) => (
              <article key={item.id} className="socialTagItem">
                {isWith(item) ? (
                  <>
                    <strong>@{item.taggerHandle}</strong>
                    <p>
                      {item.venueName && item.venueId ? (
                        <>
                          Says you were with them at{" "}
                          <Link href={venueMapUrl(item.venueId)} prefetch={false}>
                            {item.venueName}
                          </Link>
                          .
                        </>
                      ) : item.subject === "diary" ? (
                        "Says you were with them, in their diary."
                      ) : (
                        "Says you were with them on a Pint Drop."
                      )}
                    </p>
                    <p>
                      {item.subject === "diary"
                        ? lane === "proposed"
                          ? "Until you approve, their diary says “with 1 person”. Only they can read it."
                          : "Your handle shows in their diary. Only they can read it."
                        : lane === "proposed"
                          ? "Until you approve, the drop says “with 1 person”."
                          : "Your handle shows on their drop."}
                    </p>
                  </>
                ) : (
                  <>
                    <strong>@{item.authorHandle}</strong>
                    {item.mediaId && item.photoAltText ? (
                      <figure>
                        {/* eslint-disable-next-line @next/next/no-img-element -- private consent-review delivery route. */}
                        <img
                          src={`/api/social/media/${item.mediaId}`}
                          alt={item.photoAltText}
                        />
                      </figure>
                    ) : null}
                    <p>
                      {AUDIENCE_LABEL[
                        item.state === "approved"
                          ? item.audienceAtApproval?.visibility ?? item.visibility
                          : item.visibility
                      ]}
                    </p>
                  </>
                )}
                <div>
                  {lane === "proposed" ? (
                    <>
                      <button
                        type="button"
                        disabled={busyId === item.id}
                        onClick={() => void act(item, "approve")}
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        disabled={busyId === item.id}
                        onClick={() => void act(item, "decline")}
                      >
                        Decline
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      disabled={busyId === item.id}
                      onClick={() => void act(item, "withdraw")}
                    >
                      Withdraw
                    </button>
                  )}
                </div>
              </article>
            ))}
            {state.error ? (
              <button
                className="socialTagRetry"
                type="button"
                onClick={() => void loadLane(key, state.retryCursor)}
              >
                Retry {label.toLowerCase()}
              </button>
            ) : null}
            {state.nextCursor ? (
              <button
                className="socialTagMore"
                type="button"
                onClick={() => void loadLane(key, state.nextCursor)}
              >
                Load more
              </button>
            ) : null}
          </section>
        );
      })}
    </section>
  );
}
