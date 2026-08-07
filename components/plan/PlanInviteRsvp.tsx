"use client";

import { useCallback, useState } from "react";

import { getAnonId } from "@/lib/anonId";
import { GUEST_DISPLAY_NAME_MAX, isRsvpStatus, type PlanInviteRsvpSummary, type RsvpStatus } from "@/lib/planInvite";
import { REACTION_KEYS, type ReactionKey, type ReactionSummary } from "@/lib/reactions";

// The handle-free RSVP + reaction island on a Plan's public invite page (Task:
// plan-invite-page, ruling 2). No account: a guest types a name, picks Going
// or Maybe, and that's the whole write. Same resilience contract as
// CommentThread — a failed fetch shows a quiet inline message and never takes
// the static invite card down with it.
//
// Identity is the device's own anon id (lib/anonId.ts), hashed server-side —
// never a handle, never an account. Resubmitting just updates this device's
// own row (server-side unique(plan_id, submitter_hash)), so changing Going to
// Maybe never stacks a second entry.
//
// Emoji meanings mirror components/feed/FeedCard.tsx's REACTION_META exactly,
// so the same chip means the same thing everywhere in the product.
const REACTION_META: Record<ReactionKey, { label: string; emoji: string }> = {
  cheers: { label: "Cheers", emoji: "🍺" },
  bargain: { label: "Bargain", emoji: "💷" },
  chaos: { label: "Chaos", emoji: "🔥" },
  proper: { label: "Proper", emoji: "👌" },
  legendary: { label: "Legendary", emoji: "🏆" },
};

// Deliberately its own key, not `pubmax_handle` — RSVP is handle-free by
// design (ruling 2), so a guest's typed name here is a per-invite convenience,
// not the site-wide handle identity.
const GUEST_NAME_STORAGE_KEY = "pubmax:inviteGuestName:v1";

function readStoredGuestName(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(GUEST_NAME_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

function writeStoredGuestName(name: string): void {
  try {
    window.localStorage.setItem(GUEST_NAME_STORAGE_KEY, name);
  } catch {
    // Storage full / denied — the typed name still drives this session.
  }
}

export default function PlanInviteRsvp({
  token,
  initialRsvp,
  initialReactions,
}: {
  token: string;
  initialRsvp: PlanInviteRsvpSummary;
  initialReactions: ReactionSummary;
}) {
  const [rsvp, setRsvp] = useState(initialRsvp);
  const [reactions, setReactions] = useState(initialReactions);
  const [name, setName] = useState(() => readStoredGuestName());
  const [status, setStatus] = useState<RsvpStatus | null>(null);
  const [submittingRsvp, setSubmittingRsvp] = useState(false);
  const [rsvpError, setRsvpError] = useState<string | null>(null);
  const [pendingReaction, setPendingReaction] = useState<ReactionKey | null>(null);
  const [reactionError, setReactionError] = useState<string | null>(null);

  const submitRsvp = useCallback(
    async (chosen: RsvpStatus) => {
      const trimmedName = name.trim();
      if (!trimmedName || submittingRsvp) return;

      setStatus(chosen);
      setSubmittingRsvp(true);
      setRsvpError(null);
      writeStoredGuestName(trimmedName);

      try {
        const res = await fetch(`/api/invite/${encodeURIComponent(token)}/rsvp`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            displayName: trimmedName,
            status: chosen,
            submitterId: getAnonId(),
          }),
        });
        if (!res.ok) {
          setRsvpError(
            res.status === 429
              ? "That's a lot of RSVPs. Give it a moment."
              : res.status === 404
                ? "This invite link isn't valid."
                : "Couldn't save that RSVP.",
          );
          return;
        }
        const data = (await res.json()) as { summary?: PlanInviteRsvpSummary };
        if (data.summary) setRsvp(data.summary);
      } catch {
        setRsvpError("Couldn't save that RSVP.");
      } finally {
        setSubmittingRsvp(false);
      }
    },
    [name, submittingRsvp, token],
  );

  const onSubmit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (isRsvpStatus(status)) void submitRsvp(status);
    },
    [status, submitRsvp],
  );

  const toggleReaction = useCallback(
    async (reaction: ReactionKey) => {
      if (pendingReaction) return;
      setPendingReaction(reaction);
      setReactionError(null);

      try {
        const res = await fetch(`/api/invite/${encodeURIComponent(token)}/reactions`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ reaction, submitterId: getAnonId() }),
        });
        if (!res.ok) {
          setReactionError(res.status === 429 ? "Slow down a moment." : "Couldn't save that reaction.");
          return;
        }
        const data = (await res.json()) as { summary?: ReactionSummary };
        if (data.summary) setReactions(data.summary);
      } catch {
        setReactionError("Couldn't save that reaction.");
      } finally {
        setPendingReaction(null);
      }
    },
    [pendingReaction, token],
  );

  const goingCount = rsvp.counts.going;
  const maybeCount = rsvp.counts.maybe;

  return (
    <div className="inviteRsvp">
      <div className="inviteRsvp__summary">
        <span>
          <span className="inviteRsvp__count">{goingCount}</span>{" "}
          <span className="inviteRsvp__countLabel">going</span>
        </span>
        <span>
          <span className="inviteRsvp__count">{maybeCount}</span>{" "}
          <span className="inviteRsvp__countLabel">maybe</span>
        </span>
      </div>

      {rsvp.guests.length > 0 ? (
        <ul className="inviteRsvp__guests">
          {rsvp.guests.map((guest) => (
            <li className="inviteRsvp__guest" key={guest.id}>
              <span className="inviteRsvp__guestName">{guest.displayName}</span>
              <span className={`inviteRsvp__guestStatus inviteRsvp__guestStatus--${guest.status}`}>
                {guest.status === "going" ? "Going" : "Maybe"}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="inviteRsvp__empty">No RSVPs yet. Be the first.</p>
      )}

      <form className="inviteRsvp__form" onSubmit={onSubmit}>
        <input
          className="inviteRsvp__nameInput"
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Your name"
          aria-label="Your name"
          maxLength={GUEST_DISPLAY_NAME_MAX}
          autoComplete="name"
        />
        <div className="inviteRsvp__statusRow">
          <button
            type="button"
            className="inviteRsvp__statusButton"
            aria-pressed={status === "going"}
            onClick={() => setStatus("going")}
          >
            Going
          </button>
          <button
            type="button"
            className="inviteRsvp__statusButton"
            aria-pressed={status === "maybe"}
            onClick={() => setStatus("maybe")}
          >
            Maybe
          </button>
        </div>
        <button
          type="submit"
          className="inviteRsvp__submit"
          disabled={submittingRsvp || !name.trim() || !status}
        >
          {submittingRsvp ? "Saving…" : "RSVP"}
        </button>
      </form>

      {rsvpError ? (
        <p className="inviteRsvp__error" role="status">
          {rsvpError}
        </p>
      ) : null}

      <div className="inviteRsvp__reactions">
        {REACTION_KEYS.map((key) => {
          const meta = REACTION_META[key];
          const count = reactions.counts[key] || 0;
          const mine = reactions.mine.includes(key);
          return (
            <button
              key={key}
              type="button"
              className="inviteRsvp__reaction"
              aria-pressed={mine}
              aria-label={meta.label}
              disabled={pendingReaction !== null}
              onClick={() => void toggleReaction(key)}
            >
              <span aria-hidden="true">{meta.emoji}</span>
              {count > 0 ? <span>{count}</span> : null}
            </button>
          );
        })}
      </div>

      {reactionError ? (
        <p className="inviteRsvp__error" role="status">
          {reactionError}
        </p>
      ) : null}
    </div>
  );
}
