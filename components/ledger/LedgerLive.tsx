"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import ReadLedgerButton from "@/components/ledger/ReadLedgerButton";
import PriceBadge from "@/components/PriceBadge";
import ShareWithFamilyButton from "@/components/ledger/ShareWithFamilyButton";
import type { VenueClaim } from "@/lib/curation";
import type { FamilyTableEntry, LedgerEntry, RedactedFamilyEntry } from "@/lib/ledger";

// THE LEDGER'S LIVE HALF, drawn after load (task vercel-f2-seo-cdn, option a).
// The /ledger/[id] document is prerendered and held by the CDN, so it carries
// the pub's bundled facts and the curated story line, and nothing a drinker
// wrote. This provider reads the rest from GET /api/ledger/[id], per request
// and never cached, sending the session's own bearer token so the viewer's OWN
// Family Table rows come back in full. A browser navigation never sent that
// header, so the document was always the redacted copy; this is the first time
// an author actually reads their own legacy note on the page.

type LedgerLog = {
  claims: VenueClaim[];
  entries: LedgerEntry[];
  familyEntries: Array<FamilyTableEntry | RedactedFamilyEntry>;
};

type LedgerLiveState =
  | { status: "loading" }
  | { status: "ready"; log: LedgerLog }
  | { status: "unavailable" };

/** An answer, and the session token it was read for. */
type LedgerRead =
  | { status: "loading" }
  | { status: "ready"; log: LedgerLog; token: string | null }
  | { status: "unavailable"; token: string | null };

type LedgerLiveValue = { state: LedgerLiveState; reload: () => void };

const LedgerLiveContext = createContext<LedgerLiveValue>({
  state: { status: "loading" },
  reload: () => {},
});

/** The dev/test ?viewer= fallback, forwarded so local QA keeps working. The
 *  route ignores it in production (lib/pintDropViewer.ts). */
function viewerQuery(): string {
  if (typeof window === "undefined") return "";
  const viewer = new URLSearchParams(window.location.search).get("viewer");
  return viewer ? `?viewer=${encodeURIComponent(viewer)}` : "";
}

export function LedgerLiveProvider({
  venueId,
  children,
}: {
  venueId: string;
  children: ReactNode;
}) {
  const { session, loading } = useAuth();
  const accessToken = session?.access_token ?? null;
  const [read, setRead] = useState<LedgerRead>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    // Wait for the first session read, so a signed-in reader asks once, with
    // their token, rather than once anonymously and again after.
    if (loading) return;
    let cancelled = false;
    const headers: Record<string, string> = {};
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    fetch(`/api/ledger/${encodeURIComponent(venueId)}${viewerQuery()}`, { headers })
      .then(async (res) => {
        if (!res.ok) throw new Error(`ledger read ${res.status}`);
        return (await res.json()) as LedgerLog;
      })
      .then((log) => {
        if (!cancelled) setRead({ status: "ready", log, token: accessToken });
      })
      .catch(() => {
        if (!cancelled) setRead({ status: "unavailable", token: accessToken });
      });
    return () => {
      cancelled = true;
    };
  }, [venueId, accessToken, loading, attempt]);

  const reload = useCallback(() => {
    setRead({ status: "loading" });
    setAttempt((n) => n + 1);
  }, []);

  // An answer read for another session is never drawn. A ready answer holds
  // its reader's OWN unredacted Family Table rows, so when the session changes
  // on this page (sign-out, account switch) they leave the screen in the same
  // render, not when the next read lands; a slow or hung read would otherwise
  // show them to whoever now holds the device.
  const state: LedgerLiveState =
    read.status === "loading" || read.token !== accessToken
      ? { status: "loading" }
      : read.status === "ready"
        ? { status: "ready", log: read.log }
        : { status: "unavailable" };

  return (
    <LedgerLiveContext.Provider value={{ state, reload }}>{children}</LedgerLiveContext.Provider>
  );
}

function useLedgerLive(): LedgerLiveValue {
  return useContext(LedgerLiveContext);
}

/** "Read this page": the pub's own lines, then the newest few logbook entries
 *  once they have arrived, kept short for a screen reader / TTS pass. */
export function LedgerReadAloud({ intro }: { intro: string[] }) {
  const { state } = useLedgerLive();
  const entries = state.status === "ready" ? state.log.entries : [];
  const text = [
    ...intro,
    ...entries
      .slice(0, 5)
      .map((entry) => (entry.dateLabel ? `${entry.dateLabel}: ${entry.note}` : entry.note)),
  ]
    .filter(Boolean)
    .join(" ");
  return <ReadLedgerButton text={text} />;
}

function isFullFamilyEntry(
  entry: FamilyTableEntry | RedactedFamilyEntry,
): entry is FamilyTableEntry {
  return "note" in entry;
}

function ClaimList({ claims }: { claims: VenueClaim[] }) {
  if (claims.length === 0) return null;
  return (
    <section className="ledgerSection" aria-labelledby="ledgerClaimsHeading">
      <h2 id="ledgerClaimsHeading" className="ledgerSectionTitle">
        The pub&rsquo;s story
      </h2>
      <ul className="ledgerClaimList">
        {claims.map((claim, index) => (
          <li className="ledgerClaim" key={`${claim.kind}-${index}`}>
            <span className={`ledgerProvenance ledgerProvenance--${claim.kind}`}>
              {claim.label}
            </span>
            <p className="ledgerClaimBody">
              {claim.content}
              {claim.era ? <span className="ledgerClaimEra"> · {claim.era}</span> : null}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function LiveStatus({ state, reload }: LedgerLiveValue) {
  if (state.status === "unavailable") {
    return (
      <p className="ledgerEmptyEntries" role="status">
        The logbook did not answer just now.{" "}
        <button type="button" className="ledgerMapLink" onClick={reload}>
          Try again
        </button>
      </p>
    );
  }
  return (
    <p className="ledgerEmptyEntries" role="status">
      Opening the logbook.
    </p>
  );
}

/**
 * The story, the logbook and the Family Table. `curatedClaims` is the story the
 * bundled dataset tells (the document's own copy, so a crawler and a reader
 * with no script still get it); once the live read lands, its list (the same
 * curated line first, then every drop-derived line) takes its place.
 */
export function LedgerLogSections({
  venueName,
  ledgerUrl,
  curatedClaims,
}: {
  venueName: string;
  ledgerUrl: string;
  curatedClaims: VenueClaim[];
}) {
  const live = useLedgerLive();
  const { state } = live;
  const claims = state.status === "ready" ? state.log.claims : curatedClaims;

  return (
    <>
      <ClaimList claims={claims} />

      <section className="ledgerSection" aria-labelledby="ledgerEntriesHeading">
        <h2 id="ledgerEntriesHeading" className="ledgerSectionTitle">
          Logbook
        </h2>
        {state.status !== "ready" ? (
          <LiveStatus {...live} />
        ) : state.log.entries.length === 0 ? (
          <p className="ledgerEmptyEntries">
            No entries logged yet. The first Pint Drop here will open the logbook.
          </p>
        ) : (
          <ol className="ledgerEntries" aria-label={`Logbook entries for ${venueName}`}>
            {state.log.entries.map((entry) => (
              <li className="ledgerEntry" key={entry.id}>
                <article aria-label={`Logbook entry, ${entry.dateLabel || "undated"}`}>
                  <div className="ledgerEntryMeta">
                    {entry.dateLabel ? (
                      <time className="ledgerEntryDate" dateTime={entry.createdAt}>
                        {entry.dateLabel}
                      </time>
                    ) : (
                      <span className="ledgerEntryDate">Undated</span>
                    )}
                    <span className={`ledgerProvenance ledgerProvenance--${entry.provenance}`}>
                      {entry.provenance === "demo" ? "Demo" : entry.handle}
                    </span>
                  </div>
                  <p className="ledgerEntryNote">{entry.note}</p>
                  {entry.priceLabel ? (
                    <p className="ledgerEntryPrice">
                      <span className="ledgerEntryPriceLabel">Paid</span>{" "}
                      <PriceBadge className="ledgerEntryPriceValue">{entry.priceLabel}</PriceBadge>
                    </p>
                  ) : null}
                </article>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="ledgerSection ledgerFamilySection" aria-labelledby="ledgerFamilyHeading">
        <div className="ledgerFamilyHead">
          <h2 id="ledgerFamilyHeading" className="ledgerSectionTitle">
            The Family Table
          </h2>
          <ShareWithFamilyButton venueName={venueName} url={ledgerUrl} />
        </div>
        <p className="ledgerFamilyIntro">
          Some stories aren&rsquo;t for the feed. Kept here for whoever in the family reads them next.
        </p>
        {state.status !== "ready" ? null : state.log.familyEntries.length === 0 ? (
          <p className="ledgerFamilyEmpty">
            Some stories are kept for the family table. Log a pint and choose Legacy to leave one.
          </p>
        ) : (
          <ol className="ledgerFamilyEntries" aria-label={`Family table entries for ${venueName}`}>
            {state.log.familyEntries.map((entry) => (
              <li className="ledgerFamilyEntry" key={entry.id}>
                <article aria-label={`Family table entry, ${entry.dateLabel || "undated"}`}>
                  <div className="ledgerFamilyEntryMeta">
                    {entry.dateLabel ? (
                      <time className="ledgerFamilyEntryDate" dateTime={entry.createdAt}>
                        {entry.dateLabel}
                      </time>
                    ) : (
                      <span className="ledgerFamilyEntryDate">Undated</span>
                    )}
                    <span className="ledgerFamilyEntryHandle">
                      {entry.handle}
                      {entry.era ? <span className="ledgerClaimEra"> · {entry.era}</span> : null}
                    </span>
                  </div>
                  {isFullFamilyEntry(entry) ? (
                    <>
                      <p className="ledgerFamilyEntryNote">{entry.note}</p>
                      {entry.priceLabel ? (
                        <p className="ledgerEntryPrice">
                          <span className="ledgerEntryPriceLabel">Paid</span>{" "}
                          <PriceBadge className="ledgerEntryPriceValue">{entry.priceLabel}</PriceBadge>
                        </p>
                      ) : null}
                    </>
                  ) : (
                    <p className="ledgerFamilyEntryNote">A story kept for the family table.</p>
                  )}
                </article>
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );
}
