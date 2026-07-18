import Link from "next/link";

import {
  isNightAreaRouteReady,
  NIGHT_AREAS,
  type CoverageStatus,
  type NightArea,
} from "@/lib/nightAreas";

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
  { bucket: "captured", label: "Captured" },
  { bucket: "reviewed", label: "Reviewed" },
  { bucket: "discovered", label: "Discovered" },
  { bucket: "paused", label: "Paused" },
];

function stateForArea(area: NightArea, now: Date): CoverageState {
  const routeReady = isNightAreaRouteReady(area, now);
  if (routeReady) {
    return {
      bucket: "route_ready",
      label: "Route-ready",
      detail: "The evidence gate is live. A Crawl Route can be planned.",
      tone: "ready",
      actionLabel: "Open planner",
      href: "/plan",
    };
  }

  const openChecks = area.missingEvidence.length;
  const gateDetail = openChecks > 0
    ? `${openChecks} evidence ${openChecks === 1 ? "check remains" : "checks remain"}; no route yet.`
    : "The evidence gate is not complete yet; no route is promised.";
  const shared = {
    actionLabel: "See the pubs",
    href: `/map?q=${encodeURIComponent(area.name)}`,
  };

  switch (area.coverageStatus) {
    case "captured":
      return { bucket: "captured", label: "Captured", detail: gateDetail, tone: "captured", ...shared };
    case "reviewed":
      return { bucket: "reviewed", label: "Reviewed", detail: gateDetail, tone: "reviewed", ...shared };
    case "paused":
      return {
        bucket: "paused",
        label: "Paused",
        detail: "The review window expired; browse-only until a fresh snapshot lands.",
        tone: "paused",
        ...shared,
      };
    case "route_ready": {
      const expiresAt = area.reviewExpiresAt ? Date.parse(area.reviewExpiresAt) : Number.NaN;
      if (Number.isFinite(expiresAt) && expiresAt <= now.getTime()) {
        return {
          bucket: "paused",
          label: "Paused",
          detail: "The route-ready review window expired; browse-only until a fresh snapshot lands.",
          tone: "paused",
          ...shared,
        };
      }
      return {
        bucket: "reviewed",
        label: "Reviewed",
        detail: "The route-ready gate is not live; inspect pubs while evidence is checked again.",
        tone: "reviewed",
        ...shared,
      };
    }
    case "discovered":
    default:
      return {
        bucket: "discovered",
        label: "Discovered",
        detail: "Capture has not started; browse-only for now.",
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
      </div>
      <Link
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
  const counts = STATUS_ORDER.map((status) => ({
    ...status,
    count: areas.filter((area) => stateForArea(area, now).bucket === status.bucket).length,
  }));

  return (
    <section className="nightAreaCoverage" aria-labelledby="night-area-coverage-title">
      <header className="nightAreaCoverage__head">
        <div>
          <p className="nightAreaCoverage__eyebrow">London capture</p>
          <h2 id="night-area-coverage-title">Areas near you, with the gate visible</h2>
        </div>
        <Link className="nightAreaCoverage__plannerLink" href="/plan">
          Open planner
        </Link>
      </header>

      <p className="nightAreaCoverage__intro">
        Capture and review are evidence stages, not routes. Only an area with a complete,
        live gate can produce a Crawl Route; everything else stays browse-only.
      </p>

      <ul className="nightAreaCoverage__counts" aria-label="Area coverage counts">
        {counts.map((status) => (
          <li key={status.bucket}>
            <strong>{status.count}</strong>
            <span>{status.label}</span>
          </li>
        ))}
      </ul>

      <div className="nightAreaCoverage__quickRead">
        <p className="nightAreaCoverage__sectionLabel">Quick read</p>
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
          “See the pubs” opens the map for browsing only. It does not turn a captured, reviewed,
          discovered, or paused area into a planned route.
        </p>
        <ul className="nightAreaCoverage__list" aria-label="All area coverage">
          {areas.map((area) => <CoverageRow key={area.slug} area={area} now={now} />)}
        </ul>
      </details>
    </section>
  );
}
