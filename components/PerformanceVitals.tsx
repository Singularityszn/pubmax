"use client";

import { useReportWebVitals } from "next/web-vitals";

import { trackEvent } from "@/lib/analytics";

const REPORTED_METRICS = new Set(["CLS", "FCP", "INP", "LCP", "TTFB"]);

/**
 * Privacy-safe real-user performance reporting. Values are rounded before they
 * enter the closed analytics rail; no raw navigation URL, account identifier,
 * or attribution payload is transmitted.
 */
export default function PerformanceVitals() {
  useReportWebVitals((metric) => {
    if (!REPORTED_METRICS.has(metric.name)) return;
    const value = metric.name === "CLS"
      ? Math.round(metric.value * 1_000) / 1_000
      : Math.round(metric.value);
    trackEvent("web_vital", {
      metric: metric.name,
      value,
      rating: metric.rating,
    });
  });

  return null;
}
