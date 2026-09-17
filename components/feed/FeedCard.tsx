"use client";

import Image from "next/image";
import { priceBand, priceBandAreaForVenue } from "@/lib/priceBand";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import PriceBadge from "@/components/PriceBadge";
import { DrinkGlyph } from "@/components/drinks/DrinkGlyph";
import HandleAvatar from "@/components/profile/HandleAvatar";
import CommentThread from "@/components/pintdrop/CommentThread";
import ShareBar from "@/components/share/ShareBar";
import { categoryColor } from "@/lib/categoryColors";
import { computeChaosScore } from "@/lib/chaosScore";
import { categoryLabel, type DrinkCategory } from "@/lib/drinks";
import { drinkCategoryFromText } from "@/lib/drinkCategoryFromText";
import type { FeedItem, OptimisticSpillState } from "@/lib/feed";
import { CHEERS_GATE_PROMPT } from "@/lib/optimisticToggle";
import { displayHandle } from "@/lib/handleDisplay";
import { REACTION_KEYS, REACTION_META, type ReactionKey, type ReactionSummary } from "@/lib/reactions";
import prefetchVenue from "@/lib/prefetchVenue";
// Shared chip vocabulary — seeded content always reads "Demo", never "Sample".
import { PROVENANCE_LABEL } from "@/lib/provenanceLabels";
import { relativeTime } from "@/lib/relativeTime";
import { lastTrainBadge } from "@/lib/lastTrainBadge";
import { venueMapUrl } from "@/lib/venueMapUrl";
import { formatGbp } from "@/lib/formatGbp";

// For .cheersGatePrompt — the claim-a-handle failure prompt style (U2), now
// rendered beside the reaction row.
import cheersStyles from "./cheersButton.module.css";
// The card's own chrome (.feedCard, .feedSpill, reaction row, provenance…) lives
// in Feed.module.css. Co-locate the import here so a FeedCard renders styled
// wherever it mounts — /feed and /we-are-out import Feed.module.css too, but the
// profile Timeline (ProfileTimeline) and any future consumer did not, so those
// cards painted raw.
import styles from "@/app/feed/Feed.module.css";

// Pub-native reactions — chip labels/emoji live in lib/reactions.ts REACTION_META.

// One reaction chip — pulled out of FeedCard (taste fix, feed card slim) so
// the row's per-key branching lives here instead of inflating FeedCard's own
// complexity. Same markup/behaviour as before, just its own small component.
function ReactionChip({
  meta,
  on,
  count,
  onClick,
}: {
  meta: { label: string; emoji: string };
  on: boolean;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`${styles.feedReactBtn}${on ? ` ${styles.isOn}` : ""}`}
      aria-pressed={on}
      aria-label={count ? `${meta.label}, ${count}` : meta.label}
      title={meta.label}
      onClick={onClick}
    >
      <span aria-hidden="true">{meta.emoji}</span>
      <span className={styles.feedReactLabel}>{meta.label}</span>
      {count > 0 ? <span className={styles.feedReactCount}>{count}</span> : null}
    </button>
  );
}

// U2 — inline failure feedback for the reaction row. When a toggle reports it
// didn't save (anonymous store gating answers 503, or the network dropped),
// the row shows the claim-a-handle prompt for a few seconds. Same quiet shape
// the standalone CheersButton used: local string state, role="status",
// auto-hidden on a timer, cleared on unmount.
function useCheersGatePrompt(): { gatePrompt: string | null; showGatePrompt: () => void } {
  const [gatePrompt, setGatePrompt] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const showGatePrompt = useCallback(() => {
    setGatePrompt(CHEERS_GATE_PROMPT);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setGatePrompt(null), 4200);
  }, []);
  return { gatePrompt, showGatePrompt };
}


function feedCardClassName(
  hero: string | undefined,
  optimistic: OptimisticSpillState | undefined,
  hasCategory: boolean,
  entered: boolean,
): string {
  return [
    styles.feedCard,
    hero ? styles.feedCardSpill : "",
    hasCategory ? styles.feedCardCat : "",
    optimistic ? styles[`feedCard-${optimistic.state}` as keyof typeof styles] ?? "" : "",
    entered ? styles.feedCardEntered : styles.feedCardEnter,
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
      className={`${styles.feedCardStatus} ${styles[`feedCardStatus-${optimistic.state}` as keyof typeof styles] ?? ""}`}
      role={optimistic.state === "failed" ? "alert" : "status"}
      aria-live={optimistic.state === "failed" ? "assertive" : "polite"}
    >
      <span className={styles.feedCardStatusText}>{optimistic.message}</span>
      {optimistic.state === "uploading" && optimistic.uploadProgress !== null ? (
        <span
          className={styles.feedUploadProgress}
          aria-label={`Photo upload ${optimistic.uploadProgress}% complete`}
        >
          <span style={{ width: `${optimistic.uploadProgress}%` }} />
        </span>
      ) : null}
      {canRetry ? (
        <button
          className={styles.feedRetryPost}
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
  // reaction row consumes it to show the claim-a-handle prompt (see
  // handleReaction below) — a gated tap must never fail silently.
  onToggleReaction: (dropId: string, reaction: ReactionKey) => Promise<boolean | void> | void;
  onRetryPost?: (clientRequestId: string) => void;
}) {
  const hero = item.photoUrls[0];
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
  // U2 — the reaction row's failure feedback (see useCheersGatePrompt above).
  // The page's toggleReaction owns the optimistic flip + rollback; `false`
  // (or a rejection) is its honest signal that the POST failed and the counts
  // were rolled back — the viewer must hear WHY, not see nothing.
  const { gatePrompt, showGatePrompt } = useCheersGatePrompt();
  // Taste fix (feed card slim) — Map/Drop/Pub live behind this single "…"
  // toggle instead of a permanent full-width action bar.
  const [moreOpen, setMoreOpen] = useState(false);
  function handleReaction(reaction: ReactionKey) {
    void Promise.resolve(onToggleReaction(item.id, reaction))
      .then((ok) => (ok === false ? showGatePrompt() : undefined))
      .catch(showGatePrompt);
  }
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
  // A beer figure wears its price BAND (lib/priceBand.ts); a wine or a
  // cocktail is not measured against pint terciles and stays in ink.
  const priceBandFor = (priceGbp: number) =>
    category === "beer" ? priceBand(priceGbp, priceBandAreaForVenue(item.venueId)) : null;
  const catLabel = categoryLabel(category);

  // Honest Last Train stamp (Wave F0 / IDEAS A5): only when the drop carries
  // leave-by + a live decision kind. Never invent "made the last train."
  const trainBadge = lastTrainBadge(
    item.createdAt,
    item.leaveByIso,
    item.lastTrainDecision,
  );

  // "We're out" check-in — a lightweight, area-level presence post (Social Loop
  // v1). It has no photo, price, reactions or bar-tab: it renders its own compact
  // card and returns early. All hooks above have already run, so this branch is
  // rules-of-hooks safe.
  if (item.type === "check_in") {
    return (
      <CheckInCard
        handle={shownHandle}
        avatarUrl={item.avatarUrl}
        areaName={item.areaName ?? null}
        note={item.caption}
        createdAt={item.createdAt}
        ago={ago}
        entered={entered}
      />
    );
  }

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
        <div className={styles.feedSpill}>
          <Image
            className={styles.feedSpillPhoto}
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
            <span className={styles.feedSpillCatEdge} aria-hidden="true" />
          ) : null}
          {/* Provenance badge — top-left, ALWAYS visible on the photo, read like
              a verified checkmark (glyph + label): the X-style provenance
              prominence the brief calls for. */}
          <span
            className={`${styles.feedSpillProv} ${styles[`feedProv-${item.provenance}` as keyof typeof styles] ?? ""}`}
            title={`Source: ${provLabel}`}
            aria-label={`Source: ${provLabel}`}
          >
            <ProvenanceCheck />
            <span className={styles.feedSpillProvLabel}>{provLabel}</span>
          </span>

          {/* Price stamp — top-right, the pressed-ink signature. */}
          {typeof item.priceGbp === "number" ? (
            <PriceBadge
              variant="current"
              className={styles.feedSpillPrice}
              band={priceBandFor(item.priceGbp)}
              style={{ viewTransitionName: `feed-price-${item.id}` }}
            >
              {formatGbp(item.priceGbp)}
            </PriceBadge>
          ) : null}

          {/* Bottom scrim + overlaid content. The scrim is a FIXED dark gradient
              (not theme-mixed) so text legibility is guaranteed over an arbitrary
              photo background in BOTH themes. */}
          <div className={styles.feedSpillScrim}>
            <div className={styles.feedSpillWho}>
              <HandleAvatar
                handle={item.handle}
                avatarUrl={item.avatarUrl}
                className={styles.feedSpillAvatar}
                imageClassName={styles.feedSpillAvatar}
                size={40}
              />
              <div className={styles.feedSpillWhoText}>
                <span className={styles.feedSpillHandle}>{shownHandle}</span>
                {/* Pub identity anchor (taste fix, feed card slim): its own
                    bold line, ahead of the timestamp — the price stamp stays
                    prominent but stops being the only thing that reads at a
                    glance. */}
                <Link
                  className={styles.feedSpillVenueLink}
                  href={item.venueMapUrl}
                  onPointerEnter={() => prefetchVenue(item.venueId)}
                >
                  {item.venueName}
                </Link>
                <span className={styles.feedSpillMeta}>
                  {ago ? <time dateTime={item.createdAt}>{ago}</time> : null}
                  {ago && trainBadge ? " · " : null}
                  {trainBadge ? (
                    <span className={styles.feedTrainBadge} data-tone={trainBadge.tone}>
                      {trainBadge.label}
                    </span>
                  ) : null}
                </span>
              </div>
            </div>
            {/* Drink-category chip — colour + glyph + label (never colour alone,
                WCAG 1.4.1). Only when the category is a confident read; an
                unknown drink shows no fabricated family. */}
            {categoryResolved ? (
              <span className={styles.feedSpillCat} title={`${catLabel} · ${item.drink}`}>
                <DrinkGlyph category={category} size={16} inheritColor />
                <span className={styles.feedSpillCatLabel}>{catLabel}</span>
              </span>
            ) : null}
            {item.caption ? <p className={styles.feedSpillNote}>{item.caption}</p> : null}
            {/* Cheers lives ONCE per card, as the first chip of the reaction
                row below — a second standalone button here duplicated it. */}
            {!isOptimistic ? (
              <Link
                className={styles.feedSpillBarTab}
                href={`/bar-tab/${encodeURIComponent(item.venueId)}`}
              >
                See the bar tab
              </Link>
            ) : null}
          </div>
        </div>
      ) : (
        // Text-only drop: keep the header + typographic "receipt" collectible.
        // Do NOT force 9:16 on a card with no photo.
        <>
          <header className={styles.feedCardHead}>
            <HandleAvatar
              handle={item.handle}
              avatarUrl={item.avatarUrl}
              className={styles.feedAvatar}
              imageClassName={styles.feedAvatar}
              size={40}
            />
            <div className={styles.feedWho}>
              <span className={styles.feedHandle}>{shownHandle}</span>
              {/* Pub identity is the card's anchor (taste fix: it used to only
                  surface in a buried line under the receipt, well below the
                  price). It sits right under the handle, one tap from the map. */}
              <Link
                className={`${styles.feedVenueLink} ${styles.feedVenueLinkHead}`}
                href={item.venueMapUrl}
                onPointerEnter={() => prefetchVenue(item.venueId)}
              >
                {item.venueName}
              </Link>
              <span className={styles.feedMetaLine}>
                {ago ? <time dateTime={item.createdAt}>{ago}</time> : null}
                {trainBadge ? (
                  <span className={styles.feedTrainBadge} data-tone={trainBadge.tone}>
                    {trainBadge.label}
                  </span>
                ) : null}
              </span>
            </div>
            <span className={`${styles.feedProv} ${styles[`feedProv-${item.provenance}` as keyof typeof styles] ?? ""}`}>{provLabel}</span>
          </header>

          <div className={styles.feedReceipt} role="img" aria-label="Pint drop receipt">
            {/* Category glyph, colour-driven — the drink family's mark presiding
                over the receipt. Honest fallback: beer/brass when unresolved. */}
            <span className={styles.feedReceiptGlyph} aria-hidden="true">
              <DrinkGlyph category={category} size={34} />
            </span>
            <span className={styles.feedReceiptEyebrow}>Pint Drop</span>
            {typeof item.priceGbp === "number" ? (
              <PriceBadge variant="current" className={styles.feedReceiptPrice} band={priceBandFor(item.priceGbp)}>
                {formatGbp(item.priceGbp)}
              </PriceBadge>
            ) : (
              <span className={`${styles.feedReceiptPrice} ${styles.feedReceiptPriceMuted}`}>A memory</span>
            )}
            {item.drink ? <span className={styles.feedReceiptDrink}>{item.drink}</span> : null}
            {item.era ? <span className={styles.feedReceiptEra}>{item.era}</span> : null}
          </div>
        </>
      )}

      <div className={styles.feedCardBody}>
        {/* Category chip — the redundant non-colour cue (glyph + label) that
            accompanies the card's accent colour. Text-only card only; the Spill
            card carries its own chip over the scrim. Resolved categories only. */}
        {!hero && categoryResolved ? (
          <span className={styles.feedCatChip} title={`${catLabel} · ${item.drink}`}>
            <DrinkGlyph category={category} size={16} inheritColor />
            <span className={styles.feedCatChipLabel}>{catLabel}</span>
          </span>
        ) : null}
        {item.vibeTags.length > 0 || showChaosBadge ? (
          <ul className={styles.feedVibes} aria-label="Vibe tags">
            {item.vibeTags.map((tag) => (
              <li key={tag} className={styles.feedVibe}>
                {tag}
              </li>
            ))}
            {/* Chaos Score badge (issue #30) — reuses .feedVibe's pill styling
                (no new CSS file needed) so it sits quietly alongside the vibe
                tags rather than as a separate loud widget. Only shown once a
                drop actually clears "Steady" — most single pints won't. */}
            {showChaosBadge ? (
              <li
                className={`${styles.feedVibe} feedChaos`}
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
        {!hero && item.caption ? <p className={styles.feedCaption}>{item.caption}</p> : null}

        {/* Taste fix (feed card slim, 2026-07): the three full-width chrome
            rows (reactions / Map-Drop-Pub + share strip / comments bar) are
            folded into ONE compact row. Nothing is removed — Map/Drop/Pub move
            behind the "…" overflow, share folds to one icon (ShareBar
            `compact`), and the comment count becomes a small tappable pill
            (CommentThread `variant="compact"`) instead of an always-open bar.
            Every action is still one honest tap away. */}
        {!isOptimistic ? (
          <div className={styles.feedActionRow}>
            <div className={styles.feedReactions} role="group" aria-label="React to this pint">
              {REACTION_KEYS.map((key) => (
                <ReactionChip
                  key={key}
                  meta={REACTION_META[key]}
                  on={mine.has(key)}
                  count={summary.counts[key] ?? 0}
                  onClick={() => handleReaction(key)}
                />
              ))}
            </div>

            <span className={styles.feedActionSpacer} aria-hidden="true" />

            <div className={styles.feedMoreWrap}>
              <button
                type="button"
                className={styles.feedActionIconBtn}
                aria-expanded={moreOpen}
                aria-label={moreOpen ? "Hide pub actions" : "More pub actions"}
                title="More"
                onClick={() => setMoreOpen((v) => !v)}
              >
                <MoreGlyph />
              </button>
            </div>

            <Link
              className={`${styles.feedPermalink} ${styles.feedPermalinkIcon}`}
              href={`/p/${item.id}`}
              aria-label="Open pint"
              title="Open pint"
            >
              <OpenGlyph />
            </Link>

            <ShareBar
              compact
              url={`/p/${item.id}`}
              title={`${shownHandle}'s pint at ${item.venueName}`}
              text={`${shownHandle} found a pint at ${item.venueName}${
                typeof item.priceGbp === "number" ? `, ${formatGbp(item.priceGbp)}` : ""
              }. Logged on PUBMAXX.`}
            />

            <CommentThread dropId={item.id} variant="compact" />
          </div>
        ) : null}

        {/* U2 — honest failure feedback for a signed-out / gated reaction tap:
            the toggle rolled back, so say why instead of silently un-ticking. */}
        {gatePrompt ? (
          <p className={cheersStyles.cheersGatePrompt} role="status">
            {gatePrompt}
          </p>
        ) : null}

        {/* Map / Drop / Pub — the second-tier venue actions, reached through
            the row's "…" toggle rather than a permanent full-width bar. */}
        {!isOptimistic && moreOpen ? (
          <PubOverflowActions
            venueId={item.venueId}
            venueMapUrl={item.venueMapUrl}
            onPrefetch={() => prefetchVenue(item.venueId)}
          />
        ) : null}
      </div>
    </article>
  );
}

// "We're out" check-in card (Social Loop v1) — a calm, area-level presence post.
// Deliberately minimal: who is out, WHERE at area level (never a coordinate), an
// optional line, and when. No photo, price, reactions or bar tab — a check-in is
// a signal, not a collectible. Shares the mount-once entrance with the drop card.
function CheckInCard({
  handle,
  avatarUrl,
  areaName,
  note,
  createdAt,
  ago,
  entered,
}: {
  handle: string;
  avatarUrl?: string;
  areaName: string | null;
  note: string;
  createdAt: string;
  ago: string;
  entered: boolean;
}) {
  return (
    <article
      className={`${styles.feedCard} ${styles.feedCheckIn} ${entered ? styles.feedCardEntered : styles.feedCardEnter}`}
      aria-label={areaName ? `${handle} is out in ${areaName}` : `${handle} is out tonight`}
    >
      <div className={styles.feedCheckInBody}>
        <HandleAvatar
          handle={handle}
          avatarUrl={avatarUrl}
          className={`${styles.feedAvatar} ${styles.feedCheckInAvatar}`}
          imageClassName={`${styles.feedAvatar} ${styles.feedCheckInAvatar}`}
          size={40}
        />
        <div className={styles.feedCheckInText}>
          <p className={styles.feedCheckInLine}>
            <span className={styles.feedCheckInHandle}>{handle}</span>
            <span className={styles.feedCheckInVerb}> is out</span>
            {areaName ? <span className={styles.feedCheckInWhere}> in {areaName}</span> : null}
          </p>
          {note ? <p className={styles.feedCheckInNote}>{note}</p> : null}
          <span className={styles.feedCheckInMeta}>
            <span className={styles.feedCheckInTag} aria-hidden="true">I&rsquo;m here</span>
            {ago ? <time dateTime={createdAt}>{ago}</time> : null}
          </span>
        </div>
      </div>
    </article>
  );
}

// Map / Drop / Pub — pulled out of FeedCard (taste fix, feed card slim) so the
// venue-id branching lives here rather than inflating FeedCard's own
// complexity. Only mounted while the "…" toggle is open.
function PubOverflowActions({
  venueId,
  venueMapUrl: mapUrl,
  onPrefetch,
}: {
  venueId: string;
  venueMapUrl: string;
  onPrefetch: () => void;
}) {
  return (
    <nav className={`${styles.feedCardActions} ${styles.feedCardActionsExpanded}`} aria-label="Pub actions">
      <Link className={styles.feedCardAction} href={mapUrl || venueMapUrl(venueId)} onPointerEnter={onPrefetch}>
        Map
      </Link>
      {venueId ? (
        <Link
          className={styles.feedCardAction}
          href={`${venueMapUrl(venueId)}&log=1`}
          onPointerEnter={onPrefetch}
        >
          Drop
        </Link>
      ) : null}
      <Link
        className={styles.feedCardAction}
        href={venueId ? `/bar-tab/${encodeURIComponent(venueId)}` : mapUrl || "/map"}
      >
        Pub
      </Link>
    </nav>
  );
}

// The provenance "verified checkmark" glyph — a small sealed tick that gives a
// Spill's provenance badge the visual weight of an X/Twitter verified mark,
// without borrowing another brand's blue. currentColor so the per-provenance
// colour (see feedProv-* in feed.css) carries.
function ProvenanceCheck() {
  return (
    <svg
      className={styles.feedSpillProvGlyph}
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

// "…" — the single icon that unfolds the second-tier Map / Drop / Pub actions
// (taste fix: feed card slim). Three dots, nothing louder.
function MoreGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
      <circle cx="5" cy="12" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="19" cy="12" r="2" />
    </svg>
  );
}

// Open-the-permalink glyph — a quiet external-link mark standing in for the
// old "Open pint" text link, now icon-only in the slim action row.
function OpenGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
    </svg>
  );
}
