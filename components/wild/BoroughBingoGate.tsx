"use client";

import dynamic from "next/dynamic";
import { useWildNightPreview } from "@/lib/useWildNightPreview";
import type { BeenVenue } from "@/lib/profilePassport";

const BoroughBingo = dynamic(() => import("./BoroughBingo"), { ssr: false, loading: () => null });

export default function BoroughBingoGate({ been }: { been: readonly BeenVenue[] }) {
  return useWildNightPreview("borough-bingo") ? <BoroughBingo been={been} /> : null;
}
