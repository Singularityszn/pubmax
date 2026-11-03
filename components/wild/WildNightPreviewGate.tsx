"use client";

import dynamic from "next/dynamic";
import { useWildMode } from "@/lib/useWildMode";
import { useWildNightPreviewSelection } from "@/lib/useWildNightPreview";

const Picker = dynamic(() => import("./WildNightPreviewPicker"), { ssr: false, loading: () => null });

export default function WildNightPreviewGate() {
  const wild = useWildMode();
  useWildNightPreviewSelection();
  return wild ? <Picker /> : null;
}
