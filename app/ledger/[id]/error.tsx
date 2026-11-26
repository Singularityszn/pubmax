"use client";

import SiteNav from "@/components/nav/SiteNav";
import { usePathname } from "next/navigation";
import { useEffect } from "react";

import VenueReadUnavailable from "@/components/venue/VenueReadUnavailable";

import "./ledger.css";

export default function LedgerError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  const pathname = usePathname();

  useEffect(() => {
    console.error("[ledger error boundary]", error);
  }, [error]);

  return (
    <main id="main" className="ledgerPage">
      <SiteNav />
      <div className="ledgerPage--empty">
        <div className="ledgerEmptyCard">
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
      </div>
    </main>
  );
}
