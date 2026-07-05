"use client";

import { ImagePlus, Send, X } from "lucide-react";

import { VIBE_TAGS } from "@/lib/pintDrops";
import type { PintDropsState } from "@/components/map/usePintDrops";

type PintDropComposerProps = {
  venueId: string;
  state: PintDropsState;
};

export default function PintDropComposer({ venueId, state }: PintDropComposerProps) {
  const {
    handle,
    setHandle,
    dropForm,
    setDropForm,
    vibeTags,
    toggleVibeTag,
    pintPhoto,
    venuePhoto,
    pintInputRef,
    venueInputRef,
    pickPhoto,
    removePhoto,
    submitting,
    dropMsg,
    submitDrop,
  } = state;

  const maxTagsReached = vibeTags.length >= 4;

  return (
    <form className="dropComposer" onSubmit={(event) => submitDrop(event, venueId)}>
      <input
        value={handle}
        onChange={(event) => setHandle(event.target.value)}
        placeholder="Your handle (e.g. @thirsty_ted)"
        aria-label="Contributor handle"
        required
      />
      <div className="composerRow">
        <input
          value={dropForm.price}
          onChange={(event) => setDropForm({ ...dropForm, price: event.target.value })}
          placeholder="What did it cost? £"
          inputMode="decimal"
          aria-label="What did the pint cost, in pounds"
        />
        <input
          value={dropForm.drink}
          onChange={(event) => setDropForm({ ...dropForm, drink: event.target.value })}
          placeholder="Drink"
          aria-label="Drink name"
        />
      </div>
      <textarea
        value={dropForm.note}
        onChange={(event) => setDropForm({ ...dropForm, note: event.target.value })}
        placeholder="What happened? Who were you with?"
        aria-label="What happened, and who were you with"
      />
      <input
        value={dropForm.era}
        onChange={(event) => setDropForm({ ...dropForm, era: event.target.value })}
        placeholder="An old memory, or tonight?"
        aria-label="An old memory, or tonight"
      />

      <fieldset className="vibeTagField">
        <legend>The vibe</legend>
        <div className="vibeTagRow" role="group" aria-label="Vibe tags — choose up to 4">
          {VIBE_TAGS.map((tag) => {
            const selected = vibeTags.includes(tag);
            return (
              <button
                key={tag}
                type="button"
                className={selected ? "vibeChip selected" : "vibeChip"}
                aria-pressed={selected}
                disabled={!selected && maxTagsReached}
                onClick={() => toggleVibeTag(tag)}
              >
                {tag}
              </button>
            );
          })}
        </div>
      </fieldset>

      <div className="photoRow">
        <div className="photoField">
          {pintPhoto ? (
            <div className="photoPreview">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={pintPhoto.previewUrl}
                alt="Preview of your pint photo"
                width={120}
                height={120}
                decoding="async"
              />
              <button
                type="button"
                className="photoRemove"
                onClick={() => removePhoto("pint")}
                aria-label="Remove pint photo"
              >
                <X size={13} /> Remove
              </button>
            </div>
          ) : (
            <label className="photoPick">
              <ImagePlus size={16} />
              <span>Your pint</span>
              <input
                ref={pintInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                capture="environment"
                onChange={(event) =>
                  pickPhoto("pint", event.target.files?.[0], event.target)
                }
              />
            </label>
          )}
        </div>
        <div className="photoField">
          {venuePhoto ? (
            <div className="photoPreview">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={venuePhoto.previewUrl}
                alt="Preview of your pub photo"
                width={120}
                height={120}
                decoding="async"
              />
              <button
                type="button"
                className="photoRemove"
                onClick={() => removePhoto("venue")}
                aria-label="Remove pub photo"
              >
                <X size={13} /> Remove
              </button>
            </div>
          ) : (
            <label className="photoPick">
              <ImagePlus size={16} />
              <span>The pub</span>
              <input
                ref={venueInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                capture="environment"
                onChange={(event) =>
                  pickPhoto("venue", event.target.files?.[0], event.target)
                }
              />
            </label>
          )}
        </div>
      </div>

      <p className="consentNote">
        Photos and notes are public and may show people. Only upload what you&rsquo;re happy to
        share.
      </p>

      <div className="composerActions">
        <button type="submit" disabled={submitting}>
          <Send size={14} /> {submitting ? "Posting…" : "Post Pint Drop"}
        </button>
        {dropMsg ? (
          <span
            role={dropMsg.ok ? "status" : "alert"}
            className={`composerMsg ${dropMsg.ok ? "ok" : "error"}`}
          >
            {dropMsg.text}
          </span>
        ) : null}
      </div>
    </form>
  );
}
