import type { Metadata } from "next";

import WallClient from "./WallClient";

export const metadata: Metadata = {
  title: "Drink Wall · PUBMAXXING",
  description: "Pints, pub fronts and London views from drinkers on PubMaxxing.",
  alternates: { canonical: "/wall" },
};

export default function WallPage() {
  return <WallClient />;
}
