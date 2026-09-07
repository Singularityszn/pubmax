import { Camera, Receipt, SmilePlus, X } from "lucide-react";

import type { PintDropsState } from "@/components/map/usePintDrops";
import { PHOTO_ACCEPT, RECEIPT_REQUIRED_LINE } from "@/lib/pintDropReceipt";

type SpillCameraStepProps = {
  pintPhoto: PintDropsState["pintPhoto"];
  receiptPhoto: PintDropsState["receiptPhoto"];
  pintInputRef: PintDropsState["pintInputRef"];
  venueInputRef: PintDropsState["venueInputRef"];
  receiptInputRef: PintDropsState["receiptInputRef"];
  pickPhoto: PintDropsState["pickPhoto"];
  removePhoto: PintDropsState["removePhoto"];
  /** True while the composer holds a price, so the bill is asked for. */
  priced: boolean;
};

// ── Compact photo action (mobile) ─────────────────────────────────────
//   On a phone the shot is immediately available, but the rest of the
//   composer stays visible so a price/story drop is not blocked by camera
//   setup. Desktop renders the classic inline photo pair lower down.
export function SpillCameraStep({
  pintPhoto,
  receiptPhoto,
  pintInputRef,
  venueInputRef,
  receiptInputRef,
  pickPhoto,
  removePhoto,
  priced,
}: SpillCameraStepProps) {
  return (
    <div className="spillCameraStep" data-testid="spill-camera-step">
      <div className="spillCameraHeader">
        <span className="spillStepEyebrow">Start with the shot</span>
        <span className="spillCameraHint">9:16 Spill preview</span>
      </div>
      {pintPhoto ? (
        <div className="spillCaptureRail hasShot">
          <div className="spillCameraShot">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={pintPhoto.previewUrl}
              alt="Preview of your pint photo"
              decoding="async"
            />
            <span className="spillShotStamp">Shot ready</span>
          </div>
          <button
            type="button"
            className="photoRemove"
            onClick={() => removePhoto("pint")}
            aria-label="Remove pint photo"
          >
            <X size={13} /> Retake
          </button>
        </div>
      ) : (
        <div className="spillCaptureRail">
          <div className="spillCameraFrame" aria-hidden="true">
            <span className="spillCameraLens">
              <Camera size={30} />
            </span>
            <span className="spillShotStamp">Rear camera first</span>
          </div>
          <div className="spillCameraActions">
          {/* Rear camera first — the pour is the hero. `capture="environment"`
              opens the rear camera on mobile; on desktop it's a file pick. */}
            <label className="spillCameraBtn primary">
              <Camera size={22} />
              <span>Snap the pour</span>
              <input
                ref={pintInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                aria-label="Snap the pour: snap or upload a pint photo"
                onChange={(event) =>
                  pickPhoto("pint", event.target.files?.[0], event.target)
                }
              />
            </label>
          {/* Flip to the front camera for a bar selfie. Stored in the venue
              slot so provenance/photo semantics are unchanged. */}
            <label className="spillCameraBtn">
              <SmilePlus size={18} />
              <span>Flip: you at the bar</span>
              <input
                ref={venueInputRef}
                type="file"
                accept="image/*"
                capture="user"
                aria-label="Flip. You at the bar: snap or upload a selfie"
                onChange={(event) =>
                  pickPhoto("venue", event.target.files?.[0], event.target)
                }
              />
            </label>
          </div>
        </div>
      )}
      {/* THE BILL, on the phone, where a drinker is standing with it in hand.
          Its own row under the pour: the pour is the hero, and the bill is the
          one the price cannot go without (captain 7 Sept 2026). */}
      {priced ? (
        <div className="spillReceiptStep">
          {receiptPhoto ? (
            <div className="spillCaptureRail hasShot">
              <div className="spillCameraShot">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={receiptPhoto.previewUrl}
                  alt="Preview of the bill behind your price"
                  decoding="async"
                />
                <span className="spillShotStamp">Bill ready</span>
              </div>
              <button
                type="button"
                className="photoRemove"
                onClick={() => removePhoto("receipt")}
                aria-label="Remove the bill photo"
              >
                <X size={13} /> Retake
              </button>
            </div>
          ) : (
            <>
              <label className="spillCameraBtn primary">
                <Receipt size={22} />
                <span>Snap the bill</span>
                <input
                  ref={receiptInputRef}
                  type="file"
                  accept={PHOTO_ACCEPT}
                  capture="environment"
                  aria-label="Snap the bill: snap or upload a photo of the bill"
                  onChange={(event) =>
                    pickPhoto("receipt", event.target.files?.[0], event.target)
                  }
                />
              </label>
              <p className="spillCaptureWhy">{RECEIPT_REQUIRED_LINE}</p>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
