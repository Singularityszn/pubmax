"use client";
import type { ReactNode } from "react";
import dynamic from "next/dynamic";
import type { RouletteRandom } from "@/lib/pintRoulette";
import { useWildNightPreview } from "@/lib/useWildNightPreview";

const PubTarot = dynamic(() => import("./PubTarot"), { ssr: false, loading: () => <p role="status">Loading Pub Tarot…</p> });

export default function PubTarotGate({ children, cityId, random }: { children: ReactNode; cityId: string; random?: RouletteRandom }) {
  return useWildNightPreview("pub-tarot") ? <PubTarot key={cityId} cityId={cityId} random={random} /> : children;
}
