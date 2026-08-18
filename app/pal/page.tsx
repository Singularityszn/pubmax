import type { Metadata } from "next";
import { partyFace } from "@/app/fonts/partyFace";
import PalExperience from "@/components/pal/PalExperience";
import "./pal.css";

export const metadata: Metadata = {
  title: "Meet your Pub Pal",
  description: "Meet, shape and control your private companion for a night out.",
};

export default function PalPage() {
  // Scope the party accent to this route (display:contents adds no layout box;
  // --font-party inherits to the Pal surfaces). Nothing under /pal reads the
  // token today: the quick-ask vibe chips left the face (app/fonts/partyFace.ts).
  return (
    <div className={partyFace.variable} style={{ display: "contents" }}>
      <PalExperience />
    </div>
  );
}
