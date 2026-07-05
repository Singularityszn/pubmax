"use client";

import Image from "next/image";
import { useState } from "react";

import type { FeedItem } from "@/lib/feed";

// Pub-native reactions — no likes/hearts. These are demo-only: counts live in
// localStorage per item id, shaped so a future POST /api/reactions can drop in
// without touching the card (an id + delta is all a backend would need).
const REACTIONS = [
  { key: "cheers", label: "Cheers", emoji: "🍺" },
  { key: "bargain", label: "Bargain", emoji: "💷" },
  { key: "chaos", label: "Chaos", emoji: "🔥" },
  { key: "proper", label: "Proper", emoji: "👌" },
  { key: "legendary", label: "Legendary", emoji: "🏆" },
] as const;

type ReactionKey = (typeof REACTIONS)[number]["key"];
type ReactionState = Partial<Record<ReactionKey, boolean>>;

const STORAGE_PREFIX = "pubmax:feed:reactions:";

// Lazy, guarded localStorage read — runs once in useState init, never in an
// effect (react-hooks/set-state-in-effect). Any parse/access error → no
// reactions, never a crash (private mode / disabled storage / corrupt value).
function readReactions(id: string): ReactionState {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + id);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as ReactionState) : {};
  } catch {
    return {};
  }
}

function writeReactions(id: string, state: ReactionState): void {
  try {
    window.localStorage.setItem(STORAGE_PREFIX + id, JSON.stringify(state));
  } catch {
    // Storage full / denied — the in-memory toggle still updated, so the UI is
    // consistent for this session; persistence is best-effort by design.
  }
}

function formatGbp(price: number): string {
  return `£${price.toFixed(2)}`;
}

// Whole-number "n ago" relative time. Server and first client render must agree,
// so this is only ever called in render off a stable createdAt; roughness (no
// live ticking) is fine for a feed timestamp and avoids a hydration mismatch.
function relativeTime(createdAt: string): string {
  const then = Date.parse(createdAt);
  if (!Number.isFinite(then)) return "";
  const diffMs = Date.now() - then;
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  return new Date(then).toLocaleDateString("en-GB", { month: "short", year: "numeric" });
}

const PROVENANCE_LABEL: Record<string, string> = {
  sourced: "Sourced",
  contributor: "Contributor",
  anecdote: "Anecdote",
  demo: "Sample",
};

export default function FeedCard({ item }: { item: FeedItem }) {
  // Reactions persist per item id. Lazy init reads storage exactly once; toggles
  // happen only in the click handler below (never in an effect).
  const [reactions, setReactions] = useState<ReactionState>(() =>
    readReactions(item.id),
  );

  function toggleReaction(key: ReactionKey) {
    setReactions((prev) => {
      const next: ReactionState = { ...prev, [key]: !prev[key] };
      writeReactions(item.id, next);
      return next;
    });
  }

  const hero = item.photoUrls[0];
  const initial = item.handle.trim().charAt(0).toUpperCase() || "?";
  const ago = relativeTime(item.createdAt);

  return (
    <article className="feedCard" aria-label={`Pint drop from ${item.handle}`}>
      <header className="feedCardHead">
        <span className="feedAvatar" aria-hidden="true">
          {initial}
        </span>
        <div className="feedWho">
          <span className="feedHandle">@{item.handle}</span>
          {ago ? (
            <time className="feedTime" dateTime={item.createdAt}>
              {ago}
            </time>
          ) : null}
        </div>
        <span className={`feedProv feedProv-${item.provenance}`}>
          {PROVENANCE_LABEL[item.provenance] ?? item.provenance}
        </span>
      </header>

      {hero ? (
        <div className="feedPhotoWrap">
          <Image
            className="feedPhoto"
            src={hero}
            alt={`Pint at a pub, shared by ${item.handle}`}
            width={640}
            height={640}
            loading="lazy"
            unoptimized
          />
          {typeof item.priceGbp === "number" ? (
            <span className="feedPriceStamp">{formatGbp(item.priceGbp)}</span>
          ) : null}
        </div>
      ) : (
        // No photo → a typographic "receipt" card so the drop still reads as a
        // collectible, never a broken image.
        <div className="feedReceipt" role="img" aria-label="Pint drop receipt">
          <span className="feedReceiptEyebrow">Pint Drop</span>
          {typeof item.priceGbp === "number" ? (
            <span className="feedReceiptPrice">{formatGbp(item.priceGbp)}</span>
          ) : (
            <span className="feedReceiptPrice feedReceiptPriceMuted">A memory</span>
          )}
          {item.drink ? <span className="feedReceiptDrink">{item.drink}</span> : null}
          {item.era ? <span className="feedReceiptEra">{item.era}</span> : null}
        </div>
      )}

      <div className="feedCardBody">
        {item.vibeTags.length > 0 ? (
          <ul className="feedVibes" aria-label="Vibe tags">
            {item.vibeTags.map((tag) => (
              <li key={tag} className="feedVibe">
                {tag}
              </li>
            ))}
          </ul>
        ) : null}

        {item.caption ? <p className="feedCaption">{item.caption}</p> : null}

        <p className="feedVenue">
          {item.drink ? <span className="feedDrink">{item.drink}</span> : null}
          <span className="feedVenueId">at {item.venueId}</span>
        </p>

        <div className="feedReactions" role="group" aria-label="React to this pint">
          {REACTIONS.map((r) => {
            const on = Boolean(reactions[r.key]);
            return (
              <button
                key={r.key}
                type="button"
                className={`feedReactBtn${on ? " isOn" : ""}`}
                aria-pressed={on}
                aria-label={r.label}
                onClick={() => toggleReaction(r.key)}
              >
                <span aria-hidden="true">{r.emoji}</span>
                <span className="feedReactLabel">{r.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </article>
  );
}
