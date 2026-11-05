"use client";

// The moderator's queue of bills that do not show their price
// (/api/admin/bill-checks, captain 5 Nov 2026), its own file for the reason
// VenueSubmissionModeration is: one lane, one file. The parent owns the admin
// session; this component owns the list and the two decisions.
//
// A row is a bill the bill check read and found no line holding the submitted
// price. The price is already on the pub's sheet as "not checked", so nothing
// here is urgent. "Keep price" leaves it as it is; "Hide price" hides it
// through its own lane's moderator door. Neither deletes anything.

import Image from "next/image";
import { useState } from "react";

import { adminAlert, adminStatus, type AdminNotice } from "@/lib/adminNotice";
import { BILL_MISMATCH_QUEUE_TITLE, type ModeratorBillCheck } from "@/lib/billCheck";
import type { AdminRequest } from "./VenueSubmissionModeration";

type Decision = "kept" | "hidden";

function gbp(value: number): string {
  return `£${value.toFixed(2)}`;
}

export default function BillCheckModeration({ request }: { request: AdminRequest }) {
  const [rows, setRows] = useState<ModeratorBillCheck[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<AdminNotice | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setNotice(null);
    try {
      const res = await request("/api/admin/bill-checks");
      if (!res) {
        setNotice(adminAlert("Not authorised. Check the admin token."));
        return;
      }
      if (!res.ok) {
        setNotice(adminAlert("Could not load bill checks."));
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { checks?: ModeratorBillCheck[] };
      setRows(Array.isArray(body.checks) ? body.checks : []);
      setLoaded(true);
    } catch {
      setNotice(adminAlert("Could not reach the server."));
    } finally {
      setLoading(false);
    }
  }

  async function decide(row: ModeratorBillCheck, decision: Decision) {
    setPendingId(row.id);
    setNotice(null);
    try {
      const res = await request("/api/admin/bill-checks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: row.id, decision }),
      });
      if (!res) {
        setNotice(adminAlert("Not authorised. Check the admin token."));
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setNotice(adminAlert(body.error || "Action failed. Try again."));
        return;
      }
      setRows((current) => current.filter((candidate) => candidate.id !== row.id));
      setNotice(
        adminStatus(
          `${row.venueName}: ${decision === "hidden" ? "price hidden" : "price kept"}.`,
        ),
      );
    } catch {
      setNotice(adminAlert("Could not reach the server."));
    } finally {
      setPendingId(null);
    }
  }

  return (
    <section aria-labelledby="admin-bill-checks">
      <h2 id="admin-bill-checks" className="admin-section">{BILL_MISMATCH_QUEUE_TITLE}</h2>
      <p className="admin-sub">
        We read each bill that comes with a price. These bills show other prices. Each price stays
        on its pub&apos;s sheet as not checked until you decide. Nothing here is deleted.
      </p>
      <div className="admin-bar">
        <button type="button" className="admin-btn" onClick={() => void load()} disabled={loading}>
          {loading ? "Loading…" : "Load bills"}
        </button>
      </div>
      {notice ? (
        <div className="admin-msg" role={notice.tone}>
          {notice.text}
        </div>
      ) : null}
      {loaded && !loading && rows.length === 0 ? <p className="admin-empty">No bills to check.</p> : null}
      <div className="admin-list">
        {rows.map((row) => (
          <article key={row.id} className="admin-card" data-testid="admin-bill-check">
            <div className="admin-card-head">
              <span className="admin-venue-name">{row.venueName}</span>
              <span className="admin-meta">{new Date(row.checkedAt).toLocaleString("en-GB")}</span>
            </div>
            <p className="admin-meta">
              <span>
                Sent: <strong className="admin-bill-sent">{gbp(row.priceGbp)}</strong>
              </span>
              {row.drop ? <span>@{row.drop.handle}</span> : null}
              {row.drop ? <span>{row.drop.drink}</span> : null}
              {row.drop && row.drop.status !== "visible" ? <span>{row.drop.status}</span> : null}
              {row.communityPriceId && !row.pintDropId ? <span>Community price</span> : null}
            </p>
            <div className="admin-bill-read">
              <p className="admin-bill-lines-title">The bill shows</p>
              <ul className="admin-bill-lines">
                {row.lines.map((line, index) => (
                  <li key={`${line.name}-${index}`}>
                    <span>{line.name}</span>
                    <span>{gbp(line.priceGbp)}</span>
                  </li>
                ))}
              </ul>
              {row.drop?.receiptPhotoUrl ? (
                <a
                  className="admin-bill-photo"
                  href={row.drop.receiptPhotoUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Image
                    src={row.drop.receiptPhotoUrl}
                    alt={`Bill sent by ${row.drop.handle}`}
                    width={160}
                    height={220}
                    unoptimized
                  />
                </a>
              ) : null}
            </div>
            <div className="admin-actions">
              <button
                type="button"
                className="admin-btn"
                disabled={pendingId === row.id}
                onClick={() => void decide(row, "kept")}
              >
                Keep price
              </button>
              <button
                type="button"
                className="admin-btn admin-keep"
                disabled={pendingId === row.id}
                onClick={() => void decide(row, "hidden")}
              >
                Hide price
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
