"use client";

import { useCallback, useState } from "react";

import type { AdminSessionSubmitOutcome } from "@/lib/adminSessionClient";
import { adminAlert, adminStatus, type AdminNotice } from "@/lib/adminNotice";
import type { AreaDemandSummary } from "@/lib/areaDemand";
import { discardBody } from "@/lib/responseBody";

const SESSION_FETCH: RequestInit = { credentials: "include" };
const DEMAND_URL = "/api/admin/area-demand?sinceDays=90&limit=50";
const DATE_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

type CoverageDemandResponse = {
  summary?: AreaDemandSummary[];
  partial?: boolean;
  sinceDays?: number;
  status?: "ready" | "degraded";
};

type CoverageDemandQueueProps = {
  ensureAdminSession: (force?: boolean) => Promise<AdminSessionSubmitOutcome>;
  retryWithFreshSession: (
    request: () => Promise<Response>,
  ) => Promise<Response>;
};

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? DATE_FORMATTER.format(date)
    : "Date unavailable";
}

function sourceLine(row: AreaDemandSummary): string {
  const labels = [
    ["Map miss", row.sourceCounts["map-miss"]],
    ["Near empty", row.sourceCounts["near-empty"]],
    ["Area picker", row.sourceCounts["area-picker"]],
  ] as const;
  return labels
    .filter(([, count]) => count > 0)
    .map(([label, count]) => `${label} ${count}`)
    .join(" · ");
}

export default function CoverageDemandQueue({
  ensureAdminSession,
  retryWithFreshSession,
}: CoverageDemandQueueProps) {
  const [loading, setLoading] = useState(false);
  const [hasCompleteEmptyResult, setHasCompleteEmptyResult] = useState(false);
  const [rows, setRows] = useState<AreaDemandSummary[]>([]);
  const [sinceDays, setSinceDays] = useState(90);
  const [notice, setNotice] = useState<AdminNotice | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setHasCompleteEmptyResult(false);
    setNotice(null);
    try {
      const session = await ensureAdminSession();
      if (session.status !== "open") {
        setRows([]);
        setNotice(adminAlert(session.message));
        return;
      }
      const response = await retryWithFreshSession(() =>
        fetch(DEMAND_URL, SESSION_FETCH),
      );
      if (response.status === 403) {
        discardBody(response);
        setRows([]);
        setNotice(adminAlert("Not authorised. Check the admin token."));
        return;
      }
      if (!response.ok) {
        discardBody(response);
        setNotice(adminAlert("Could not load coverage demand. Try again."));
        return;
      }

      const body = (await response.json()) as CoverageDemandResponse;
      if (body.status !== "ready" || !Array.isArray(body.summary)) {
        setNotice(adminAlert("Coverage history is incomplete. Try again."));
        return;
      }
      const responseSinceDays = body.sinceDays;
      setRows(body.summary);
      setSinceDays(
        typeof responseSinceDays === "number" &&
          Number.isFinite(responseSinceDays) &&
          responseSinceDays > 0
          ? Math.floor(responseSinceDays)
          : 90,
      );
      setHasCompleteEmptyResult(
        body.partial !== true && body.summary.length === 0,
      );
      setNotice(
        body.partial === true
          ? adminStatus("Showing recent signals only. Counts can be higher.")
          : null,
      );
    } catch {
      setNotice(adminAlert("Could not load coverage demand. Try again."));
    } finally {
      setLoading(false);
    }
  }, [ensureAdminSession, retryWithFreshSession]);

  return (
    <section aria-labelledby="coverage-demand-title">
      <h2
        id="coverage-demand-title"
        className="admin-section"
        style={{ marginTop: 0, borderTop: "none", paddingTop: 0 }}
      >
        Coverage demand
      </h2>
      <div className="admin-bar">
        <button
          type="button"
          className="admin-btn"
          onClick={() => void load()}
          disabled={loading}
        >
          {loading ? "Loading…" : "Load demand"}
        </button>
      </div>

      {notice ? (
        <div className="admin-msg" role={notice.tone}>
          {notice.text}
        </div>
      ) : null}

      {hasCompleteEmptyResult ? (
        <div className="admin-empty" role="status">
          <strong>No demand in the last {sinceDays} days</strong>
        </div>
      ) : null}

      {rows.length > 0 ? (
        <div className="admin-list">
          {rows.map((row) => (
            <article
              className="admin-card"
              key={`${row.areaKey}:${row.matchedPatchId ?? "unmatched"}`}
            >
              <div className="admin-card-head">
                <h3 className="admin-handle">{row.area}</h3>
                <strong>
                  {row.signalCount}{" "}
                  {row.signalCount === 1 ? "signal" : "signals"}
                </strong>
              </div>
              <p className="admin-note">{sourceLine(row)}</p>
              <div className="admin-meta">
                <span>
                  {row.matchedPatchId
                    ? `Matched patch: ${row.matchedPatchId}`
                    : "No matched patch"}
                </span>
                <span>
                  First: <time dateTime={row.firstSeen}>{formatDate(row.firstSeen)}</time>
                </span>
                <span>
                  Latest: <time dateTime={row.lastSeen}>{formatDate(row.lastSeen)}</time>
                </span>
              </div>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}
