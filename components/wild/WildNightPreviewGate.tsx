"use client";

import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { Suspense, useLayoutEffect } from "react";
import { adoptWildModeFromAddress } from "@/lib/wildMode";
import { adoptWildNightPreviewFromAddress } from "@/lib/wildNightPreview";
import SiteNavMore from "@/components/nav/SiteNavMore";
import { useWildMode } from "@/lib/useWildMode";
import { useWildNightPreviewSelection } from "@/lib/useWildNightPreview";

const MobilePicker = dynamic(() => import("./WildNightPreviewPicker").then((module) => module.MobileWildNightPreviewPicker), { ssr: false, loading: () => null });
const Picker = dynamic(() => import("./WildNightPreviewPicker"), { ssr: false, loading: () => <SiteNavMore /> });

function PreviewAddressObserver() {
  const search = useSearchParams();
  const query = search?.toString();
  useLayoutEffect(() => {
    adoptWildModeFromAddress();
    adoptWildNightPreviewFromAddress();
  }, [query]);
  return null;
}

export default function WildNightPreviewGate() {
  const wild = useWildMode();
  useWildNightPreviewSelection();
  return <>
    <Suspense fallback={null}><PreviewAddressObserver /></Suspense>
    {wild ? <Picker /> : <SiteNavMore />}
  </>;
}

export function MobileWildNightPreviewGate() {
  const wild = useWildMode();
  useWildNightPreviewSelection();
  return <>
    <Suspense fallback={null}><PreviewAddressObserver /></Suspense>
    {wild ? <MobilePicker /> : null}
  </>;
}
