import type { Metadata } from "next";
import PalExperience from "@/components/pal/PalExperience";

export const metadata: Metadata = {
  title: "Meet your Pub Pal",
  description: "Meet, shape and control your private companion for a night out.",
};

export default function PalPage() {
  return <PalExperience />;
}
