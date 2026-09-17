import { Camera } from "lucide-react";

import type { Visibility } from "@/lib/spill";
import type { SpillPreviewModel } from "@/lib/spillPreview";
import { VISIBILITY_COPY } from "@/lib/pintDropComposerConfig";
import type { PintDropsState } from "@/components/map/usePintDrops";
import styles from "@/components/map/spillComposer.module.css";

type SpillPreviewCardProps = {
  preview: SpillPreviewModel;
  pintPhoto: PintDropsState["pintPhoto"];
  visibility: Visibility;
};

// ── Instant preview card (PRD priority 2) ──────────────────────────
//   A live, client-only render styled like the final 9:16 feedSpill card
//   — photo (or a candle-lit placeholder), price stamp, provenance
//   badge, and the handle scrim. Provenance is derived exactly as the
//   server derives it, never flattened.
export function SpillPreviewCard({ preview, pintPhoto, visibility }: SpillPreviewCardProps) {
  return (
    <div className={styles.spillPreviewWrap} aria-hidden="true">
      <span className={styles.spillPreviewEyebrow}>Live preview</span>
      <div className={`${styles.spillPreviewCard}${preview.hasPhoto ? " hasPhoto" : ""}`}>
        {preview.hasPhoto && pintPhoto ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            className={styles.spillPreviewPhoto}
            src={pintPhoto.previewUrl}
            alt=""
            decoding="async"
          />
        ) : (
          <div className={styles.spillPreviewPlaceholder}>
            <Camera size={26} />
            <span>Your shot lands here</span>
          </div>
        )}
        <div className={styles.spillPreviewStamps}>
          <span className={`${styles.spillPreviewProv} feedProv-${preview.provenance}`}>
            {preview.provenanceLabel}
          </span>
          <span className={styles.spillPreviewVisibility}>{VISIBILITY_COPY[visibility].label}</span>
        </div>
        {preview.priceLabel ? (
          <span className={styles.spillPreviewPrice}>{preview.priceLabel}</span>
        ) : null}
        <div className={styles.spillPreviewScrim}>
          <div className={styles.spillPreviewWho}>
            <span className={styles.spillPreviewAvatar}>{preview.initial}</span>
            <div className={styles.spillPreviewWhoText}>
              <span className={styles.spillPreviewHandle}>{preview.shownHandle}</span>
              <span className={styles.spillPreviewMeta}>{preview.venueName}</span>
            </div>
          </div>
          {preview.note ? <p className={styles.spillPreviewNote}>{preview.note}</p> : null}
        </div>
      </div>
    </div>
  );
}
