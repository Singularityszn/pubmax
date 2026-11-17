"use client";

import type { ComponentProps } from "react";
import SurfaceNav from "@/components/ui/surface-nav";

type DragHandlers = Pick<ComponentProps<"div">, "onPointerDown" | "onPointerMove" | "onPointerUp" | "onPointerCancel">;

export function PlannerDrawerHeader({ title, kicker, navigation, drag }: {
  title?: string;
  kicker?: string;
  navigation: ComponentProps<typeof SurfaceNav>;
  drag: DragHandlers;
}) {
  return (
    <div className="mapDrawerHead sheetDragHandle plannerSheetHead" {...drag}>
      <span className="venueSheetGrabZone" aria-hidden="true"><span className="venueSheetGrab" /></span>
      {title ? <div className="curatedWalkDrawerTitle"><p className="curatedWalkKicker">{kicker}</p><h2>{title}</h2></div> : null}
      <SurfaceNav {...navigation} />
    </div>
  );
}
