"use client";

import { useId } from "react";
import "./wildNightPreviewPicker.css";
import SiteNavMore, { siteNavMoreItems } from "@/components/nav/SiteNavMore";
import { useWildNightPreviewSelection } from "@/lib/useWildNightPreview";
import { writeWildNightPreview, type WildNightPreview } from "@/lib/wildNightPreview";

const choices: ReadonlyArray<{ key: WildNightPreview | null; label: string }> = [
  { key: null, label: "Previews off" },
  { key: "round-rota", label: "Round Rota" },
  { key: "pub-tarot", label: "Pub Tarot" },
  { key: "borough-bingo", label: "Borough Bingo" },
];

export default function WildNightPreviewPicker() {
  const selection = useWildNightPreviewSelection();
  return <SiteNavMore items={[
    ...siteNavMoreItems(),
    ...choices.map(({ key, label }) => ({
      id: `preview-${key ?? "off"}`,
      label,
      description: selection === key ? "Selected on this browser" : "Select this public preview",
      onSelect: () => writeWildNightPreview(key),
    })),
  ]} />;
}

export function MobileWildNightPreviewPicker() {
  const id = useId();
  const selection = useWildNightPreviewSelection();
  return (
    <div className="wildNightPreviewMobile">
      <label htmlFor={id}>Night preview</label>
      <select id={id} value={selection ?? "off"} onChange={(event) => {
        const choice = choices.find((item) => (item.key ?? "off") === event.currentTarget.value);
        if (choice) writeWildNightPreview(choice.key);
      }}>
        {choices.map(({ key, label }) => <option key={key ?? "off"} value={key ?? "off"}>{label}</option>)}
      </select>
    </div>
  );
}
