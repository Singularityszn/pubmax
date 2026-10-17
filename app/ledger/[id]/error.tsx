"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";

import VenueReadUnavailable from "@/components/venue/VenueReadUnavailable";

import "./ledger.css";

// The Ledger's read-unavailable card. The document is prerendered and held by
// the CDN, so the card may not be rendered INTO it: a held "we could not load
// this pub" would answer every reader for the whole ISR window. The page throws
// instead (./ledgerReadUnavailable.ts), ISR keeps the last good copy or holds
// nothing, and this boundary draws the same card the server page used to. Its
// one way onward is the reader's own address, as a plain anchor, so the retry
// is a fresh document and a fresh server read.
export default function LedgerError({ error }: { error: Error & { digest?: string } }) {
  const pathname = usePathname();

  useEffect(() => {
    console.error("[ledger error boundary]", error);
  }, [error]);

  return (
    <main id="main" className="ledgerPage ledgerPage--empty">
      <div className="ledgerEmptyCard">
        <Link className="ledgerHomeLink" href="/">
          PUBMAXX
        </Link>
        <VenueReadUnavailable
          eyebrow="The Ledger"
          classNames={{
            eyebrow: "ledgerEyebrow",
            title: "ledgerEmptyTitle",
            body: "ledgerEmptyBody",
            action: "ledgerPrimaryLink",
          }}
          href={pathname}
        />
      </div>
    </main>
  );
}
