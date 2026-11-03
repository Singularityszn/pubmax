"use client";

import { useId } from "react";
import { useWildNightPreviewSelection } from "@/lib/useWildNightPreview";
import { writeWildNightPreview, type WildNightPreview } from "@/lib/wildNightPreview";
import "./wildNightPreviewPicker.css";

export default function WildNightPreviewPicker() {
  const id = useId();
  const selection = useWildNightPreviewSelection();
  return (
    <details className="wildNightPreview">
      <summary>Night previews</summary>
      <div className="wildNightPreviewPanel">
        <label htmlFor={id}>Choose one preview</label>
        <select id={id} value={selection ?? "off"} onChange={(event) => {
          const value = event.currentTarget.value;
          writeWildNightPreview(value === "off" ? null : value as WildNightPreview);
        }}>
          <option value="off">Off</option>
          <option value="round-rota">Round Rota</option>
          <option value="pub-tarot">Pub Tarot</option>
          <option value="borough-bingo">Borough Bingo</option>
        </select>
        <p>Previews are public. This choice stays on this browser.</p>
      </div>
    </details>
  );
}
