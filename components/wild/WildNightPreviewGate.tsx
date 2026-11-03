"use client";

import dynamic from "next/dynamic";
import SiteNavMore from "@/components/nav/SiteNavMore";
import { useWildMode } from "@/lib/useWildMode";
import { useWildNightPreviewSelection } from "@/lib/useWildNightPreview";

const MobilePicker = dynamic(() => import("./WildNightPreviewPicker").then((module) => module.MobileWildNightPreviewPicker), { ssr: false, loading: () => null });
const Picker = dynamic(() => import("./WildNightPreviewPicker"), { ssr: false, loading: () => <SiteNavMore /> });

export default function WildNightPreviewGate() {
  const wild = useWildMode();
  useWildNightPreviewSelection();
  return wild ? <Picker /> : <SiteNavMore />;
}

export function MobileWildNightPreviewGate() {
  const wild = useWildMode();
  return wild ? <MobilePicker /> : null;
}
