import type { Metadata } from "next";

import MomentCapture from "@/components/moment/MomentCapture";

export const metadata: Metadata = {
  title: "Capture a Moment",
  description: "Keep a private PUBMAXX Moment, then decide if it belongs in a Story.",
};

export default function MomentPage(): React.JSX.Element {
  return <MomentCapture />;
}
