"use client";

// The Sun Chaser chip, inside the map's pub feature controls on both widths.
// It holds no sun maths: the slider, the status line and the map layer load
// only once the chip is on (SunChaserPanel.tsx, components/PubMap.tsx).

import dynamic from "next/dynamic";
import { setSunChaserEnabled, useSunChaserEnabled } from "./sunChaserStore";

const SunChaserPanel = dynamic(() => import("./SunChaserPanel"), { ssr: false });

export default function SunChaserControls() {
  const enabled = useSunChaserEnabled();
  return (
    <div className="sunChaserControls">
      <button
        type="button"
        className="sunChaserChip"
        aria-pressed={enabled}
        onClick={() => setSunChaserEnabled(!enabled)}
      >
        <span aria-hidden="true" className="sunChaserChipDot" />
        Sun Chaser
      </button>
      {enabled ? <SunChaserPanel /> : null}
    </div>
  );
}
