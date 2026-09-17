import Link from "next/link";

import {
  isNightAreaRouteReady,
  NIGHT_AREAS,
  type CoverageStatus,
  type NightArea,
} from "@/lib/nightAreas";
import { nightAreaCoverageDetail } from "@/lib/nightPresentation";
import styles from "./nightAreaCoverage.module.css";

type CoverageBucket = "route_ready" | CoverageStatus;
type CoverageTone = "ready" | "captured" | "reviewed" | "discovered" | "paused";

type CoverageState = {
  bucket: CoverageBucket;
  label: string;
  detail: string;
  tone: CoverageTone;
  actionLabel: string;
  href: string;
};

const STATUS_ORDER: Array<{ bucket: CoverageBucket; label: string }> = [
  { bucket: "route_ready", label: "Route-ready" },
  { bucket: "captured", label: "Some checks done" },
  { bucket: "reviewed", label: "Reviewed" },
  { bucket: "discovered", label: "Not checked" },
  { bucket: "paused", label: "Paused" },
];

function stateForArea(area: NightArea, now: Date): CoverageState {
  const routeReady = isNightAreaRouteReady(area, now);
  if (routeReady) {
    return {
      bucket: "route_ready",
      label: "Route-ready",
      detail: "Prices here are fresh and checked. Plan a crawl whenever.",
      tone: "ready",
      actionLabel: "Open planner",
      href: "/plan",
    };
  }

  const gateDetail = nightAreaCoverageDetail(area, now);
  const shared = {
    actionLabel: "See the pubs",
    href: `/map?q=${encodeURIComponent(area.name)}`,
  };

  switch (area.coverageStatus) {
    case "captured":
      return { bucket: "captured", label: "Some checks done", detail: gateDetail, tone: "captured", ...shared };
    case "reviewed":
      return { bucket: "reviewed", label: "Reviewed", detail: gateDetail, tone: "reviewed", ...shared };
    case "paused":
      return {
        bucket: "paused",
        label: "Paused",
        detail: "Prices here have gone stale. Have a browse while we recheck them.",
        tone: "paused",
        ...shared,
      };
    case "route_ready": {
      const expiresAt = area.reviewExpiresAt ? Date.parse(area.reviewExpiresAt) : Number.NaN;
      if (Number.isFinite(expiresAt) && expiresAt <= now.getTime()) {
        return {
          bucket: "paused",
          label: "Paused",
          detail: "This one was crawl-ready, but its prices have gone stale. Have a browse while we recheck them.",
          tone: "paused",
          ...shared,
        };
      }
      return {
        bucket: "reviewed",
        label: "Reviewed",
        detail: "Not crawl-ready right now. Have a browse while we recheck the prices.",
        tone: "reviewed",
        ...shared,
      };
    }
    case "discovered":
    default:
      return {
        bucket: "discovered",
        label: "Not checked",
        detail: "Haven't got to this one yet. Have a browse.",
        tone: "discovered",
        ...shared,
      };
  }
}

function areaMapLabel(area: NightArea, state: CoverageState): string {
  return state.bucket === "route_ready"
    ? `Open the planner from ${area.name} coverage`
    : `See ${area.name} pubs on the map`;
}

function CoverageRow({ area, now }: { area: NightArea; now: Date }) {
  const state = stateForArea(area, now);
  const routeReady = state.bucket === "route_ready";

  const toneStyles: Record<string, string | undefined> = {
    ready: styles.nightAreaCoverageBadgeReady,
    paused: styles.nightAreaCoverageBadgePaused,
  };

  return (
    <li
      className={styles.nightAreaCoverageRow}
      data-coverage-status={area.coverageStatus}
      data-route-ready={routeReady ? "true" : "false"}
    >
      <div className={styles.nightAreaCoverageRowCopy}>
        <div className={styles.nightAreaCoverageRowTitle}>
          <strong>{area.name}</strong>
          <span className={[styles.nightAreaCoverageBadge, toneStyles[state.tone]].filter(Boolean).join(" ")}>
            {state.label}
          </span>
        </div>
        <p>{state.detail}</p>
      </div>
      <Link
        className={[styles.nightAreaCoverageAction, routeReady ? styles.nightAreaCoverageActionReady : ""].filter(Boolean).join(" ")}
        href={state.href}
        aria-label={areaMapLabel(area, state)}
      >
        {state.actionLabel}
      </Link>
    </li>
  );
}

function displayAreas(areas: readonly NightArea[], now: Date): NightArea[] {
  const featured: NightArea[] = [];
  for (const bucket of STATUS_ORDER) {
    const match = areas.find((area) => stateForArea(area, now).bucket === bucket.bucket);
    if (match) featured.push(match);
  }
  return featured;
}

export default function NightAreaCoverage() {
  const now = new Date();
  const areas = NIGHT_AREAS;
  const featured = displayAreas(areas, now);
  const counts = STATUS_ORDER.map((status) => ({
    ...status,
    count: areas.filter((area) => stateForArea(area, now).bucket === status.bucket).length,
  }));

  return (
    <section className={styles.nightAreaCoverage} aria-labelledby="night-area-coverage-title">
      <header className={styles.nightAreaCoverageHead}>
        <div>
          <p className={styles.nightAreaCoverageEyebrow}>Across London</p>
          <h2 id="night-area-coverage-title">Where you can plan a crawl tonight</h2>
        </div>
        <Link prefetch={false} className={styles.nightAreaCoveragePlannerLink} href="/plan">
          Open planner
        </Link>
      </header>

      <p className={styles.nightAreaCoverageIntro}>
        We only call an area crawl-ready when its prices are fresh and checked. The rest
        are yours to browse.
      </p>

      <ul className={styles.nightAreaCoverageCounts} aria-label="Area coverage counts">
        {counts.map((status) => (
          <li key={status.bucket}>
            <strong>{status.count}</strong>
            <span>{status.label}</span>
          </li>
        ))}
      </ul>

      <div className={styles.nightAreaCoverageQuickRead}>
        <p className={styles.nightAreaCoverageSectionLabel}>Quick read</p>
        <ul className={styles.nightAreaCoverageList} aria-label="Representative area coverage">
          {featured.map((area) => <CoverageRow key={area.slug} area={area} now={now} />)}
        </ul>
      </div>

      <details className={styles.nightAreaCoverageDetails}>
        <summary>
          <span>See every area</span>
          <span className={styles.nightAreaCoverageDetailsMeta}>{areas.length} areas</span>
        </summary>
        <p className={styles.nightAreaCoverageDetailsIntro}>
          “See the pubs” just opens the map for a browse. It won’t turn an area into a
          planned crawl until its prices are fresh.
        </p>
        <ul className={styles.nightAreaCoverageList} aria-label="All area coverage">
          {areas.map((area) => <CoverageRow key={area.slug} area={area} now={now} />)}
        </ul>
      </details>
    </section>
  );
}
