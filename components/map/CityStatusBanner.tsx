"use client";

// London-only city status strip on the map.
//
// Fetches `/api/citymcp/status` client-side after mount and renders a compact
// one-liner headline. Order of preference:
//   1) top signal by severity (major > notable > info) — most actionable.
//   2) a summary of disrupted tube lines.
//   3) a weather one-liner ("Clear · 27°C · feels 28°C").
//
// If none of the above are available, or the API returned an error/empty
// response, the banner renders nothing — the map load is never blocked and
// nothing is claimed that we haven't received from the upstream. Follows the
// React 19 no-setState-in-effect pattern by deferring setState with
// Promise.resolve().then when reacting to fetch results.

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CloudRain, Info, Sun, TrainFront, X } from "lucide-react";

import { firstHttp } from "@/lib/httpUrl";

import "./cityStatusBanner.css";

type Weather = {
  condition?: string;
  tempC?: number;
  feelsLikeC?: number;
  precipProbabilityPct?: number;
  isDay?: boolean;
} | null;

type TubeLine = { line: string; status: string; disruption?: string };
type Signal = {
  headline: string;
  detail?: string;
  kind?: string;
  severity?: string;
  areas?: string[];
  postcodes?: string[];
  timeWindow?: string;
  sourceUrl?: string;
};

type StatusResponse = {
  asOf?: string | null;
  weather?: Weather;
  tubeLines?: TubeLine[];
  signals?: Signal[];
  error?: string;
};

type CityStatusBannerProps = {
  /** Explicit for parity with sibling banners; parent gates by cityId already. */
  cityId?: string;
};

const DISMISS_KEY = "pubmax:cityStatusDismiss:v1";

function readDismissed(): boolean {
  if (typeof window === "undefined" || !window.sessionStorage) return false;
  try {
    return window.sessionStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

function writeDismissed(): void {
  if (typeof window === "undefined" || !window.sessionStorage) return;
  try {
    window.sessionStorage.setItem(DISMISS_KEY, "1");
  } catch {
    // ignore
  }
}

function severityRank(sev: string | undefined): number {
  const s = String(sev ?? "").toLowerCase();
  if (s === "major") return 3;
  if (s === "notable") return 2;
  if (s === "info") return 1;
  return 0;
}

function formatWeather(w: Weather): string | null {
  if (!w) return null;
  const parts: string[] = [];
  if (w.condition) parts.push(String(w.condition).replace(/^\w/, (c) => c.toUpperCase()));
  if (typeof w.tempC === "number") parts.push(`${Math.round(w.tempC)}°C`);
  if (typeof w.feelsLikeC === "number" && typeof w.tempC === "number" && Math.abs(w.feelsLikeC - w.tempC) >= 2) {
    parts.push(`feels ${Math.round(w.feelsLikeC)}°C`);
  }
  if (typeof w.precipProbabilityPct === "number" && w.precipProbabilityPct >= 30) {
    parts.push(`rain ${Math.round(w.precipProbabilityPct)}%`);
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

function summariseTubeLines(lines: TubeLine[] | undefined): string | null {
  if (!Array.isArray(lines) || lines.length === 0) return null;
  const affected = lines
    .filter((l) => l?.line && l?.status && l.status.toLowerCase() !== "good service")
    .slice(0, 3);
  if (affected.length === 0) return null;
  const names = affected.map((l) => `${l.line}: ${l.status}`).join(" · ");
  return `TfL — ${names}`;
}

/**
 * Choose the single most useful line to show. Signals win over tube summaries
 * win over weather; nulls cascade through so we never render a shell without
 * anything to say.
 */
export function pickCityStatusHeadline(data: StatusResponse): {
  text: string;
  kind: "signal" | "tube" | "weather";
  severity: string;
  href?: string;
} | null {
  const signals = Array.isArray(data.signals) ? data.signals : [];
  if (signals.length > 0) {
    const top = [...signals]
      .sort((a, b) => severityRank(b.severity) - severityRank(a.severity))[0];
    if (top?.headline) {
      return {
        text: top.headline,
        kind: "signal",
        severity: String(top.severity ?? "info").toLowerCase(),
        href: firstHttp(top.sourceUrl) || undefined,
      };
    }
  }
  const tubeLine = summariseTubeLines(data.tubeLines);
  if (tubeLine) return { text: tubeLine, kind: "tube", severity: "notable" };
  const weather = formatWeather(data.weather ?? null);
  if (weather) return { text: weather, kind: "weather", severity: "info" };
  return null;
}

function iconFor(kind: "signal" | "tube" | "weather", severity: string) {
  if (kind === "tube") return <TrainFront size={14} aria-hidden="true" />;
  if (kind === "weather") return <Sun size={14} aria-hidden="true" />;
  if (severity === "major") return <AlertTriangle size={14} aria-hidden="true" />;
  if (severity === "notable") return <CloudRain size={14} aria-hidden="true" />;
  return <Info size={14} aria-hidden="true" />;
}

export default function CityStatusBanner({ cityId }: CityStatusBannerProps) {
  // Only render on London — the API/tools are London-only.
  const isLondon = cityId === "london" || cityId === undefined;
  const [data, setData] = useState<StatusResponse | null>(null);
  const [dismissed, setDismissed] = useState<boolean>(false);
  const aborted = useRef(false);

  useEffect(() => {
    aborted.current = false;
    // Cheap: skip entirely off-London.
    if (!isLondon) return;
    // Skip if user dismissed this session.
    if (readDismissed()) {
      // React 19: defer setState off the effect tick.
      void Promise.resolve().then(() => {
        if (!aborted.current) setDismissed(true);
      });
      return;
    }
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch("/api/citymcp/status", {
          signal: controller.signal,
          headers: { accept: "application/json" },
        });
        if (!res.ok) return;
        const body = (await res.json()) as StatusResponse;
        void Promise.resolve().then(() => {
          if (!aborted.current) setData(body);
        });
      } catch {
        // Fail-soft: no banner is fine.
      }
    })();
    return () => {
      aborted.current = true;
      controller.abort();
    };
  }, [isLondon]);

  if (!isLondon || dismissed || !data) return null;
  // If the API returned an error and no data, stay hidden — never block the
  // map, never invent facts.
  if (data.error && (data.signals?.length ?? 0) === 0 && !data.weather && (data.tubeLines?.length ?? 0) === 0) {
    return null;
  }

  const headline = pickCityStatusHeadline(data);
  if (!headline) return null;

  const dismiss = () => {
    writeDismissed();
    setDismissed(true);
  };

  const content = (
    <>
      <span className="cityStatusBannerIcon" data-kind={headline.kind}>
        {iconFor(headline.kind, headline.severity)}
      </span>
      <span className="cityStatusBannerCopy" title={headline.text}>
        {headline.text}
      </span>
    </>
  );

  return (
    <div
      className="cityStatusBanner"
      data-severity={headline.severity}
      role="status"
      aria-live="polite"
    >
      {headline.href ? (
        <a
          className="cityStatusBannerLink"
          href={headline.href}
          target="_blank"
          rel="noreferrer noopener"
        >
          {content}
        </a>
      ) : (
        <span className="cityStatusBannerLink" role="presentation">
          {content}
        </span>
      )}
      <button
        type="button"
        className="cityStatusBannerDismiss"
        aria-label="Dismiss city status"
        onClick={dismiss}
      >
        <X size={12} strokeWidth={2.25} aria-hidden="true" />
      </button>
    </div>
  );
}
