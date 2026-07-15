import type { Metadata } from "next";
import { Suspense } from "react";

import MomentCapture from "@/components/moment/MomentCapture";

export const metadata: Metadata = {
  title: "Capture a Moment",
  description: "Keep a private PUBMAXX Moment, then decide if it belongs in a Story.",
};

export default function MomentPage(): React.JSX.Element {
  return (
    <Suspense fallback={<main aria-busy="true" aria-label="Loading Moment composer" />}>
      <MomentCapture />
    </Suspense>
  );
}
