"use client";

// Start with your lot: bundles of real accounts a new drinker can follow in
// one tap, so the feed and the directory have people in them on night one.
//
// The surface is OFFERED, never insisted on. It shows only while the viewer
// follows fewer than `STARTER_PACK_FOLLOW_FLOOR` accounts, and that decision is
// TRI-STATE: `viewerFollowing` comes back null when nobody asked or the read
// could not answer, and `viewerNeedsStarterPacks` renders nothing for null
// rather than pushing packs at somebody who already has a lot.
//
// It stays on screen after a follow-all, because it is the thing reporting what
// the tap did. Hiding it the moment the count crossed the floor would eat the
// answer.
//
// Every pack card prints the pack's own title, up to five faces, the member
// count and one button. The pack's one-line description is not a subtitle: it
// is the accessible description of a button that follows a dozen people at
// once, so somebody using a screen reader knows what they are agreeing to.

import Link from "next/link";
import { useEffect, useState } from "react";

import { useViewerHandle } from "@/components/auth/useViewerHandle";
import { authedActionFetch } from "@/lib/authedFetch";
import { errorMessageFrom } from "@/lib/apiErrorMessage";
import { displayHandle } from "@/lib/handleDisplay";
import { normalizeHandle } from "@/lib/profiles";
import { discardBody } from "@/lib/responseBody";
import {
  STARTER_PACK_FOLLOW_LABEL,
  STARTER_PACK_FOLLOW_WORKING_LABEL,
  STARTER_PACK_PREVIEW_FACES,
  STARTER_PACKS_TITLE,
  starterPackFollowAccessibleLabel,
  starterPackMemberCountLabel,
  starterPacksSurfaceVisible,
  type StarterPack,
  type StarterPackFollowOutcome,
  type StarterPackMember,
} from "@/lib/starterPacks";

import "./starterPacks.css";

type PackView = StarterPack & {
  members: StarterPackMember[];
  memberCount: number;
};

type PackState = {
  status: "idle" | "working" | "done" | "error";
  results?: { handle: string; outcome: StarterPackFollowOutcome }[];
  summary?: string;
  problem?: string;
};

function avatarInitial(handle: string): string {
  const clean = normalizeHandle(handle);
  return clean ? clean.slice(0, 1).toUpperCase() : "?";
}

/** The state a member is IN after the tap, which is what a reader wants to know. */
function outcomeLabel(outcome: StarterPackFollowOutcome): string {
  if (outcome === "self") return "You";
  if (outcome === "failed") return "Didn't go through";
  return "Following";
}

export default function StarterPacks({ compact = false }: { compact?: boolean }) {
  const viewer = useViewerHandle();
  const [packs, setPacks] = useState<PackView[]>([]);
  const [viewerFollowing, setViewerFollowing] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [packState, setPackState] = useState<Record<string, PackState>>({});

  useEffect(() => {
    if (!viewer) return;
    let live = true;
    void (async () => {
      try {
        const response = await authedActionFetch(
          `/api/starter-packs?viewer=${encodeURIComponent(viewer)}`,
          { cache: "no-store" },
        );
        if (!response.ok) {
          discardBody(response);
          if (live) setLoaded(true);
          return;
        }
        const body = (await response.json()) as {
          packs?: PackView[];
          viewerFollowing?: number | null;
        };
        if (!live) return;
        setPacks(Array.isArray(body.packs) ? body.packs : []);
        setViewerFollowing(
          typeof body.viewerFollowing === "number" ? body.viewerFollowing : null,
        );
        setLoaded(true);
      } catch {
        if (live) setLoaded(true);
      }
    })();
    return () => {
      live = false;
    };
  }, [viewer]);

  async function followAll(pack: PackView) {
    if (!viewer) return;
    setPackState((current) => ({ ...current, [pack.slug]: { status: "working" } }));
    try {
        const response = await authedActionFetch(
        `/api/starter-packs/${encodeURIComponent(pack.slug)}/follow`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ follower: viewer }),
        },
      );
      const body = (await response.json().catch(() => null)) as
        | {
            results?: { handle: string; outcome: StarterPackFollowOutcome }[];
            summary?: string;
            error?: string;
          }
        | null;
      if (!response.ok || !Array.isArray(body?.results)) {
        throw new Error(errorMessageFrom(body, "That didn't go through. Try again."));
      }
      setPackState((current) => ({
        ...current,
        [pack.slug]: {
          status: "done",
          results: body.results,
          ...(body.summary ? { summary: body.summary } : {}),
        },
      }));
    } catch (error) {
      setPackState((current) => ({
        ...current,
        [pack.slug]: {
          status: "error",
          problem:
            error instanceof Error
              ? error.message
              : "That didn't go through. Try again.",
        },
      }));
    }
  }

  // The whole render decision is `starterPacksSurfaceVisible` in the policy
  // module. It is not restated here: a second copy of the rule is how a surface
  // starts offering packs to somebody who already has a lot.
  const visible = starterPacksSurfaceVisible({
    viewer,
    loaded,
    packCount: packs.length,
    viewerFollowing,
    followedAny: Object.values(packState).some((state) => state.status === "done"),
  });
  if (!visible) return null;

  return (
    <section
      className={compact ? "starterPacks starterPacks--compact" : "starterPacks"}
      aria-labelledby="starter-packs-title"
    >
      <h2 id="starter-packs-title" className="starterPacks__title">
        {STARTER_PACKS_TITLE}
      </h2>

      <ul className="starterPacks__grid">
        {packs.map((pack) => {
          const state = packState[pack.slug] ?? { status: "idle" };
          const descriptionId = `starter-pack-desc-${pack.slug}`;
          const faces = pack.members.slice(0, STARTER_PACK_PREVIEW_FACES);
          return (
            <li key={pack.slug} className="starterPacks__card">
              <h3 className="starterPacks__packTitle">{pack.title}</h3>
              <p id={descriptionId} className="srOnly">
                {pack.description}
              </p>

              <ul className="starterPacks__faces" aria-hidden="true">
                {faces.map((member) => (
                  <li key={member.handle} className="starterPacks__face">
                    {member.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element -- owned avatar path
                      <img src={member.avatarUrl} alt="" loading="lazy" decoding="async" />
                    ) : (
                      avatarInitial(member.handle)
                    )}
                  </li>
                ))}
              </ul>

              <p className="starterPacks__count">
                {starterPackMemberCountLabel(pack.memberCount)}
              </p>

              <button
                type="button"
                className="starterPacks__follow"
                aria-label={starterPackFollowAccessibleLabel(pack)}
                aria-describedby={descriptionId}
                disabled={state.status === "working" || state.status === "done"}
                onClick={() => void followAll(pack)}
              >
                {state.status === "working"
                  ? STARTER_PACK_FOLLOW_WORKING_LABEL
                  : state.status === "done"
                    ? "Followed"
                    : STARTER_PACK_FOLLOW_LABEL}
              </button>

              {state.status === "done" && state.summary ? (
                <p className="starterPacks__summary" role="status">
                  {state.summary}
                </p>
              ) : null}

              {state.status === "done" && state.results ? (
                <ul className="starterPacks__results">
                  {state.results.map((result) => (
                    <li key={result.handle} className="starterPacks__result">
                      <Link href={`/u/${encodeURIComponent(result.handle)}`}>
                        {displayHandle(result.handle)}
                      </Link>
                      <span
                        className={
                          result.outcome === "failed"
                            ? "starterPacks__outcome starterPacks__outcome--problem"
                            : "starterPacks__outcome"
                        }
                      >
                        {outcomeLabel(result.outcome)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}

              {state.status === "error" ? (
                <p className="starterPacks__problem" role="alert">
                  {state.problem}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
