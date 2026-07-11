"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";

import CheersButton from "@/components/feed/CheersButton";
import { DrinkGlyph } from "@/components/drinks/DrinkGlyph";
import CommentThread from "@/components/pintdrop/CommentThread";
import ShareBar from "@/components/share/ShareBar";
import { categoryColor } from "@/lib/categoryColors";
import { computeChaosScore } from "@/lib/chaosScore";
import { categoryLabel, type DrinkCategory } from "@/lib/drinks";
import { drinkCategoryFromText } from "@/lib/drinkCategoryFromText";
import type { FeedItem, OptimisticSpillState } from "@/lib/feed";
import { displayHandle } from "@/lib/handleDisplay";
import { REACTION_KEYS, type ReactionKey, type ReactionSummary } from "@/lib/reactions";
import prefetchVenue from "@/lib/prefetchVenue";
// Shared chip vocabulary — seeded content always reads "Demo", never "Sample".
import { PROVENANCE_LABEL } from "@/lib/provenanceLabels";
import { relativeTime } from "@/lib/relativeTime";
import { lastTrainBadge } from "@/lib/lastTrainBadge";
import { venueMapUrl } from "@/lib/venueMapUrl";

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


function feedCardClassName(
  hero: string | undefined,
  optimistic: OptimisticSpillState | undefined,
  hasCategory: boolean,
  entered: boolean,
): string {
  return [
    "feedCard",
    hero ? "feedCardSpill" : "",
    // Only paint the coloured left accent stripe when we honestly know the
    // category — an unknown drink falls back to the plain (brass-neutral) card.
    hasCategory ? "feedCardCat" : "",
    optimistic ? `feedCard-${optimistic.state}` : "",
    // Wave L1 — mount-only entrance (see the `entered` effect below): starts
    // scaled/faded, settles once. Never replays on a prop-only re-render.
    entered ? "feedCardEntered" : "feedCardEnter",
  ]
    .filter(Boolean)
    .join(" ");
}

// The colour language, honestly derived. A FeedItem carries `drink` as free
// text, never a category, so we classify it — and fall back to beer/brass when
// the text gives no signal (drinkCategoryFromText returns null). `resolved`
// tells the card whether the colour is a real read (paint the stripe + label)
// or the honest beer fallback (glyph only, no asserted category label).
function resolveCategory(drink: string): {
  category: DrinkCategory;
  resolved: boolean;
} {
  const hit = drinkCategoryFromText(drink);
  return hit ? { category: hit, resolved: true } : { category: "beer", resolved: false };
}

function FeedOptimisticStatus({
  optimistic,
  onRetryPost,
}: {
  optimistic?: OptimisticSpillState;
  onRetryPost?: (clientRequestId: string) => void;
}) {
  if (!optimistic) return null;
  const canRetry = optimistic.state === "failed" && optimistic.canRetry && onRetryPost;
  return (
    <div
      className={`feedCardStatus feedCardStatus-${optimistic.state}`}
      role={optimistic.state === "failed" ? "alert" : "status"}
      aria-live={optimistic.state === "failed" ? "assertive" : "polite"}
    >
      <span className="feedCardStatusText">{optimistic.message}</span>
      {optimistic.state === "uploading" && optimistic.uploadProgress !== null ? (
        <span
          className="feedUploadProgress"
          aria-label={`Photo upload ${optimistic.uploadProgress}% complete`}
        >
          <span style={{ width: `${optimistic.uploadProgress}%` }} />
        </span>
      ) : null}
      {canRetry ? (
        <button
          className="feedRetryPost"
          type="button"
          onClick={() => onRetryPost(optimistic.clientRequestId)}
        >
          Retry
        </button>
      ) : null}
    </div>
  );
}

export default function FeedCard({
  item,
  summary,
  onToggleReaction,
  onRetryPost,
}: {
  item: FeedItem;
  summary: ReactionSummary;
  // U2: the toggle may return a promise reporting whether it actually stuck
  // (false = the POST failed and the page rolled the summary back). The
  // CheersButton consumes it to revert its tick + show the claim-a-handle
  // prompt; the tucked-away chip row keeps ignoring the return value.
  onToggleReaction: (dropId: string, reaction: ReactionKey) => Promise<boolean | void> | void;
  onRetryPost?: (clientRequestId: string) => void;
}) {
  const hero = item.photoUrls[0];
  const initial = item.handle.trim().charAt(0).toUpperCase() || "?";
  const ago = relativeTime(item.createdAt);
  const mine = new Set(summary.mine);

  // Wave L1 — mount-only entrance. `entered` starts false so the card's FIRST
  // paint renders the "pre-entrance" state (scale(.98) + opacity:0, see
  // .feedCardEnter in feed.css); a rAF right after that first paint flips it
  // to true, which changes the actual class/computed style and lets the CSS
  // TRANSITION (not a keyframe animation) carry it to rest. Empty deps means
  // this effect fires exactly once per real DOM mount — a poll refresh, a
  // reaction count ticking up, or any other prop-only re-render of THIS SAME
  // card (same `key`/`item.id`, same component instance) never re-runs it, so
  // the entrance never replays on cards already on screen. A brand-new drop
  // (a genuinely new `item.id`, hence a fresh FeedCard instance/key) gets its
  // own fresh mount and its own entrance. Using a transition driven by a
  // boolean (rather than a @keyframes animation retriggered by a class swap)
  // keeps this interruptible — if the card is torn down mid-entrance there's
  // no animation to cancel/jump.
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(raf);
  }, []);
  // A4 — the primary one-tap "Cheers" kudos reuses the existing "cheers"
  // reaction key (no schema/key change): its count + whether the viewer cheered
  // are read off the same durable summary the chip row uses, so the big button
  // and the tucked-away chip stay in lockstep. onToggleReaction owns the network
  // round-trip + rollback; CheersButton just adds the instant optimistic flip.
  const cheersCount = summary.counts.cheers ?? 0;
  const cheeredByMe = mine.has("cheers");
  const onCheers = (dropId: string) => onToggleReaction(dropId, "cheers");
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
  const optimistic = item.optimistic;
  const isOptimistic = Boolean(optimistic);

  // E5 colour language — "every drink has a colour". Derived honestly from the
  // free-text drink label; `resolved` is false when the text gave no signal (we
  // then show the beer/brass glyph but assert NO category label). The category
  // token flows to the card as a CSS var so the stripe, glyph, tinted scrim edge
  // and the Cheers active state all read from one source.
  const { category, resolved: categoryResolved } = resolveCategory(item.drink);
  const catStyle = { ["--feed-cat" as string]: categoryColor(category) };
  const catLabel = categoryLabel(category);

  // Honest Last Train stamp (Wave F0 / IDEAS A5): only when the drop carries
  // leave-by + a live decision kind. Never invent "made the last train."
  const trainBadge = lastTrainBadge(
    item.createdAt,
    item.leaveByIso,
    item.lastTrainDecision,
  );

  return (
    <article
      className={feedCardClassName(hero, optimistic, categoryResolved, entered)}
      style={catStyle}
      aria-label={`${optimistic ? `${optimistic.message}. ` : ""}Pint drop from ${shownHandle}`}
    >
      <FeedOptimisticStatus optimistic={optimistic} onRetryPost={onRetryPost} />
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
            style={{ viewTransitionName: `feed-photo-${item.id}` }}
          />
          {/* Category-tinted gradient edge — a colour whisper of the drink family
              along the bottom edge, UNDER the fixed dark scrim so it never fights
              text legibility. Only when the category is a real read. */}
          {categoryResolved ? (
            <span className="feedSpillCatEdge" aria-hidden="true" />
          ) : null}
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
            <span
              className="feedSpillPrice"
              style={{ viewTransitionName: `feed-price-${item.id}` }}
            >
              {formatGbp(item.priceGbp)}
            </span>
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
                  <Link
                    className="feedSpillVenueLink"
                    href={item.venueMapUrl}
                    onPointerEnter={() => prefetchVenue(item.venueId)}
                  >
                    {item.venueName}
                  </Link>
                  {ago ? (
                    <>
                      {" · "}
                      <time dateTime={item.createdAt}>{ago}</time>
                    </>
                  ) : null}
                  {trainBadge ? (
                    <>
                      {" · "}
                      <span className="feedTrainBadge" data-tone={trainBadge.tone}>
                        {trainBadge.label}
                      </span>
                    </>
                  ) : null}
                </span>
              </div>
            </div>
            {/* Drink-category chip — colour + glyph + label (never colour alone,
                WCAG 1.4.1). Only when the category is a confident read; an
                unknown drink shows no fabricated family. */}
            {categoryResolved ? (
              <span className="feedSpillCat" title={`${catLabel} · ${item.drink}`}>
                <DrinkGlyph category={category} size={16} inheritColor />
                <span className="feedSpillCatLabel">{catLabel}</span>
              </span>
            ) : null}
            {item.caption ? <p className="feedSpillNote">{item.caption}</p> : null}
            {/* A4 — primary one-tap Cheers, over the dark scrim (frosted variant). */}
            {!isOptimistic ? (
              <>
                <div className="feedSpillCheers">
                  <CheersButton
                    dropId={item.id}
                    count={cheersCount}
                    mine={cheeredByMe}
                    onToggle={onCheers}
                    className={`cheersBtnOnScrim${categoryResolved ? " cheersBtnCat" : ""}`}
                  />
                </div>
                <Link
                  className="feedSpillBarTab"
                  href={`/bar-tab/${encodeURIComponent(item.venueId)}`}
                >
                  See the bar tab
                </Link>
              </>
            ) : null}
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
              {trainBadge ? (
                <span className="feedTrainBadge" data-tone={trainBadge.tone}>
                  {trainBadge.label}
                </span>
              ) : null}
            </div>
            <span className={`feedProv feedProv-${item.provenance}`}>{provLabel}</span>
          </header>

          <div className="feedReceipt" role="img" aria-label="Pint drop receipt">
            {/* Category glyph, colour-driven — the drink family's mark presiding
                over the receipt. Honest fallback: beer/brass when unresolved. */}
            <span className="feedReceiptGlyph" aria-hidden="true">
              <DrinkGlyph category={category} size={34} />
            </span>
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
        {/* Category chip — the redundant non-colour cue (glyph + label) that
            accompanies the card's accent colour. Text-only card only; the Spill
            card carries its own chip over the scrim. Resolved categories only. */}
        {!hero && categoryResolved ? (
          <span className="feedCatChip" title={`${catLabel} · ${item.drink}`}>
            <DrinkGlyph category={category} size={16} inheritColor />
            <span className="feedCatChipLabel">{catLabel}</span>
          </span>
        ) : null}
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
            <Link
              className="feedVenueLink"
              href={item.venueMapUrl}
              onPointerEnter={() => prefetchVenue(item.venueId)}
            >
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

        {/* A4 — the dominant primary ack, above the tucked-away chip row. On the
            9:16 Spill card this lives over the scrim instead (see above), so only
            the text-only receipt card mounts it here. */}
        {!hero && !isOptimistic ? (
          <div className="feedCheers">
            <CheersButton
              dropId={item.id}
              count={cheersCount}
              mine={cheeredByMe}
              onToggle={onCheers}
              className={categoryResolved ? "cheersBtnCat" : undefined}
            />
          </div>
        ) : null}

        {!isOptimistic ? (
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
        ) : null}

        {/* Every pint is its own shareable post: open the standalone permalink
            or fire it into X / WhatsApp / a group chat. */}
        {!isOptimistic ? (
          <div className="feedCardFooter">
            <nav className="feedCardActions" aria-label="Pub actions">
              <Link
                className="feedCardAction"
                href={item.venueMapUrl || venueMapUrl(item.venueId)}
                onPointerEnter={() => prefetchVenue(item.venueId)}
              >
                Map
              </Link>
              {item.venueId ? (
                <Link
                  className="feedCardAction"
                  href={`${venueMapUrl(item.venueId)}&log=1`}
                  onPointerEnter={() => prefetchVenue(item.venueId)}
                >
                  Drop
                </Link>
              ) : null}
              <Link
                className="feedCardAction"
                href={
                  item.venueId
                    ? `/bar-tab/${encodeURIComponent(item.venueId)}`
                    : item.venueMapUrl || "/map"
                }
              >
                Pub
              </Link>
            </nav>
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
        ) : null}

        {/* Comments continue the drop's story. Collapsed by default; the thread
            lazily mounts + fetches only when expanded. A comment API error stays
            inside CommentThread and never breaks feed rendering. */}
        {!isOptimistic ? <CommentThread dropId={item.id} /> : null}
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
