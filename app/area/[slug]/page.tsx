import type { Metadata } from "next";
import Link from "next/link";

import SiteNav from "@/components/nav/SiteNav";
import { getCity } from "@/lib/cities";
import { resolveNightAreaActivation } from "@/lib/nightAreaActivation";

import "./nightAreaActivation.css";

type PageProps = {
  params: Promise<{ slug: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function firstSearchValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

async function readState({ params, searchParams }: PageProps) {
  const { slug } = await params;
  const query = await (searchParams ?? Promise.resolve({}));
  return resolveNightAreaActivation({
    slug,
    cityId: query.city === undefined ? undefined : firstSearchValue(query.city) ?? "",
  });
}

export async function generateMetadata({ params, searchParams }: PageProps): Promise<Metadata> {
  const state = await readState({ params, searchParams });
  const title = state.areaName
    ? `${state.areaName} pubs and crawl planning`
    : `Browse ${getCity(state.cityId).displayName} pubs`;
  return {
    title,
    description: state.kind === "ready"
      ? `Plan a crawl in ${state.areaName}.`
      : `Browse listed pubs${state.areaName ? ` in ${state.areaName}` : ` on the ${getCity(state.cityId).displayName} map`}.`,
    ...(state.kind === "browse" && state.reason !== "not-ready"
      ? { robots: { index: false, follow: false } }
      : {}),
  };
}

function reviewDate(value: string | null): string | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(timestamp));
}

function headingForState(state: Awaited<ReturnType<typeof readState>>): string {
  if (state.kind === "ready") return `Plan a night in ${state.areaName}`;
  if (state.reason === "not-ready") return `Browse ${state.areaName}`;
  if (state.reason === "unknown") return "Browse the map";
  return `Open the ${getCity(state.cityId).displayName} map`;
}

function introForState(state: Awaited<ReturnType<typeof readState>>): string {
  if (state.kind === "ready") {
    return "Prices and route details are checked here. Start with a plan when you are ready.";
  }
  if (state.reason === "not-ready") {
    return "We are still checking this patch. You can browse its listed pubs while we do.";
  }
  if (state.reason === "unknown") {
    return "We do not have a route page for this name yet. The map can still show what is listed.";
  }
  if (state.reason === "city-mismatch") {
    return "This patch is not part of this city's route data. Open the map to browse this city.";
  }
  return "We do not have route data for this city. Open its map to browse what is listed.";
}

export default async function NightAreaActivationPage({ params, searchParams }: PageProps) {
  const state = await readState({ params, searchParams });
  const area = state.area;
  const reviewed = reviewDate(area?.lastReviewedAt ?? null);
  const reviewExpires = reviewDate(area?.reviewExpiresAt ?? null);

  return (
    <main
      id="main"
      className="nightAreaActivationPage"
      data-area-state={state.kind}
      data-area-reason={state.reason}
    >
      <SiteNav />
      <section className="nightAreaActivationPage__shell" aria-labelledby="night-area-title">
        <p className="nightAreaActivationPage__eyebrow">{area ? "London pub patch" : "Map browse"}</p>
        <h1 id="night-area-title">{headingForState(state)}</h1>
        <p className="nightAreaActivationPage__intro">{introForState(state)}</p>

        {area ? (
          <div className="nightAreaActivationPage__evidence" aria-label={`${area.name} details`}>
            <p className="nightAreaActivationPage__description">{area.description}</p>
            <dl className="nightAreaActivationPage__facts">
              <div>
                <dt>Planning status</dt>
                <dd>{state.kind === "ready" ? "Ready to plan" : "Browse while we check it"}</dd>
              </div>
              <div>
                <dt>Transport</dt>
                <dd>{area.transportAnchors.join(", ")}</dd>
              </div>
              {reviewed ? (
                <div>
                  <dt>Last checked</dt>
                  <dd>{reviewed}{reviewExpires ? ` · review through ${reviewExpires}` : ""}</dd>
                </div>
              ) : null}
            </dl>
          </div>
        ) : null}

        <Link
          className="nightAreaActivationPage__primary"
          data-primary-action="true"
          href={state.primaryAction.href}
        >
          {state.primaryAction.label}
        </Link>
      </section>
    </main>
  );
}
