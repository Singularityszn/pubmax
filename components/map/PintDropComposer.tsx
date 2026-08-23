"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { RefreshCw, Send } from "lucide-react";

import { QUICK_ADD_PRICES_GBP } from "@/lib/spill";
import {
  buildSpillPreview,
  mergePriceChips,
  resolveDestination,
  type SpillDestination,
} from "@/lib/spillPreview";
import { markPubmaxTiming } from "@/lib/performanceMarks";
import type { LastPintDecision } from "@/lib/tfl";
import type { PintDropsState } from "@/components/map/usePintDrops";
import { ComposerFields } from "@/components/map/composer/ComposerFields";
import { SpillCameraStep } from "@/components/map/composer/SpillCameraStep";
import { SpillDesktopCapture } from "@/components/map/composer/SpillDesktopCapture";
import { SpillPreviewCard } from "@/components/map/composer/SpillPreviewCard";
import { useActiveRound } from "@/components/map/composer/useActiveRound";
import { useIsMobileComposer } from "@/components/map/composer/useIsMobileComposer";
import { useSpeechDictation } from "@/components/map/composer/useSpeechDictation";
import { useVenueDraft } from "@/components/map/composer/useVenueDraft";
import { pintDropAuthorValue } from "@/lib/pintDropComposerIdentity";
import "./spillComposer.css";

type PintDropComposerProps = {
  venueId: string;
  state: PintDropsState;
  /** Optional pub name for the preview card scrim; the composer degrades
   *  gracefully to a generic label when the seam doesn't pass one. */
  venueName?: string;
  /** Live Last Pint decision from the Getting-home tab (Wave G1). When a
   *  genuine live kind + leave-by exist, submit stamps them on the Spill. */
  lastTrainDecision?: LastPintDecision | null;
};

export default function PintDropComposer({
  venueId,
  state,
  venueName,
  lastTrainDecision = null,
}: PintDropComposerProps) {
  const {
    handle,
    accountHandle,
    setHandle,
    dropForm,
    setDropForm,
    vibeTags,
    setVibeTags,
    toggleVibeTag,
    visibility,
    setVisibility,
    pintPhoto,
    venuePhoto,
    pintInputRef,
    venueInputRef,
    pickPhoto,
    removePhoto,
    resetComposer,
    submitting,
    dropMsg,
    submitDrop,
    venueSignals,
  } = state;
  const author = pintDropAuthorValue({
    accountHandle,
    draftHandle: handle,
  });

  const maxTagsReached = vibeTags.length >= 4;
  const [transientVoiceNote, setTransientVoiceNote] = useState<{ venueId: string; typedBaseline: string } | null>(null);
  const transientVoiceNoteBaseline = transientVoiceNote?.venueId === venueId ? transientVoiceNote.typedBaseline : null;

  useEffect(() => {
    markPubmaxTiming("pubmax:composer-mounted");
  }, []);

  const draftReady = useVenueDraft({
    venueId,
    resetComposer,
    setDropForm,
    setVisibility,
    setVibeTags,
    dropForm,
    visibility,
    vibeTags,
    transientVoiceNoteBaseline,
  });

  const mobile = useIsMobileComposer();

  const { speechSupported, listening, error: speechError, toggleListening } = useSpeechDictation({
    note: dropForm.note,
    setDropForm,
    onTranscript: (typedBaseline) => setTransientVoiceNote((current) =>
      current?.venueId === venueId ? current : { venueId, typedBaseline }),
  });

  const hasActiveRound = useActiveRound();

  // Price quick-adds: the venue's last-known contributor price leads (fastest
  // one-tap on the pub's real recent price), de-duped against the common points.
  const lastKnownPrice = venueSignals.get(venueId)?.latestContributorPrice ?? null;
  const priceQuickAdds = useMemo(
    () => mergePriceChips(QUICK_ADD_PRICES_GBP, lastKnownPrice),
    [lastKnownPrice],
  );

  // The currently-selected destination chip (derived from visibility so the
  // segmented visibility control and the chips can't disagree). When two chips
  // share a visibility (Family Table + Ledger both → legacy) we keep an explicit
  // selection so the writer's intent survives; a raw visibility change from the
  // segmented control clears the chip highlight.
  const [destination, setDestination] = useState<SpillDestination | null>(null);

  function chooseDestination(key: SpillDestination) {
    const resolved = resolveDestination(key, hasActiveRound);
    if (!resolved.enabled) return; // Disabled chip (e.g. My Round with no Round).
    setDestination(key);
    setVisibility(resolved.visibility);
  }

  // The live preview model — rebuilt on every keystroke, purely (lib/spillPreview).
  const preview = useMemo(
    () =>
      buildSpillPreview({
        handle: author.handle,
        price: dropForm.price,
        note: dropForm.note,
        withWho: dropForm.withWho,
        drink: dropForm.drink,
        era: dropForm.era,
        visibility,
        venueName: venueName ?? "this pub",
        hasPhoto: Boolean(pintPhoto),
      }),
    [
      author.handle,
      dropForm.price,
      dropForm.note,
      dropForm.withWho,
      dropForm.drink,
      dropForm.era,
      visibility,
      venueName,
      pintPhoto,
    ],
  );

  // Mobile still leads with the photo affordance, but price/story controls must
  // be available on first paint so logging a pint never waits behind camera UI.
  const showRest = true;

  if (!draftReady) {
    return (
      <form
        className="dropComposer spillComposer"
        aria-busy="true"
        aria-label="Pint Drop composer"
      >
        <p className="description muted">Loading saved Pint Drop draft...</p>
      </form>
    );
  }

  return (
    <form
      className="dropComposer spillComposer"
      aria-label="Pint Drop composer"
      onSubmit={(event) => {
        void submitDrop(event, venueId, { venueName, lastTrainDecision });
        setTransientVoiceNote(null);
      }}
    >
      <div className="spillComposerIntro">
        <span className="spillComposerEyebrow">Drop a pint here</span>
        <strong>{venueName ?? "This pub"}</strong>
      </div>

      {/* ── Compact photo action (mobile) ─────────────────────────────────────
          On a phone the shot is immediately available, but the rest of the
          composer stays visible so a price/story drop is not blocked by camera
          setup. Desktop renders the classic inline photo pair lower down. */}
      {mobile ? (
        <SpillCameraStep
          pintPhoto={pintPhoto}
          pintInputRef={pintInputRef}
          venueInputRef={venueInputRef}
          pickPhoto={pickPhoto}
          removePhoto={removePhoto}
        />
      ) : null}

      {/* The rest of the composer. On mobile this is visible immediately under
          the compact photo affordance so Drop never feels blocked by camera UI. */}
      {showRest ? (
        <>
          <ComposerFields
            handle={author.handle}
            setHandle={setHandle}
            accountOwned={author.accountOwned}
            dropForm={dropForm}
            setDropForm={setDropForm}
            vibeTags={vibeTags}
            toggleVibeTag={toggleVibeTag}
            maxTagsReached={maxTagsReached}
            visibility={visibility}
            setVisibility={setVisibility}
            hasActiveRound={hasActiveRound}
            destination={destination}
            chooseDestination={chooseDestination}
            setDestination={setDestination}
            priceQuickAdds={priceQuickAdds}
            lastKnownPrice={lastKnownPrice}
            speechSupported={speechSupported}
            listening={listening}
            speechError={speechError}
            toggleListening={toggleListening}
          />

          {/* Desktop photo pair — the classic inline slots. Skipped on mobile,
              where the camera-first step above already owns the photo. */}
          {!mobile ? (
            <SpillDesktopCapture
              pintPhoto={pintPhoto}
              venuePhoto={venuePhoto}
              pintInputRef={pintInputRef}
              venueInputRef={venueInputRef}
              pickPhoto={pickPhoto}
              removePhoto={removePhoto}
            />
          ) : null}

          <SpillPreviewCard preview={preview} pintPhoto={pintPhoto} visibility={visibility} />

          <p className="consentNote">
            Photos and notes are public and may show people. Only upload what you&rsquo;re happy to
            share.
          </p>

          <div className="composerActions">
            <button type="submit" disabled={submitting}>
              <Send size={14} /> {submitting ? "Posting…" : "Post Pint Drop"}
            </button>
            {mobile && (pintPhoto || venuePhoto) ? (
              <button
                type="button"
                className="spillRetakeBtn"
                onClick={() => {
                  if (pintPhoto) removePhoto("pint");
                  if (venuePhoto) removePhoto("venue");
                }}
              >
                <RefreshCw size={13} /> New shot
              </button>
            ) : null}
            {dropMsg ? (
              <span
                role={dropMsg.ok ? "status" : "alert"}
                className={`composerMsg ${dropMsg.ok ? "ok" : "error"}`}
              >
                {dropMsg.text}
                {dropMsg.ok && dropMsg.links && dropMsg.links.length > 0 ? (
                  <span className="composerMsgLinks">
                    {dropMsg.links.map((link) => (
                      <Link key={link.href} href={link.href} className="composerMsgLink">
                        {link.label}
                      </Link>
                    ))}
                  </span>
                ) : null}
              </span>
            ) : null}
          </div>
        </>
      ) : null}
    </form>
  );
}
