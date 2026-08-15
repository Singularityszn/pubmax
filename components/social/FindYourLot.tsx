"use client";

// WP7 find-your-lot: prefix search for claimed handles + follow / open profile.
// Friendship stays mutual - follow here is one side; they follow back to share
// a lot. Invite link entry pulls a mate in with one share.

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { authedActionFetch } from "@/lib/authedFetch";
import {
  errorMessageFrom,
  findYourLotInviteFailureMessage,
  INVITE_LINK_FALLBACK_MESSAGE,
  INVITE_LINK_OFFLINE_MESSAGE,
} from "@/lib/apiErrorMessage";
import { discardBody } from "@/lib/responseBody";
import { displayHandle } from "@/lib/handleDisplay";
import { normalizeHandle } from "@/lib/profiles";

import "./findYourLot.css";

type SearchMatch = {
  id: string;
  handle: string;
  displayName?: string;
  avatarUrl?: string;
};

type FollowState = "idle" | "working" | "done" | "error";

function avatarInitial(handle: string): string {
  const clean = normalizeHandle(handle);
  return clean ? clean.slice(0, 1).toUpperCase() : "?";
}

export default function FindYourLot({
  myHandle,
  compact = false,
}: {
  myHandle?: string | null;
  compact?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<SearchMatch[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [followByHandle, setFollowByHandle] = useState<Record<string, FollowState>>({});
  const [notice, setNotice] = useState("");
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [storedHandle, setStoredHandle] = useState("");
  useEffect(() => {
    // Defer setState out of the effect body (react-hooks/set-state-in-effect).
    void Promise.resolve().then(() => {
      try {
        setStoredHandle(
          normalizeHandle(window.localStorage.getItem("pubmax_handle") ?? ""),
        );
      } catch {
        setStoredHandle("");
      }
    });
  }, []);
  const viewer = normalizeHandle(myHandle ?? "") || storedHandle;

  useEffect(() => {
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
    debounceRef.current = setTimeout(() => {
      void (async () => {
        try {
          const response = await fetch(
            `/api/profiles/search?q=${encodeURIComponent(q)}`,
            { cache: "no-store" },
          );
          if (!response.ok) {
            discardBody(response);
            setStatus("error");
            setMatches([]);
            return;
          }
          const body = (await response.json()) as { matches?: SearchMatch[] };
          setMatches(Array.isArray(body.matches) ? body.matches : []);
          setStatus("ready");
        } catch {
          setStatus("error");
          setMatches([]);
        }
      })();
    }, 220);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  async function follow(handle: string) {
    if (!viewer) {
      setNotice("Sign in and claim a handle first.");
      return;
    }
    if (normalizeHandle(handle) === viewer) return;
    setFollowByHandle((current) => ({ ...current, [handle]: "working" }));
    setNotice("");
    try {
      const response = await authedActionFetch(
        `/api/profiles/${encodeURIComponent(handle)}/follow`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ follower: viewer }),
        },
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as unknown;
        throw new Error(errorMessageFrom(body, "Could not follow them."));
      }
      setFollowByHandle((current) => ({ ...current, [handle]: "done" }));
    } catch (error) {
      setFollowByHandle((current) => ({ ...current, [handle]: "error" }));
      setNotice(error instanceof Error ? error.message : "Could not follow them.");
    }
  }

  async function mintInviteLink() {
    if (inviteBusy) return;
    setInviteBusy(true);
    setNotice("");
    try {
      const response = await authedActionFetch("/api/referrals/invite-link", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
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
      setInviteUrl(body.url);
    } catch (error) {
      setNotice(
        typeof navigator !== "undefined" && !navigator.onLine
          ? INVITE_LINK_OFFLINE_MESSAGE
          : error instanceof Error
            ? error.message
            : INVITE_LINK_FALLBACK_MESSAGE,
      );
    } finally {
      setInviteBusy(false);
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
      <p className="findLot__eyebrow">Your lot</p>
      <h2 id="find-lot-title" className="findLot__title">
        Find your lot
      </h2>
      <p className="findLot__body">
        Search a mate&rsquo;s handle, or send an invite link. A lot is mutual -
        they follow back and you share nights.
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
            const followState = followByHandle[match.handle] ?? "idle";
            const isSelf = viewer && match.handle === viewer;
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
                  </span>
                </Link>
                {isSelf ? (
                  <span className="findLot__self">You</span>
                ) : (
                  <button
                    type="button"
                    className="findLot__follow"
                    disabled={followState === "working" || followState === "done" || !viewer}
                    onClick={() => void follow(match.handle)}
                  >
                    {followState === "done"
                      ? "Following"
                      : followState === "working"
                        ? "Adding…"
                        : "Follow"}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}

      <div className="findLot__invite">
        {inviteUrl ? (
          <>
            <code className="findLot__inviteUrl">{inviteUrl}</code>
            <button type="button" className="findLot__follow" onClick={() => void copyInvite()}>
              {copied ? "Copied" : "Copy invite link"}
            </button>
          </>
        ) : (
          <button
            type="button"
            className="findLot__follow"
            disabled={inviteBusy}
            onClick={() => void mintInviteLink()}
          >
            {inviteBusy ? "Minting…" : "Get invite link"}
          </button>
        )}
        {shareSelf ? (
          <Link className="findLot__ghost" href={`/add/${encodeURIComponent(viewer)}`}>
            Share your add link
          </Link>
        ) : (
          <Link className="findLot__ghost" href="/login">
            Sign in to invite
          </Link>
        )}
      </div>

      {notice ? (
        <p className="findLot__error" role="alert">
          {notice}
        </p>
      ) : null}
    </section>
  );
}
