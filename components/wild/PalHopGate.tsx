"use client";

// The map's one wild mount for Pal hops: it reads the wild switch and nothing
// else, so the phone shell and the desktop toolbar grow by this file and the
// switch leaf alone. The robin (PalHop.tsx, its stylesheet and its arithmetic)
// is a lazy chunk fetched only while the switch is on.

import dynamic from "next/dynamic";

import { useWildMode } from "@/lib/useWildMode";

import type { PalHopProps } from "./PalHop";

const PalHop = dynamic(() => import("./PalHop"), { ssr: false, loading: () => null });

export default function PalHopGate(props: PalHopProps): React.ReactNode {
  return useWildMode() ? <PalHop {...props} /> : null;
}
