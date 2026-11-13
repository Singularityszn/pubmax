import Link from "next/link";

import SiteNav from "@/components/nav/SiteNav";

import "./barTab.css";

export default function NotInTheTab() {
  return (
    <main id="main" className="barTabPage barTabPage--empty">
      <SiteNav active="feed" />
      <div className="barTabEmptyCard">
        <p className="barTabEyebrow">The Bar Tab</p>
        <h1 className="barTabEmptyTitle">This pub isn&rsquo;t on the tab</h1>
        <p className="barTabEmptyBody">
          It may have moved, or the link is wrong. Every mapped pub still has a home.
        </p>
        <Link prefetch={false} className="barTabPrimaryLink" href="/map">
          Back to the map
        </Link>
      </div>
    </main>
  );
}
