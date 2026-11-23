"use client";

import { useLayoutEffect, useRef, type ComponentProps } from "react";
import SurfaceNav from "@/components/ui/surface-nav";

type DragHandlers = Pick<ComponentProps<"div">, "onPointerDown" | "onPointerMove" | "onPointerUp" | "onPointerCancel">;

export function PlannerDrawerHeader({ title, kicker, navigation, drag }: {
  title?: string;
  kicker?: string;
  navigation: ComponentProps<typeof SurfaceNav>;
  drag: DragHandlers;
}) {
  const headRef = useRef<HTMLDivElement>(null);
  // A walk's title is pinned over the scrolling drawer, and it wraps at large
  // text. The drawer reads its height to land an opened stop below it.
  useLayoutEffect(() => {
    const head = headRef.current;
    const drawer = head?.closest<HTMLElement>(".mapDrawer");
    if (!title || !head || !drawer) return;
    const measure = () => drawer.style.setProperty("--curated-walk-header-height", `${head.getBoundingClientRect().height}px`);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(head);
    return () => {
      observer.disconnect();
      drawer.style.removeProperty("--curated-walk-header-height");
    };
  }, [title]);

  return (
    <div ref={headRef} className="mapDrawerHead sheetDragHandle plannerSheetHead" {...drag}>
      <span className="venueSheetGrabZone" aria-hidden="true"><span className="venueSheetGrab" /></span>
      {title ? <div className="curatedWalkDrawerTitle"><p className="curatedWalkKicker">{kicker}</p><h2>{title}</h2></div> : null}
      <SurfaceNav {...navigation} />
    </div>
  );
}
