"use client";

// The pub sheet's slot for Sun Chaser. It reads only on or off, so the sheet
// carries no sun maths until the chip is on (SunChaserVenueLineBody.tsx).

import dynamic from "next/dynamic";
import { useSunChaserEnabled } from "./sunChaserStore";
import "./sunChaser.css";

const SunChaserVenueLineBody = dynamic(() => import("./SunChaserVenueLineBody"), { ssr: false });

export default function SunChaserVenueLine({ venueId }: { venueId: string }) {
  return useSunChaserEnabled() ? <SunChaserVenueLineBody venueId={venueId} /> : null;
}
