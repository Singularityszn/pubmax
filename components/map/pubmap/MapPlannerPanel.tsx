"use client";

import dynamic from "next/dynamic";
import { MapPinned } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

import type { CuratedCrawl } from "@/lib/curatedCrawls";
import type { NightAreaSlug } from "@/lib/nightAreas";
import { phonePlannerOrder, plannerDefaultDrinkSelection } from "@/lib/pubMap";
import type { Filters, Venue } from "@/lib/venues";

const MobilePlanEntry = dynamic(
  () => import("@/components/plan/MobilePlanEntry").then((m) => m.MobilePlanEntry),
  { ssr: false },
);
const ControlRail = dynamic(() => import("@/components/map/ControlRail"), { ssr: false });
const RoutePanel = dynamic(() => import("@/components/map/RoutePanel"), { ssr: false });

type MapPlannerPanelProps = {
  open: boolean;
  mobileViewport: boolean;
  isLondon: boolean;
  activeCrawl: CuratedCrawl | null;
  selectedVenue: Venue | null | undefined;
  selectedWalkStopId: string;
  experienceLens: Parameters<typeof plannerDefaultDrinkSelection>[0];
  filters: Filters;
  phonePlanArea: { slug: NightAreaSlug } | null;
  mapDisplayName: string;
  onExit: () => void;
  phone: Omit<ComponentProps<typeof MobilePlanEntry>, "initialNightArea" | "defaultDrinkSelection">;
  controls: ComponentProps<typeof ControlRail>;
  panel: Omit<ComponentProps<typeof RoutePanel>, "activeVenueId" | "crawlBlurb" | "crawlName" | "crawlId" | "stopsFirst">;
  children: ReactNode;
};

export default function MapPlannerPanel({
  open, mobileViewport, isLondon, activeCrawl, selectedVenue, selectedWalkStopId,
  experienceLens, filters, phonePlanArea, mapDisplayName, onExit, phone, controls, panel, children,
}: MapPlannerPanelProps) {
  if (!open) return null;
  const plannerDrinkSelection = experienceLens === "all" ? filters : undefined;
  const phoneDescribeForm = mobileViewport && isLondon ? (
    <MobilePlanEntry
      {...phone}
      key="phone-describe-form"
      initialNightArea={phonePlanArea?.slug ?? null}
      defaultDrinkSelection={plannerDefaultDrinkSelection(experienceLens, plannerDrinkSelection)}
    />
  ) : null;
  const builtCrawlLeads = phonePlannerOrder({
    mobileViewport, mode: panel.mode, builtCount: panel.builtIds.length,
  }) === "build-first";
  const [plannerHead, plannerFoot] = builtCrawlLeads
    ? [null, phoneDescribeForm]
    : [phoneDescribeForm, null];

  return (
    <RoutePanel
      {...panel}
      controls={
        <>
          {plannerHead}
          {!mobileViewport ? (
            <button type="button" className="plannerMapButton" onClick={onExit}>
              <MapPinned size={16} aria-hidden="true" />
              View {mapDisplayName} map
            </button>
          ) : null}
          {!mobileViewport ? <ControlRail {...controls} /> : null}
        </>
      }
      foot={plannerFoot}
      activeVenueId={selectedWalkStopId || selectedVenue?.id}
      crawlBlurb={activeCrawl?.blurb}
      crawlName={activeCrawl?.name}
      crawlId={activeCrawl?.id}
      stopsFirst={builtCrawlLeads}
    >
      {children}
    </RoutePanel>
  );
}
