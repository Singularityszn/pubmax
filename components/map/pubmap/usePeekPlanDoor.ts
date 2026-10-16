import { useState } from "react";

/**
 * THE PHONE PEEK'S ONE PLAN DOOR KEEPS ITS MEANING UNDER THE THUMB.
 *
 * The phone pub sheet carries ONE coral plan action (captain, 16 Oct 2026):
 * with no crawl being built it is "Make it Stop 1", which hands the pub to
 * Plan; with a crawl being built it is "Plan stop" / "In plan", which adds to
 * that crawl. Reading the crawl alone turned the toggle the reader had just
 * pressed into a navigation: removing the LAST stop emptied the crawl while
 * the sheet was still open, the same button node became "Make it Stop 1", and
 * a second tap in that spot left the map and abandoned the build session.
 *
 * So the door keeps the meaning its sheet opened with. It only ever latches
 * ON: a crawl started while the sheet is open still turns the door into the
 * crawl's, which is the direction the reader asked for. Closing the sheet
 * drops the latch, so the next pub reads the night again.
 */
export function usePeekPlanDoorBuildsCrawl({
  builtStopCount,
  selectedVenueId,
}: {
  builtStopCount: number;
  selectedVenueId: string;
}): boolean {
  // Adopted during render, the way VenueBuzz adopts the pub its read is about:
  // the first paint of a sheet must already carry the door it will keep.
  const [latchedVenueId, setLatchedVenueId] = useState("");
  const building = builtStopCount > 0;
  if (building && latchedVenueId !== selectedVenueId) setLatchedVenueId(selectedVenueId);
  else if (!selectedVenueId && latchedVenueId) setLatchedVenueId("");
  if (building) return true;
  return selectedVenueId !== "" && latchedVenueId === selectedVenueId;
}
