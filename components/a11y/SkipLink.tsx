import { MAIN_LANDMARK_ID } from "@/lib/a11yLandmarks";

import "./skipLink.css";

/** First tab stop: jumps keyboard users past chrome to the page's main landmark. */
export default function SkipLink() {
  return (
    <a href={`#${MAIN_LANDMARK_ID}`} className="skipLink">
      Skip to main content
    </a>
  );
}
