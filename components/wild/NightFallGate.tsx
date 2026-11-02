"use client";

// The root layout's one wild mount. It reads the wild switch (a storage leaf)
// and nothing else, so every route's first-load script grows by this file and
// lib/useWildMode.ts alone. Night falls itself (NightFall.tsx, its stylesheet
// and the night arithmetic) is a lazy chunk fetched only while the switch is on.

import dynamic from "next/dynamic";

import { useWildMode } from "@/lib/useWildMode";

const NightFall = dynamic(() => import("./NightFall"), { ssr: false, loading: () => null });

export default function NightFallGate(): React.ReactNode {
  return useWildMode() ? <NightFall /> : null;
}
