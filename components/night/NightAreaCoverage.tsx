import type { Route } from "next";
import Link from "next/link";

import {
  isNightAreaRouteReady,
  NIGHT_AREAS,
  type CoverageStatus,
  type NightArea,
} from "@/lib/nightAreas";
import { nightAreaCoverageDetail, nightAreaCoverageMeta } from "@/lib/nightPresentation";

type CoverageBucket = "route_ready" | CoverageStatus;
type CoverageTone = "ready" | "captured" | "reviewed" | "discovered" | "paused";

type CoverageState = {
  bucket: CoverageBucket;
  label: string;
  detail: string;
  tone: CoverageTone;
  actionLabel: string;
  href: Route;
};

const STATUS_ORDER: Array<{ bucket: CoverageBucket; label: string }> = [
  { bucket: "route_ready", label: "Plan a crawl" },
  { bucket: "captured", label: "Browse pubs" },
  { bucket: "reviewed", label: "Browse pubs" },
  { bucket: "discovered", label: "Browse pubs" },
  { bucket: "paused", label: "Browse pubs" },
];

function stateForArea(area: NightArea, now: Date): CoverageState {
  const routeReady = isNightAreaRouteReady(area, now);
  if (routeReady) {
    return {
      bucket: "route_ready",
      label: "Plan a crawl",
      detail: "Enough checked information to plan a crawl.",
      tone: "ready",
      actionLabel: "Open planner",
      href: "/plan",
    };
  }

  const gateDetail = nightAreaCoverageDetail(area, now);
  const shared: { actionLabel: string; href: Route } = {
    actionLabel: "See the pubs",
    href: `/map?q=${encodeURIComponent(area.name)}`,
  };

  switch (area.coverageStatus) {
    case "captured":
      return { bucket: "captured", label: "Browse pubs", detail: gateDetail, tone: "captured", ...shared };
    case "reviewed":
      return { bucket: "reviewed", label: "Browse pubs", detail: gateDetail, tone: "reviewed", ...shared };
    case "paused":
      return {
        bucket: "paused",
        label: "Browse pubs",
        detail: "The information needs updating before you can plan a crawl.",
        tone: "paused",
        ...shared,
      };
    case "route_ready": {
      const expiresAt = area.reviewExpiresAt ? Date.parse(area.reviewExpiresAt) : Number.NaN;
      if (Number.isFinite(expiresAt) && expiresAt <= now.getTime()) {
        return {
          bucket: "paused",
          label: "Browse pubs",
          detail: "The information needs updating before you can plan a crawl.",
          tone: "paused",
          ...shared,
        };
      }
      return {
        bucket: "reviewed",
        label: "Browse pubs",
        detail: "Not enough checked information to plan a crawl here yet.",
        tone: "reviewed",
        ...shared,
      };
    }
    case "discovered":
    default:
      return {
        bucket: "discovered",
        label: "Browse pubs",
        detail: "Browse the pubs. We haven't checked this area for crawl planning yet.",
        tone: "discovered",
        ...shared,
      };
  }
}

function areaMapLabel(area: NightArea, state: CoverageState): string {
  return state.bucket === "route_ready"
    ? "Open planner"
    : `See ${area.name} pubs on the map`;
}

function CoverageRow({ area, now }: { area: NightArea; now: Date }) {
  const state = stateForArea(area, now);
  const routeReady = state.bucket === "route_ready";

  return (
    <li
      className="nightAreaCoverage__row"
      data-coverage-status={area.coverageStatus}
      data-route-ready={routeReady ? "true" : "false"}
    >
      <div className="nightAreaCoverage__rowCopy">
        <div className="nightAreaCoverage__rowTitle">
          <strong>{area.name}</strong>
          <span className={`nightAreaCoverage__badge nightAreaCoverage__badge--${state.tone}`}>
            {state.label}
          </span>
        </div>
        <p>{state.detail}</p>
        <p>{nightAreaCoverageMeta(area, now)}</p>
      </div>
      <Link
        prefetch={false}
        className={`nightAreaCoverage__action${routeReady ? " nightAreaCoverage__action--ready" : ""}`}
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


  return (
    <section className="nightAreaCoverage" aria-labelledby="night-area-coverage-title">
      <header className="nightAreaCoverage__head">
        <div>
          <p className="nightAreaCoverage__eyebrow">Across London</p>
          <h2 id="night-area-coverage-title">Where you can plan a crawl tonight</h2>
        </div>
        <Link prefetch={false} className="nightAreaCoverage__plannerLink" href="/plan">
          Open planner
        </Link>
      </header>

      <p className="nightAreaCoverage__intro">
        Browse pubs across London. Crawl planning is available where we have enough checked information.
      </p>

      <div className="nightAreaCoverage__quickRead">
        <ul className="nightAreaCoverage__list" aria-label="Representative area coverage">
          {featured.map((area) => <CoverageRow key={area.slug} area={area} now={now} />)}
        </ul>
      </div>

      <details className="nightAreaCoverage__details">
        <summary>
          <span>See every area</span>
          <span className="nightAreaCoverage__detailsMeta">{areas.length} areas</span>
        </summary>
        <p className="nightAreaCoverage__detailsIntro">
          Each area shows whether you can plan a crawl or browse its pubs.
        </p>
        <ul className="nightAreaCoverage__list" aria-label="All area coverage">
          {areas.map((area) => <CoverageRow key={area.slug} area={area} now={now} />)}
        </ul>
      </details>
    </section>
  );
}
