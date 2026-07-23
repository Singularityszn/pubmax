import type { Metadata } from "next";

import WeAreOutClient from "./WeAreOutClient";

// Server shell for /we-are-out so the route carries real metadata (the client
// component can't export it). This is a check-in composer whose posts are
// visible to your lot only, so the page itself is noindex, follow:false.
export const metadata: Metadata = {
  title: "We're out",
  description: "Tell your lot you're out tonight. Pick an area, add a line, post.",
  robots: { index: false, follow: false },
};

export default function WeAreOutPage() {
  return <WeAreOutClient />;
}
