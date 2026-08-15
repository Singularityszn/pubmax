"use client";

import { useCallback, useState } from "react";

import { discardBody } from "@/lib/responseBody";
import type { AreaDemandSummary } from "@/lib/areaDemandStore";

const SESSION_FETCH: RequestInit = { credentials: "include" };
const DEMAND_URL = "/api/admin/area-demand?sinceDays=90&limit=50";
const DATE_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

type LoadState = "idle" | "loading" | "ready" | "degraded" | "denied" | "error";

type CoverageDemandResponse = {
  summary?: AreaDemandSummary[];
  partial?: boolean;
  sinceDays?: number;
  status?: "ready" | "degraded";
};

type CoverageDemandQueueProps = {
  ensureAdminSession: (force?: boolean) => Promise<boolean>;
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
  const [state, setState] = useState<LoadState>("idle");
  const [rows, setRows] = useState<AreaDemandSummary[]>([]);
  const [partial, setPartial] = useState(false);
  const [sinceDays, setSinceDays] = useState(90);

  const load = useCallback(async () => {
    setState("loading");
    try {
      if (!(await ensureAdminSession())) {
        setRows([]);
        setState("denied");
        return;
      }
      const response = await retryWithFreshSession(() =>
        fetch(DEMAND_URL, SESSION_FETCH),
      );
      if (response.status === 403) {
        discardBody(response);
        setRows([]);
        setState("denied");
        return;
      }
      if (!response.ok) {
        discardBody(response);
        setRows([]);
        setState("error");
        return;
      }

      const body = (await response.json()) as CoverageDemandResponse;
      setRows(body.summary ?? []);
      setPartial(body.partial === true);
      setSinceDays(body.sinceDays ?? 90);
      setState(body.status === "degraded" ? "degraded" : "ready");
    } catch {
      setRows([]);
      setState("error");
    }
  }, [ensureAdminSession, retryWithFreshSession]);

  const message =
    state === "denied"
      ? "Not authorised. Check the admin token."
      : state === "error"
        ? "Could not load coverage demand. Try again."
        : state === "degraded"
          ? "Coverage history is incomplete. Try again."
          : state === "ready" && partial
            ? "Showing recent signals only. Counts can be higher."
            : null;

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
          disabled={state === "loading"}
        >
          {state === "loading" ? "Loading…" : "Load demand"}
        </button>
      </div>

      {message ? (
        <div
          className="admin-msg"
          role={state === "denied" || state === "error" ? "alert" : "status"}
        >
          {message}
        </div>
      ) : null}

      {state === "ready" && rows.length === 0 ? (
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
                  First:{" "}
                  <time dateTime={row.firstSeen}>
                    {formatDate(row.firstSeen)}
                  </time>
                </span>
                <span>
                  Latest:{" "}
                  <time dateTime={row.lastSeen}>
                    {formatDate(row.lastSeen)}
                  </time>
                </span>
              </div>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}
