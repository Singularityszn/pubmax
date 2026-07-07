"use client";

import Image from "next/image";
import Link from "next/link";

import CommentThread from "@/components/pintdrop/CommentThread";
import ShareBar from "@/components/share/ShareBar";
import { computeChaosScore } from "@/lib/chaosScore";
import type { FeedItem } from "@/lib/feed";
import { displayHandle } from "@/lib/handleDisplay";
import { REACTION_KEYS, type ReactionKey, type ReactionSummary } from "@/lib/reactions";
import { relativeTime } from "@/lib/relativeTime";

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

  const provLabel = PROVENANCE_LABEL[item.provenance] ?? item.provenance;

  return (
    <article
      className={`feedCard${hero ? " feedCardSpill" : ""}`}
      aria-label={`Pint drop from ${shownHandle}`}
    >
      {hero ? (
        // Vertical 9:16 full-bleed "Spill" card (issue #36): the photo IS the
        // card (IG-Stories ratio) with the handle, venue, note, price stamp and
        // provenance badge overlaid on a bottom scrim — a TikTok/IG post treatment.
        <div className="feedSpill">
          <Image
            className="feedSpillPhoto"
            src={hero}
            alt={`Pint at ${item.venueName}, shared by ${shownHandle}`}
            width={720}
            height={1280}
            loading="lazy"
            unoptimized
          />
          {/* Provenance badge — top-left, ALWAYS visible on the photo, read like
              a verified checkmark (glyph + label): the X-style provenance
              prominence the brief calls for. */}
          <span
            className={`feedSpillProv feedProv-${item.provenance}`}
            title={`Provenance: ${provLabel}`}
            aria-label={`Provenance: ${provLabel}`}
          >
            <ProvenanceCheck />
            <span className="feedSpillProvLabel">{provLabel}</span>
          </span>

          {/* Price stamp — top-right, the pressed-ink signature. */}
          {typeof item.priceGbp === "number" ? (
            <span className="feedSpillPrice">{formatGbp(item.priceGbp)}</span>
          ) : null}

          {/* Bottom scrim + overlaid content. The scrim is a FIXED dark gradient
              (not theme-mixed) so text legibility is guaranteed over an arbitrary
              photo background in BOTH themes. */}
          <div className="feedSpillScrim">
            <div className="feedSpillWho">
              <span className="feedSpillAvatar" aria-hidden="true">
                {initial}
              </span>
              <div className="feedSpillWhoText">
                <span className="feedSpillHandle">{shownHandle}</span>
                <span className="feedSpillMeta">
                  <Link className="feedSpillVenueLink" href={item.venueMapUrl}>
                    {item.venueName}
                  </Link>
                  {ago ? (
                    <>
                      {" · "}
                      <time dateTime={item.createdAt}>{ago}</time>
                    </>
                  ) : null}
                </span>
              </div>
            </div>
            {item.caption ? <p className="feedSpillNote">{item.caption}</p> : null}
            <Link
              className="feedSpillBarTab"
              href={`/bar-tab/${encodeURIComponent(item.venueId)}`}
            >
              See the bar tab
            </Link>
          </div>
        </div>
      ) : (
        // Text-only drop: keep the header + typographic "receipt" collectible.
        // Do NOT force 9:16 on a card with no photo.
        <>
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
            <span className={`feedProv feedProv-${item.provenance}`}>{provLabel}</span>
          </header>

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
        </>
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
                className="feedVibe feedChaos"
                title={chaos.oneLiner}
                aria-label={`Chaos Score ${chaos.score} out of 100, ${chaos.grade}`}
              >
                Chaos {chaos.score} · {chaos.grade}
              </li>
            ) : null}
          </ul>
        ) : null}

        {/* The caption + venue line live in the Spill scrim for photo drops; the
            body only repeats them for the text-only receipt card. */}
        {!hero && item.caption ? <p className="feedCaption">{item.caption}</p> : null}

        {!hero ? (
          // The pub name (never the raw venue id) links to the map with this
          // venue selected, plus a cross-link to the venue's Bar Tab grid.
          <p className="feedVenue">
            {item.drink ? <span className="feedDrink">{item.drink}</span> : null}
            <span className="feedVenueAt">at</span>
            <Link className="feedVenueLink" href={item.venueMapUrl}>
              {item.venueName}
            </Link>
            <Link
              className="feedVenueBarTab"
              href={`/bar-tab/${encodeURIComponent(item.venueId)}`}
            >
              See the bar tab
            </Link>
          </p>
        ) : null}

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

// The provenance "verified checkmark" glyph — a small sealed tick that gives a
// Spill's provenance badge the visual weight of an X/Twitter verified mark,
// without borrowing another brand's blue. currentColor so the per-provenance
// colour (see feedProv-* in feed.css) carries.
function ProvenanceCheck() {
  return (
    <svg
      className="feedSpillProvGlyph"
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M12 1.5 14.6 4l3.5-.3.9 3.4 3 1.9-1.5 3.2 1.5 3.2-3 1.9-.9 3.4-3.5-.3L12 22.5 9.4 20l-3.5.3-.9-3.4-3-1.9L3.5 12 2 8.8l3-1.9.9-3.4 3.5.3L12 1.5Z" />
      <path
        d="m8.2 12.2 2.6 2.6 5-5.4"
        fill="none"
        stroke="var(--paper, #12100c)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
