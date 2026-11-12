"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { useOptimisticSpillRetry } from "@/components/feed/useOptimisticSpillRetry";
import { OPTIMISTIC_SPILL_EVENT, readOptimisticSpills, type StoredOptimisticSpill } from "@/lib/optimisticSpillPost";
import { normalizeHandle } from "@/lib/profiles";
import { venueMapUrl } from "@/lib/venueMapUrl";

export default function PintDropRecovery({ handle }: { handle: string }) {
  const [entries, setEntries] = useState<StoredOptimisticSpill[]>([]);
  const retry = useOptimisticSpillRetry();

  useEffect(() => {
    const read = () => setEntries(readOptimisticSpills(window.localStorage));
    void Promise.resolve().then(read);
    window.addEventListener(OPTIMISTIC_SPILL_EVENT, read);
    window.addEventListener("storage", read);
    return () => {
      window.removeEventListener(OPTIMISTIC_SPILL_EVENT, read);
      window.removeEventListener("storage", read);
    };
  }, []);

  const unsent = entries.filter((entry) => entry.drop.optimistic
    && normalizeHandle(entry.retry?.handle ?? entry.drop.handle) === normalizeHandle(handle));
  if (!unsent.length) return null;

  return (
    <section className="socialOutbox" aria-label="Unsent Pint Drops">
      <h2>Unsent Pint Drops</h2>
      <ul>
        {unsent.map(({ clientRequestId, drop }) => (
          <li key={clientRequestId} className="socialOutboxItem">
            <Link prefetch={false} href={venueMapUrl(drop.venueId)}>{drop.venueName || "View pub"}</Link>
            <p>{drop.drink}</p>
            <p role="status">{drop.optimistic?.message}</p>
            {drop.optimistic?.state === "failed" ? (
              <Button type="button" variant="secondary" onClick={() => void retry(clientRequestId)}>
                Retry
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
