// The one owner of the host attendance panel's lifecycle (migration 0247). Pure: the
// component sends events and renders the view. A refresh keeps the rows a host already
// sees, so a conflict never unmounts the control they pressed. Only a refusal to read
// (the viewer lost access) clears them.

import type { CrewAttendanceDTO, CrewAttendanceItem, CrewAttendanceRefusal, CrewAttendanceState } from "@/lib/crewAttendance";

export type CrewAttendanceNotice =
  | { kind: "saved"; memberId: string; state: CrewAttendanceState }
  | { kind: "refused"; reason: CrewAttendanceRefusal }
  | { kind: "failed" };

export type CrewAttendanceView =
  | { status: "loading" }
  | { status: "hidden" }
  | { status: "unavailable" }
  | {
      status: "ready";
      data: CrewAttendanceDTO;
      beforeOpen: boolean;
      /** The next opening or closing, when the read must be taken again. One object per read. */
      boundary: { refreshAt: number | null };
      refreshing: boolean;
      saving: { memberId: string; state: CrewAttendanceState } | null;
      notice: CrewAttendanceNotice | null;
    };

export type CrewAttendanceEvent =
  | { type: "refresh" }
  | { type: "loaded"; data: CrewAttendanceDTO; now: number }
  | { type: "missing" }
  | { type: "failed" }
  | { type: "save"; memberId: string; state: CrewAttendanceState }
  | { type: "saved"; memberId: string; state: CrewAttendanceState; revision: number; now: number }
  | { type: "refused"; reason: CrewAttendanceRefusal }
  | { type: "saveFailed" };

export const CREW_ATTENDANCE_LOADING: CrewAttendanceView = { status: "loading" };

function nextBoundary(data: CrewAttendanceDTO, now: number): number | null {
  const opensAt = Date.parse(data.opensAt);
  const closesAt = Date.parse(data.closesAt);
  return now < opensAt ? opensAt : now < closesAt ? closesAt : null;
}

export function nextCrewAttendanceView(view: CrewAttendanceView, event: CrewAttendanceEvent): CrewAttendanceView {
  switch (event.type) {
    case "refresh":
      return view.status === "ready" ? { ...view, refreshing: true } : CREW_ATTENDANCE_LOADING;
    case "loaded":
      return {
        status: "ready",
        data: event.data,
        beforeOpen: event.now < Date.parse(event.data.opensAt),
        boundary: { refreshAt: nextBoundary(event.data, event.now) },
        refreshing: false,
        saving: view.status === "ready" ? view.saving : null,
        notice: view.status === "ready" ? view.notice : null,
      };
    case "missing":
      return { status: "hidden" };
    case "failed":
      return { status: "unavailable" };
    default:
      break;
  }
  if (view.status !== "ready") return view;
  switch (event.type) {
    case "save":
      if (view.saving || view.refreshing || !view.data.open) return view;
      return { ...view, saving: { memberId: event.memberId, state: event.state }, notice: null };
    case "saved": {
      const recordedAt = new Date(event.now).toISOString();
      const items = view.data.items.map((item): CrewAttendanceItem => item.memberId !== event.memberId || event.revision <= item.revision ? item
        : { ...item, state: event.state, revision: event.revision, recordedAt, recordedBy: "host" });
      return { ...view, data: { ...view.data, items }, saving: null,
        notice: { kind: "saved", memberId: event.memberId, state: event.state } };
    }
    case "refused":
      return { ...view, saving: null, refreshing: true, notice: { kind: "refused", reason: event.reason } };
    case "saveFailed":
      return { ...view, saving: null, notice: { kind: "failed" } };
  }
}
