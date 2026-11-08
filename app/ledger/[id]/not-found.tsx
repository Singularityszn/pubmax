import Link from "next/link";

import "./ledger.css";

export default function NotInTheLedger() {
  return (
    <main id="main" className="ledgerPage ledgerPage--empty">
      <div className="ledgerEmptyCard">
        <Link className="ledgerHomeLink" href="/">
          PUBMAXX
        </Link>
        <p className="ledgerEyebrow">The Ledger</p>
        <h1 className="ledgerEmptyTitle">This pub isn&rsquo;t in the ledger</h1>
        <p className="ledgerEmptyBody">
          It may have moved, or the link is wrong. Every mapped pub still has a home.
        </p>
        <Link prefetch={false} className="ledgerPrimaryLink" href="/map">
          Back to the map
        </Link>
      </div>
    </main>
  );
}
