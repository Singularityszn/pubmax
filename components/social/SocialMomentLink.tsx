import Link from "next/link";

import { momentHref } from "@/components/nav/navigationModel";

/**
 * Social's door to the Moment composer (/moment), for a signed-in reader.
 *
 * The floating create button used to carry "Post a moment" over every page.
 * It left with the five-tab dock (captain, 1 Nov 2026, launch plan decision
 * 13), and a Moment is saved from where people share their nights: here, and
 * on You (components/profile/NightMemoryStudio.tsx). It comes back to Social.
 */
export default function SocialMomentLink() {
  return (
    <Link prefetch={false} href={momentHref("/social")}>
      Save a Moment
    </Link>
  );
}
