import { Receipt, X } from "lucide-react";

import type { PintDropsState } from "@/components/map/usePintDrops";
import {
  PHOTO_ACCEPT,
  RECEIPT_OPTIONAL_LINE,
  RECEIPT_PHOTO_ACTION,
} from "@/lib/pintDropReceipt";

type SpillReceiptStepProps = {
  receiptPhoto: PintDropsState["receiptPhoto"];
  receiptInputRef: PintDropsState["receiptInputRef"];
  pickPhoto: PintDropsState["pickPhoto"];
  removePhoto: PintDropsState["removePhoto"];
};

/**
 * THE BILL, directly under the price it backs.
 *
 * NOT behind the extras disclosure: the pint photo, the selfie, the story and
 * the tags live behind "Add a photo or story", and this is the one photo that
 * is evidence about the FIGURE. Since captain decision 9 (1 Nov 2026) it is
 * OPTIONAL: a price sent without it lands as "not checked" on the pub's sheet
 * and reaches the map through a second drinker. So the step makes its offer in
 * ONE line (`RECEIPT_OPTIONAL_LINE`, lib/pintDropReceipt.ts), never blocks Log
 * it, and never asks twice.
 *
 * Rendered only while the composer holds a price. A note, a memory or a photo
 * of the pub claims nothing a reader has to check, and is offered nothing.
 *
 * Once the bill is in, it prints as a small square beside its name rather than
 * a wide crop. A bill is a tall strip of paper, so a full-width thumbnail is
 * mostly the table it was photographed on, and the price step below it is what
 * the drinker still has to reach.
 */
export function SpillReceiptStep({
  receiptPhoto,
  receiptInputRef,
  pickPhoto,
  removePhoto,
}: SpillReceiptStepProps) {
  if (receiptPhoto) {
    return (
      <div className="spillReceiptStep" data-testid="spill-receipt-step">
        <div className="spillReceiptReady">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={receiptPhoto.previewUrl}
            alt="Preview of the bill behind your price"
            width={56}
            height={56}
            decoding="async"
          />
          {/* "Bill", not RECEIPT_PHOTO_LABEL's "Receipt". The composer asks
              for "a photo of the bill" and its button says "Photo of the
              bill", so the row that answers it says bill too. "Receipt" is
              what the DROP's own row prints later, where it names a photo
              beside the pint and the bar shots. */}
          <span className="spillReceiptReadyName">Bill ready</span>
          <button
            type="button"
            className="spillReceiptRetake"
            onClick={() => removePhoto("receipt")}
            aria-label="Retake the bill photo"
          >
            <X size={14} aria-hidden="true" /> Retake
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="spillReceiptStep" data-testid="spill-receipt-step">
      {/* Not `primary` any more: Log it is the one primary on this form, and
          an optional photo may not look like the thing the form is for. */}
      <label className="spillCameraBtn">
        <Receipt size={20} />
        <span>{RECEIPT_PHOTO_ACTION}</span>
        {/* `capture` names the rear camera where there is one and is ignored on
            a desktop, so one input serves the camera and the library both. */}
        <input
          ref={receiptInputRef}
          type="file"
          accept={PHOTO_ACCEPT}
          capture="environment"
          aria-label="The bill: snap or upload a photo of the bill"
          onChange={(event) => pickPhoto("receipt", event.target.files?.[0], event.target)}
        />
      </label>
      <p className="spillCaptureWhy">{RECEIPT_OPTIONAL_LINE}</p>
    </div>
  );
}
