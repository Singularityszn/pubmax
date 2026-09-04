"use client";

import "./wanted.css";

/** Title and lede. They name nobody, so /u/you can paint them before identity answers. */
export function WantedPanelIntro(): React.JSX.Element {
  return (
    <>
      <h2 id="wanted-heading" className="wantedPanel__title">
        Wanted
      </h2>
      <p className="wantedPanel__lede">
        Paste a pub name or a link you saved elsewhere. It becomes a place you can plan
        around. We keep the link so you know where it came from, and we never fetch Instagram or TikTok.
      </p>
    </>
  );
}
