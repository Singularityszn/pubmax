"use client";

import { ImagePlus, Send, X } from "lucide-react";

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
          placeholder="Price £"
          inputMode="decimal"
          aria-label="Pint price in pounds"
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
        placeholder="Passed-down note — a memory, a story, why this pub matters…"
        aria-label="Passed-down note"
      />
      <input
        value={dropForm.era}
        onChange={(event) => setDropForm({ ...dropForm, era: event.target.value })}
        placeholder="Era (e.g. 1970s, my childhood)"
        aria-label="Era this memory belongs to"
      />

      <div className="photoRow">
        <div className="photoField">
          {pintPhoto ? (
            <div className="photoPreview">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={pintPhoto.previewUrl} alt="Preview of your pint photo" />
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
              <img src={venuePhoto.previewUrl} alt="Preview of your pub photo" />
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
