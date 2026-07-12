import { permanentRedirect } from "next/navigation";

// /drinks and /discover served byte-identical pages; /discover is the one
// canonical route (owner decision). Permanent (308) so crawlers and bookmarks
// transfer to the canonical URL instead of holding a temporary 307.
export default function DrinksRedirect() {
  permanentRedirect("/discover");
}
