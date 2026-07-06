"use client";

import Image from "next/image";
import Link from "next/link";

import CommentThread from "@/components/pintdrop/CommentThread";
import ShareBar from "@/components/share/ShareBar";
import { computeChaosScore } from "@/lib/chaosScore";
import type { FeedItem } from "@/lib/feed";
import { displayHandle } from "@/lib/handleDisplay";
import { REACTION_KEYS, type ReactionKey, type ReactionSummary } from "@/lib/reactionsStore";

// Pub-native reactions — no likes/hearts. The chip set is derived from the
// canonical server allowlist (REACTION_KEYS) so the UI and the reactions route
// can never drift; each key gets a label + emoji here. Counts + which the viewer
// has used come from the durable backend (the page batch-loads them and owns the
// toggle); this card just renders the summary it is handed.
const REACTION_META: Record<ReactionKey, { label: string; emoji: string }> = {
  cheers: { label: "Cheers", emoji: "🍺" },
  bargain: { label: "Bargain", emoji: "💷" },
  chaos: { label: "Chaos", emoji: "🔥" },
  proper: { label: "Proper", emoji: "👌" },
  legendary: { label: "Legendary", emoji: "🏆" },
};

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

export default function FeedCard({
  item,
  summary,
  onToggleReaction,
}: {
  item: FeedItem;
  summary: ReactionSummary;
  onToggleReaction: (dropId: string, reaction: ReactionKey) => void;
}) {
  const hero = item.photoUrls[0];
  const initial = item.handle.trim().charAt(0).toUpperCase() || "?";
  const ago = relativeTime(item.createdAt);
  const mine = new Set(summary.mine);
  // One normalized "@handle" used everywhere this card names the author, so a
  // seed handle that already carries a leading "@" can't render as "@@".
  const shownHandle = displayHandle(item.handle);

  // Chaos Score (issue #30) — cheap, single-drop reading (one stop, this
  // drop's own vibe tags + posted hour). A full crawl-level score needs a
  // multi-stop night the feed doesn't model yet (every FeedItem here is one
  // Pint Drop, not a Round — lib/feed.ts type FeedItemType); showing a badge
  // only when it clears "Steady" keeps quiet single pints from getting a
  // score nobody asked for.
  const dropHour = (() => {
    const t = Date.parse(item.createdAt);
    return Number.isFinite(t) ? new Date(t).getHours() : null;
  })();
  const chaos = computeChaosScore({
    stopCount: 1,
    prices: typeof item.priceGbp === "number" ? [item.priceGbp] : [],
    vibeTags: item.vibeTags,
    lastDropHour: dropHour,
  });
  const showChaosBadge = chaos.score >= 30;

  return (
    <article className="feedCard" aria-label={`Pint drop from ${shownHandle}`}>
      <header className="feedCardHead">
        <span className="feedAvatar" aria-hidden="true">
          {initial}
        </span>
        <div className="feedWho">
          <span className="feedHandle">{shownHandle}</span>
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
            alt={`Pint at ${item.venueName}, shared by ${shownHandle}`}
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
        {item.vibeTags.length > 0 || showChaosBadge ? (
          <ul className="feedVibes" aria-label="Vibe tags">
            {item.vibeTags.map((tag) => (
              <li key={tag} className="feedVibe">
                {tag}
              </li>
            ))}
            {/* Chaos Score badge (issue #30) — reuses .feedVibe's pill styling
                (no new CSS file needed) so it sits quietly alongside the vibe
                tags rather than as a separate loud widget. Only shown once a
                drop actually clears "Steady" — most single pints won't. */}
            {showChaosBadge ? (
              <li
                className="feedVibe"
                title={chaos.oneLiner}
                aria-label={`Chaos Score ${chaos.score} out of 100, ${chaos.grade}`}
              >
                Chaos {chaos.score} · {chaos.grade}
              </li>
            ) : null}
          </ul>
        ) : null}

        {item.caption ? <p className="feedCaption">{item.caption}</p> : null}

        {/* The pub name (never the raw venue id) links to the map with this
            venue selected. */}
        <p className="feedVenue">
          {item.drink ? <span className="feedDrink">{item.drink}</span> : null}
          <span className="feedVenueAt">at</span>
          <Link className="feedVenueLink" href={item.venueMapUrl}>
            {item.venueName}
          </Link>
        </p>

        <div className="feedReactions" role="group" aria-label="React to this pint">
          {REACTION_KEYS.map((key) => {
            const meta = REACTION_META[key];
            const on = mine.has(key);
            const count = summary.counts[key] ?? 0;
            return (
              <button
                key={key}
                type="button"
                className={`feedReactBtn${on ? " isOn" : ""}`}
                aria-pressed={on}
                aria-label={count ? `${meta.label}, ${count}` : meta.label}
                onClick={() => onToggleReaction(item.id, key)}
              >
                <span aria-hidden="true">{meta.emoji}</span>
                <span className="feedReactLabel">{meta.label}</span>
                {count > 0 ? <span className="feedReactCount">{count}</span> : null}
              </button>
            );
          })}
        </div>

        {/* Every pint is its own shareable post: open the standalone permalink
            or fire it into X / WhatsApp / a group chat. */}
        <div className="feedCardFooter">
          <Link className="feedPermalink" href={`/p/${item.id}`}>
            Open pint
          </Link>
          <ShareBar
            url={`/p/${item.id}`}
            title={`${shownHandle}'s pint at ${item.venueName}`}
            text={`${shownHandle} found a pint at ${item.venueName}${
              typeof item.priceGbp === "number" ? ` — ${formatGbp(item.priceGbp)}` : ""
            }. Every pint has a story.`}
          />
        </div>

        {/* Comments continue the drop's story. Collapsed by default; the thread
            lazily mounts + fetches only when expanded. A comment API error stays
            inside CommentThread and never breaks feed rendering. */}
        <CommentThread dropId={item.id} />
      </div>
    </article>
  );
}
