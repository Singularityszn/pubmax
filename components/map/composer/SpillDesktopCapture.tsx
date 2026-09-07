import { ImagePlus, Receipt, SmilePlus, X } from "lucide-react";

import type { PintDropsState } from "@/components/map/usePintDrops";
import { PHOTO_ACCEPT, RECEIPT_REQUIRED_LINE } from "@/lib/pintDropReceipt";

type SpillDesktopCaptureProps = {
  pintPhoto: PintDropsState["pintPhoto"];
  venuePhoto: PintDropsState["venuePhoto"];
  receiptPhoto: PintDropsState["receiptPhoto"];
  pintInputRef: PintDropsState["pintInputRef"];
  venueInputRef: PintDropsState["venueInputRef"];
  receiptInputRef: PintDropsState["receiptInputRef"];
  pickPhoto: PintDropsState["pickPhoto"];
  removePhoto: PintDropsState["removePhoto"];
  /** True while the composer holds a price, so the bill slot says it is owed. */
  priced: boolean;
};

// Desktop photo pair — the classic inline slots. Skipped on mobile,
// where the camera-first step above already owns the photo.
export function SpillDesktopCapture({
  pintPhoto,
  venuePhoto,
  receiptPhoto,
  pintInputRef,
  venueInputRef,
  receiptInputRef,
  pickPhoto,
  removePhoto,
  priced,
}: SpillDesktopCaptureProps) {
  return (
    <div className="photoRow instaPintRow spillDesktopCapture">
      <div className="spillCaptureIntro">
        <span className="spillFieldLabel">Photos</span>
        <span>Shot first, story second</span>
      </div>
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
            <ImagePlus size={18} />
            <span>Your pint</span>
            <small>Snap or upload</small>
            <input
              ref={pintInputRef}
              type="file"
              accept="image/*"
              aria-label="Your pint: Snap or upload"
              onChange={(event) =>
                pickPhoto("pint", event.target.files?.[0], event.target)
              }
            />
          </label>
        )}
      </div>
      {/* THE BILL. First of the three whenever a price is on screen, because it
          is the only one the price cannot go without (captain 7 Sept 2026). */}
      <div className="photoField">
        {receiptPhoto ? (
          <div className="photoPreview">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={receiptPhoto.previewUrl}
              alt="Preview of the bill behind your price"
              width={120}
              height={120}
              decoding="async"
            />
            <button
              type="button"
              className="photoRemove"
              onClick={() => removePhoto("receipt")}
              aria-label="Remove the bill photo"
            >
              <X size={13} /> Remove
            </button>
          </div>
        ) : (
          <label className="photoPick">
            <Receipt size={18} />
            <span>The bill</span>
            <small>{priced ? "Needed for a price" : "Snap or upload"}</small>
            <input
              ref={receiptInputRef}
              type="file"
              accept={PHOTO_ACCEPT}
              aria-label="The bill: snap or upload"
              onChange={(event) =>
                pickPhoto("receipt", event.target.files?.[0], event.target)
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
              alt="Preview of your cheeky selfie at the bar"
              width={120}
              height={120}
              decoding="async"
            />
            <button
              type="button"
              className="photoRemove"
              onClick={() => removePhoto("venue")}
              aria-label="Remove selfie"
            >
              <X size={13} /> Remove
            </button>
          </div>
        ) : (
          <label className="photoPick">
            <SmilePlus size={18} />
            <span>You at the bar</span>
            <small>Cheeky selfie</small>
            <input
              ref={venueInputRef}
              type="file"
              accept="image/*"
              aria-label="You at the bar: Cheeky selfie"
              onChange={(event) =>
                pickPhoto("venue", event.target.files?.[0], event.target)
              }
            />
          </label>
        )}
      </div>
      {priced && !receiptPhoto ? (
        <p className="spillCaptureWhy">{RECEIPT_REQUIRED_LINE}</p>
      ) : null}
    </div>
  );
}
