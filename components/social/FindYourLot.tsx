"use client";

// WP7 find-your-lot: prefix search for claimed handles + follow / open profile.
// Friendship stays mutual - follow here is one side; they follow back to share
// a lot. Invite link entry pulls a mate in with one share.

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { authedActionFetch } from "@/lib/authedFetch";
import { useAuth } from "@/components/auth/AuthProvider";
import { useViewerSession } from "@/components/auth/useViewerSession";
import {
  errorMessageFrom,
  findYourLotInviteFailureMessage,
  INVITE_LINK_FALLBACK_MESSAGE,
  offlineOrMessage,
} from "@/lib/apiErrorMessage";
import {
  followActionLabel,
  followPendingLabel,
  followRelationHint,
  isFollowRelation,
  type FollowRelation,
} from "@/lib/followRelation";
import { discardBody } from "@/lib/responseBody";
import { displayHandle } from "@/lib/handleDisplay";
import { normalizeHandle } from "@/lib/profiles";
import { useSocialFriendsLaunch } from "@/lib/useSocialFriendsLaunch";
import { useViewerHandle } from "@/components/auth/useViewerHandle";
import Kicker from "@/components/ui/kicker";

import "./findYourLot.css";

type SearchMatch = {
  id: string;
  handle: string;
  displayName?: string;
  avatarUrl?: string;
  /** What the signed-in viewer already is to this person. */
  relation?: FollowRelation;
};

type FollowState = "idle" | "working" | "done" | "error";

function avatarInitial(handle: string): string {
  const clean = normalizeHandle(handle);
  return clean ? clean.slice(0, 1).toUpperCase() : "?";
}

export default function FindYourLot({
  compact = false,
}: {
  myHandle?: string | null;
  compact?: boolean;
}) {
  const socialFriendsLaunchEnabled = useSocialFriendsLaunch();
  const { accountRevision } = useAuth();
  // A sign-in door is a claim about the viewer, so it waits for the live
  // session. While that is unresolved this lane offers the claim-a-handle
  // route to nobody and the sign-in route to nobody.
  const viewerSession = useViewerSession();
  const identityViewerHandle = useViewerHandle();
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<SearchMatch[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [followByHandle, setFollowByHandle] = useState<Record<string, FollowState>>({});
  const [notice, setNotice] = useState("");
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [viewerStateKey, setViewerStateKey] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const accountRevisionRef = useRef(accountRevision);
  const viewerRef = useRef("");
  const viewer = viewerSession.signedIn
    ? normalizeHandle(identityViewerHandle ?? "")
    : "";
  const viewerKey = `${accountRevision}:${viewer}`;

  useEffect(() => {
    accountRevisionRef.current = accountRevision;
    viewerRef.current = viewer;
  }, [accountRevision, viewer]);

  useEffect(() => {
    void Promise.resolve().then(() => {
      setViewerStateKey(viewerKey);
      setInviteUrl(null);
      setFollowByHandle({});
      setInviteBusy(false);
      setCopied(false);
      setNotice("");
    });
  }, [accountRevision, viewerKey]);

  useEffect(() => {
    if (!socialFriendsLaunchEnabled) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = normalizeHandle(query);
    // Defer setState out of the effect body (react-hooks/set-state-in-effect).
    if (q.length < 2) {
      void Promise.resolve().then(() => {
        setMatches([]);
        setStatus("idle");
      });
      return () => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
      };
    }
    void Promise.resolve().then(() => setStatus("loading"));
    // One controller per effect run: a new query, a switch of account or the
    // session resolving cancels the request in flight, so a late answer for the
    // previous viewer can never overwrite the current viewer's relations.
    const controller = new AbortController();
    debounceRef.current = setTimeout(() => {
      void (async () => {
        try {
          // Naming the viewer lets the answer say who they already follow, so a
          // mate is never offered a Follow they have already pressed.
          const viewerQuery = viewer ? `&viewer=${encodeURIComponent(viewer)}` : "";
          const response = await fetch(
            `/api/profiles/search?q=${encodeURIComponent(q)}${viewerQuery}`,
            { cache: "no-store", signal: controller.signal },
          );
          if (controller.signal.aborted) {
            discardBody(response);
            return;
          }
          if (!response.ok) {
            discardBody(response);
            setStatus("error");
            setMatches([]);
            return;
          }
          const body = (await response.json()) as { matches?: SearchMatch[] };
          if (controller.signal.aborted) return;
          setMatches(
            Array.isArray(body.matches)
              ? body.matches.map((match) => ({
                  ...match,
                  relation: isFollowRelation(match.relation) ? match.relation : undefined,
                }))
              : [],
          );
          setStatus("ready");
        } catch {
          if (controller.signal.aborted) return;
          setStatus("error");
          setMatches([]);
        }
      })();
    }, 220);
    return () => {
      controller.abort();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, socialFriendsLaunchEnabled, viewer]);

  async function follow(handle: string) {
    if (!socialFriendsLaunchEnabled || !viewer) {
      setNotice("Sign in and claim a handle first.");
      return;
    }
    if (normalizeHandle(handle) === viewer) return;
    const requestRevision = accountRevision;
    const requestViewer = viewer;
    setFollowByHandle((current) => ({ ...current, [handle]: "working" }));
    setNotice("");
    try {
      const response = await authedActionFetch(
        `/api/profiles/${encodeURIComponent(handle)}/follow`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ follower: viewer }),
        }, { requiresIdentity: true },
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as unknown;
        throw new Error(errorMessageFrom(body, "Could not follow them."));
      }
      if (accountRevisionRef.current !== requestRevision || viewerRef.current !== requestViewer) return;
      setFollowByHandle((current) => ({ ...current, [handle]: "done" }));
    } catch (error) {
      if (accountRevisionRef.current !== requestRevision || viewerRef.current !== requestViewer) return;
      setFollowByHandle((current) => ({ ...current, [handle]: "error" }));
      setNotice(error instanceof Error ? error.message : "Could not follow them.");
    }
  }

  async function mintInviteLink() {
    if (inviteBusy || !socialFriendsLaunchEnabled) return;
    setInviteBusy(true);
    setNotice("");
    const requestRevision = accountRevision;
    const requestViewer = viewer;
    try {
      const response = await authedActionFetch("/api/referrals/invite-link", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }, { requiresIdentity: true });
      const body = (await response.json().catch(() => null)) as
        | { url?: string; error?: unknown }
        | null;
      if (!response.ok || typeof body?.url !== "string") {
        throw new Error(
          findYourLotInviteFailureMessage(
            body,
            typeof navigator === "undefined" || navigator.onLine,
          ),
        );
      }
      if (accountRevisionRef.current !== requestRevision || viewerRef.current !== requestViewer) return;
      setInviteUrl(body.url);
    } catch (error) {
      if (accountRevisionRef.current !== requestRevision || viewerRef.current !== requestViewer) return;
      setNotice(
        offlineOrMessage(
          error instanceof Error
            ? error.message
            : INVITE_LINK_FALLBACK_MESSAGE,
        ),
      );
    } finally {
      if (accountRevisionRef.current === requestRevision && viewerRef.current === requestViewer) {
        setInviteBusy(false);
      }
    }
  }

  async function copyInvite() {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2400);
    } catch {
      setNotice("Could not copy the link.");
    }
  }

  if (!socialFriendsLaunchEnabled) return null;

  const viewerStateReady = viewerStateKey === viewerKey;
  const visibleInviteUrl = viewerStateReady ? inviteUrl : null;
  const visibleFollowByHandle = viewerStateReady ? followByHandle : {};

  const shareSelf =
    viewer && typeof window !== "undefined"
      ? `${window.location.origin}/add/${viewer}`
      : viewer
        ? `/add/${viewer}`
        : null;

  return (
    <section
      className={compact ? "findLot findLot--compact" : "findLot"}
      aria-labelledby="find-lot-title"
    >
      <Kicker tone="muted">Your lot</Kicker>
      <h2 id="find-lot-title" className="findLot__title">
        Find your lot
      </h2>
      <p className="findLot__body">
        Search a mate&rsquo;s handle, or send an invite link. A lot is mutual.
        They follow you back, and you share nights.
      </p>

      <label className="findLot__field">
        <span className="srOnly">Search handles</span>
        <input
          type="search"
          autoComplete="off"
          spellCheck={false}
          inputMode="search"
          placeholder="Handle"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          maxLength={32}
        />
      </label>

      {status === "loading" ? (
        <p className="findLot__muted" role="status">
          Looking&hellip;
        </p>
      ) : null}
      {status === "error" ? (
        <p className="findLot__error" role="alert">
          Couldn&rsquo;t search right now.
        </p>
      ) : null}
      {status === "ready" && matches.length === 0 ? (
        <p className="findLot__muted" role="status">
          No claimed handles match that.
        </p>
      ) : null}

      {matches.length > 0 ? (
        <ul className="findLot__list">
          {matches.map((match) => {
            const followState = visibleFollowByHandle[match.handle] ?? "idle";
            const isSelf = viewer && match.handle === viewer;
            // The edge the page was told about, moved on by a tap made since.
            const startingRelation = match.relation ?? "none";
            const relation: FollowRelation =
              followState === "done"
                ? startingRelation === "follows_you" || startingRelation === "mates"
                  ? "mates"
                  : "following"
                : startingRelation;
            const hint = followRelationHint(relation);
            const alreadyFollowing = relation === "following" || relation === "mates";
            return (
              <li key={match.id} className="findLot__row">
                <Link
                  className="findLot__identity"
                  href={`/u/${encodeURIComponent(match.handle)}`}
                >
                  <span className="findLot__avatar" aria-hidden="true">
                    {match.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element -- owned avatar path
                      <img src={match.avatarUrl} alt="" loading="lazy" decoding="async" />
                    ) : (
                      avatarInitial(match.handle)
                    )}
                  </span>
                  <span className="findLot__names">
                    <span className="findLot__handle">
                      {displayHandle(match.handle)}
                    </span>
                    {match.displayName ? (
                      <span className="findLot__display">{match.displayName}</span>
                    ) : null}
                    {hint && !isSelf ? (
                      <span className="findLot__hint">{hint}</span>
                    ) : null}
                  </span>
                </Link>
                {isSelf ? (
                  <span className="findLot__self">You</span>
                ) : !viewer ? (
                  viewerSession.unresolved ? null : (
                    <Link
                      className="findLot__ghost"
                      href={viewerSession.signedIn ? "/u/you" : "/login"}
                    >
                      {viewerSession.signedIn
                        ? "Claim a handle to follow"
                        : "Sign in to follow"}
                    </Link>
                  )
                ) : (
                  <button
                    type="button"
                    className="findLot__follow"
                    disabled={followState === "working" || alreadyFollowing}
                    onClick={() => void follow(match.handle)}
                  >
                    {followState === "working"
                      ? followPendingLabel(relation)
                      : followActionLabel(relation)}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}

      <div className="findLot__invite">
        {visibleInviteUrl ? (
          <>
            <code className="findLot__inviteUrl">{visibleInviteUrl}</code>
            <button type="button" className="findLot__follow" onClick={() => void copyInvite()}>
              {copied ? "Copied" : "Copy invite link"}
            </button>
          </>
        ) : viewer ? (
          <button
            type="button"
            className="findLot__follow"
            disabled={inviteBusy}
            onClick={() => void mintInviteLink()}
          >
            {inviteBusy ? "Minting…" : "Get invite link"}
          </button>
        ) : viewerSession.unresolved ? null : (
          <Link
            className="findLot__follow"
            href={viewerSession.signedIn ? "/u/you" : "/login"}
          >
            {viewerSession.signedIn
              ? "Claim a handle to invite"
              : "Sign in to invite"}
          </Link>
        )}
        {shareSelf ? (
          <Link className="findLot__ghost" href={`/add/${encodeURIComponent(viewer)}`}>
            Share your add link
          </Link>
        ) : null}
      </div>

      {notice ? (
        <p className="findLot__error" role="alert">
          {notice}
        </p>
      ) : null}
    </section>
  );
}
