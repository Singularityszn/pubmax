import { Camera, SmilePlus, X } from "lucide-react";

import type { PintDropsState } from "@/components/map/usePintDrops";
import styles from "@/components/map/spillComposer.module.css";

type SpillCameraStepProps = {
  pintPhoto: PintDropsState["pintPhoto"];
  pintInputRef: PintDropsState["pintInputRef"];
  venueInputRef: PintDropsState["venueInputRef"];
  pickPhoto: PintDropsState["pickPhoto"];
  removePhoto: PintDropsState["removePhoto"];
};

// ── Compact photo action (mobile) ─────────────────────────────────────
//   On a phone the shot is immediately available, but the rest of the
//   composer stays visible so a price/story drop is not blocked by camera
//   setup. Desktop renders the classic inline photo pair lower down.
export function SpillCameraStep({
  pintPhoto,
  pintInputRef,
  venueInputRef,
  pickPhoto,
  removePhoto,
}: SpillCameraStepProps) {
  return (
    <div className={styles.spillCameraStep} data-testid="spill-camera-step">
      <div className={styles.spillCameraHeader}>
        <span className={styles.spillStepEyebrow}>Start with the shot</span>
        <span className={styles.spillCameraHint}>9:16 Spill preview</span>
      </div>
      {pintPhoto ? (
        <div className={`${styles.spillCaptureRail} ${styles.hasShot}`}>
          <div className={styles.spillCameraShot}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={pintPhoto.previewUrl}
              alt="Preview of your pint photo"
              decoding="async"
            />
            <span className={styles.spillShotStamp}>Shot ready</span>
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
        <div className={styles.spillCaptureRail}>
          <div className={styles.spillCameraFrame} aria-hidden="true">
            <span className={styles.spillCameraLens}>
              <Camera size={30} />
            </span>
            <span className={styles.spillShotStamp}>Rear camera first</span>
          </div>
          <div className={styles.spillCameraActions}>
          {/* Rear camera first — the pour is the hero. `capture="environment"`
              opens the rear camera on mobile; on desktop it's a file pick. */}
            <label className={`${styles.spillCameraBtn} ${styles.primary}`}>
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
            <label className={styles.spillCameraBtn}>
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
    </div>
  );
}
