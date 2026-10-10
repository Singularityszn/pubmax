"use client";

// Display contract: docs/CITYMCP_LONDON.md, Runtime API surfaces.

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CloudRain, Info, Sun, TrainFront, X } from "lucide-react";

import { CITY_STATUS_UNSOURCED_LABEL, cityStatusSignalSource } from "@/lib/cityStatusSignalSource";
import { loadSurfaceJson, SURFACE_JUST_READ_MS } from "@/lib/surfaceDataCache";
import { firstHttp } from "@/lib/httpUrl";
import { useStaggeredRead } from "@/lib/useStaggeredRead";
import { LONDON_BOROUGH_NAMES } from "@/lib/londonBoroughNames.mjs";
import { locationNamesBorough } from "@/lib/starterPacks";
import { normaliseUkPlaceQuery } from "@/lib/ukPlaceSearch";


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
  /** The name earned by the settled map view. Null means no local context. */
  viewedArea?: string | null;
  /** False denies city-wide context while preserving matched local signals. */
  allowCitywideStatus?: boolean;
};

function signalsInViewedArea(signals: Signal[] | undefined, viewedArea: string | null, allowCitywideStatus: boolean): Signal[] {
  const viewedNames = viewedArea ? viewedArea.split(/\s*(?:&|,)\s*/).map(normaliseUkPlaceQuery) : [];
  const viewedBoroughs = LONDON_BOROUGH_NAMES.filter((borough) => viewedNames.some((name) =>
    locationNamesBorough(name, borough) && locationNamesBorough(borough, name),
  ));
  return (signals ?? []).filter((signal) => {
    const areas = (signal.areas ?? []).map(normaliseUkPlaceQuery).filter(Boolean);
    // An unlocated signal cannot establish a local fact about this view.
    if (areas.length === 0) return false;
    if (areas.every((area) => area === "london" || area === "greater london")) return allowCitywideStatus;
    return areas.filter((area) => area !== "london" && area !== "greater london").some((area) =>
      viewedNames.includes(area) || viewedBoroughs.some((borough) =>
        locationNamesBorough(area, borough) && locationNamesBorough(borough, area)),
    );
  });
}

const DISMISS_KEY = "pubmax:cityStatusDismiss:v1";

function readDismissed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    try {
      return window.sessionStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      return false;
    }
  }
}

function writeDismissed(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DISMISS_KEY, "1");
  } catch {
    try {
      window.sessionStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // ignore
    }
    return;
  }
  try {
    window.sessionStorage.setItem(DISMISS_KEY, "1");
  } catch {
    // Best-effort mirror; localStorage is the durable source.
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
  return `TfL: ${names}`;
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

/**
 * Gate: the status strip is a *disruption* banner, so it earns a slot on first
 * paint only when the data is genuinely actionable: a signal the upstream
 * flagged major/notable, or a live TfL line disruption. A clear-weather
 * one-liner or an info-severity note is not disruption; showing it stacked a
 * second centred pill under the city switcher was pure boot clutter. Exported
 * for the unit test.
 */
export function isSevereCityStatus(
  headline: { kind: "signal" | "tube" | "weather"; severity: string } | null,
  affectedTubeLineCount = 0,
): boolean {
  if (affectedTubeLineCount > 0) return true;
  if (!headline) return false;
  if (headline.kind === "tube") return true;
  if (headline.kind === "signal") {
    return headline.severity === "major" || headline.severity === "notable";
  }
  return false;
}

// Alerts precede transport and events to keep safety-relevant context first.

export type SignalKindGroup = "alert" | "transport" | "event" | "other";

const KIND_ORDER: SignalKindGroup[] = ["alert", "transport", "event", "other"];
const KIND_LABELS: Record<SignalKindGroup, string> = {
  alert: "Alerts",
  transport: "Transport",
  event: "Events",
  other: "Other",
};

export function normaliseSignalKind(kind: string | undefined): SignalKindGroup {
  const k = String(kind ?? "").trim().toLowerCase();
  if (k === "alert" || k === "alerts") return "alert";
  if (k === "transport" || k === "transit" || k === "tube" || k === "tfl") return "transport";
  if (k === "event" || k === "events" || k === "gig" || k === "gigs") return "event";
  return "other";
}

export type SignalGroup = { kind: SignalKindGroup; label: string; signals: Signal[] };

export function groupSignalsByKind(signals: Signal[] | undefined): SignalGroup[] {
  if (!Array.isArray(signals) || signals.length === 0) return [];
  const buckets = new Map<SignalKindGroup, Signal[]>();
  for (const s of signals) {
    const k = normaliseSignalKind(s.kind);
    const list = buckets.get(k) ?? [];
    list.push(s);
    buckets.set(k, list);
  }
  return KIND_ORDER.filter((k) => buckets.has(k)).map((k) => ({
    kind: k,
    label: KIND_LABELS[k],
    signals: buckets.get(k) ?? [],
  }));
}

function formatAsOfLabel(asOf: string | null | undefined): string {
  if (!asOf) return "CityMCP";
  const parsed = Date.parse(asOf);
  if (!Number.isFinite(parsed)) return "CityMCP";
  const time = new Date(parsed).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `Updated ${time} · CityMCP`;
}

export default function CityStatusBanner({ cityId, viewedArea = null, allowCitywideStatus = true }: CityStatusBannerProps) {
  // Only render on London — the API/tools are London-only.
  const isLondon = cityId === "london" || cityId === undefined;
  const [data, setData] = useState<StatusResponse | null>(null);
  const [dismissed, setDismissed] = useState<boolean>(false);
  const [expanded, setExpanded] = useState(false);
  const [expandedArea, setExpandedArea] = useState(viewedArea);
  if (expandedArea !== viewedArea) {
    setExpandedArea(viewedArea);
    setExpanded(false);
  }
  const aborted = useRef(false);
  // An opening banner, not the first screen: it asks after the map has asked.
  const ready = useStaggeredRead(1, "map");

  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // Claim the key so the map-level Escape (close drawer) doesn't also fire.
        e.preventDefault();
        setExpanded(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded]);

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
    if (!ready) return;
    const controller = new AbortController();
    // The same key the TfL panel and the garden card read, so a page that shows
    // more than one of them asks the server once.
    void loadSurfaceJson<StatusResponse>(
      "/api/citymcp/status",
      {
        signal: controller.signal,
        init: { headers: { accept: "application/json" } },
        validate: (body) => Boolean(body && typeof body === "object"),
        freshForMs: SURFACE_JUST_READ_MS,
      },
      (body) => {
        void Promise.resolve().then(() => {
          if (!aborted.current) {
            setData(body);
            setExpanded(false);
          }
        });
      },
    );
    return () => {
      aborted.current = true;
      controller.abort();
    };
  }, [isLondon, ready]);

  if (!isLondon || dismissed || !data) return null;
  // If the API returned an error and no data, stay hidden — never block the
  // map, never invent facts.
  if (data.error && (data.signals?.length ?? 0) === 0 && !data.weather && (data.tubeLines?.length ?? 0) === 0) {
    return null;
  }

  const signals = signalsInViewedArea(data.signals, viewedArea, allowCitywideStatus);
  const headline = pickCityStatusHeadline({ ...data, signals });
  if (!headline) return null;
  if (!allowCitywideStatus && headline.kind !== "signal") return null;

  const affectedLines = (allowCitywideStatus ? data.tubeLines ?? [] : []).filter(
    (line) => line.line && line.status && line.status.toLowerCase() !== "good service",
  );

  // Gate on genuine severity so the map's first paint isn't cluttered by a
  // second centred pill (weather/info) stacked under the city switcher.
  if (!isSevereCityStatus(headline, affectedLines.length)) return null;

  const dismiss = () => {
    writeDismissed();
    setDismissed(true);
  };

  const signalCount = signals.length;
  const hasSignals = signalCount > 0;
  const hasDetails = hasSignals || affectedLines.length > 0;
  const groups = groupSignalsByKind(signals);

  const content = (
    <>
      <span className="cityStatusBannerIcon" data-kind={headline.kind}>
        {iconFor(headline.kind, headline.severity)}
      </span>
      <span className="cityStatusBannerCopy" title={headline.text}>
        {headline.text}
      </span>
      <span className="cityStatusBannerMobileCopy">
        TfL live{affectedLines.length > 0 ? ` · ${affectedLines.length}` : ""}
      </span>
    </>
  );

  return (
    <div className="cityStatusStack">
      <div
        className="cityStatusBanner"
        data-severity={headline.severity}
        role="status"
        aria-live="polite"
      >
        {hasDetails ? (
          /* Keep the same class and children so the button preserves the
             pill's appearance. Source links belong in the expanded feed. */
          <button
            type="button"
            className="cityStatusBannerLink"
            aria-expanded={expanded}
            aria-controls="cityStatusSignalSheet"
            onClick={() => setExpanded((v) => !v)}
          >
            {content}
          </button>
        ) : headline.href ? (
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
      {expanded && hasDetails ? (
        <div
          id="cityStatusSignalSheet"
          className="cityStatusSignalSheet"
          role="region"
          aria-label="Live London updates for tonight"
        >
          <div className="cityStatusSignalSheetHead">
            <strong>London live</strong>
            <span className="cityStatusSignalSheetMeta">{formatAsOfLabel(data.asOf)}</span>
            <button
              type="button"
              className="cityStatusSignalSheetClose"
              aria-label="Close signals list"
              onClick={() => setExpanded(false)}
            >
              <X size={14} strokeWidth={2.25} aria-hidden="true" />
            </button>
          </div>
          {affectedLines.length > 0 ? (
            <div className="cityStatusSignalGroup">
              <h4 className="cityStatusSignalGroupLabel">TfL line updates</h4>
              <ul className="cityStatusSignalList">
                {affectedLines.map((line) => (
                  <li className="cityStatusSignalRow" key={`${line.line}-${line.status}`}>
                    <span className="cityStatusSignalRowIcon" aria-hidden="true"><TrainFront size={14} /></span>
                    <div className="cityStatusSignalRowBody">
                      <p className="cityStatusSignalRowHeadline">{line.line}</p>
                      <p className="cityStatusSignalRowMeta">{line.status}</p>
                      {line.disruption ? <p className="cityStatusSignalRowMeta">{line.disruption}</p> : null}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {groups.map((group) => (
            <div className="cityStatusSignalGroup" key={group.kind}>
              <h4 className="cityStatusSignalGroupLabel">{group.label}</h4>
              <ul className="cityStatusSignalList">
                {group.signals.map((s, i) => {
                  const source = cityStatusSignalSource(s.sourceUrl);
                  return (
                    <li className="cityStatusSignalRow" key={`${group.kind}-${i}`}>
                      <span className="cityStatusSignalRowIcon" aria-hidden="true">
                        {iconFor(
                          group.kind === "transport" ? "tube" : "signal",
                          String(s.severity ?? "info").toLowerCase(),
                        )}
                      </span>
                      <div className="cityStatusSignalRowBody">
                        <p className="cityStatusSignalRowHeadline">{s.headline}</p>
                        {s.timeWindow || (s.areas && s.areas.length > 0) ? (
                          <p className="cityStatusSignalRowMeta">
                            {[s.timeWindow, s.areas?.join(", ")].filter(Boolean).join(" · ")}
                          </p>
                        ) : null}
                        <p className="cityStatusSignalRowSource">
                          {source ? (
                            <a href={source.href} target="_blank" rel="noreferrer noopener">
                              {source.label}
                            </a>
                          ) : (
                            <span>{CITY_STATUS_UNSOURCED_LABEL}</span>
                          )}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
