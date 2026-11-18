import { OPEN_CRAWL_ARRIVAL_CLOSE_MS } from "@/lib/nightWindows";

const SEE_AGAIN_CHOICE_MS = 72 * 60 * 60 * 1000;
export const SEE_AGAIN_MUTUAL_MS = 30 * 24 * 60 * 60 * 1000;
export type SeeAgainPairState = "open" | "mutual" | "closed";
export type SeeAgainPairEvent = "form" | "withdraw" | "invalidate";
export function nextSeeAgainPair(state: SeeAgainPairState, event: SeeAgainPairEvent): SeeAgainPairState {
  switch (event) {
    case "invalidate": return "closed";
    case "form": return state === "open" ? "mutual" : state;
    case "withdraw": return "closed";
  }
}
export function seeAgainWindow(startsAt: number) {
  const opensAt = startsAt + OPEN_CRAWL_ARRIVAL_CLOSE_MS;
  return { opensAt, closesAt: opensAt + SEE_AGAIN_CHOICE_MS };
}
export type SeeAgainItem = { memberId: string; handle: string; choice: "none" | "chosen" | "withdrawn"; mutual: boolean };
export type SeeAgainDTO = { open: boolean; closesAt: string; items: SeeAgainItem[] };
export type SeeAgainOwnRecord = {
  crewId: string; pickedMemberId: string; context: "friendship"; choice: "chosen" | "withdrawn";
  chosenAt: string; withdrawnAt: string | null;
};
const instant = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value));
const uuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
export function parseSeeAgain(value: unknown): SeeAgainDTO | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.open !== "boolean" || !instant(v.closesAt) || !Array.isArray(v.items) || v.items.length > 20) return null;
  const items: SeeAgainItem[] = [], seen = new Set<string>();
  for (const raw of v.items) {
    if (!raw || typeof raw !== "object") return null;
    const item = raw as Record<string, unknown>;
    if (!uuid(item.memberId) || seen.has(item.memberId) || typeof item.handle !== "string" || !item.handle.trim()
      || !["none", "chosen", "withdrawn"].includes(String(item.choice)) || typeof item.mutual !== "boolean"
      || (item.mutual && item.choice === "withdrawn")) return null;
    seen.add(item.memberId);
    items.push({ memberId: item.memberId, handle: item.handle, choice: item.choice as SeeAgainItem["choice"], mutual: item.mutual });
  }
  return { open: v.open, closesAt: v.closesAt, items };
}
export function parseSeeAgainOwnRecords(value: unknown): SeeAgainOwnRecord[] | null {
  if (!Array.isArray(value)) return null;
  const records: SeeAgainOwnRecord[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") return null;
    const row = raw as Record<string, unknown>;
    if (!uuid(row.crewId) || !uuid(row.pickedMemberId) || row.context !== "friendship" || (row.choice !== "chosen" && row.choice !== "withdrawn")
      || !instant(row.chosenAt) || (row.withdrawnAt !== null && !instant(row.withdrawnAt))
      || (row.choice === "withdrawn") !== (row.withdrawnAt !== null)) return null;
    records.push({ crewId: row.crewId, pickedMemberId: row.pickedMemberId, context: row.context, choice: row.choice,
      chosenAt: row.chosenAt, withdrawnAt: row.withdrawnAt as string | null });
  }
  return records;
}

export type SeeAgainView =
  | { phase: "loading"; scope: string }
  | { phase: "hidden"; scope: string }
  | { phase: "failed"; scope: string }
  | { phase: "ready" | "saving"; scope: string; data: SeeAgainDTO; notice: "saved" | "failed" | null };
export type SeeAgainEvent =
  | { type: "reset"; scope: string }
  | { type: "loaded"; scope: string; data: SeeAgainDTO }
  | { type: "hidden" | "failed" | "save" | "saved"; scope: string };
export function nextSeeAgainView(state: SeeAgainView, event: SeeAgainEvent): SeeAgainView {
  if (event.type === "reset") return { phase: "loading", scope: event.scope };
  if (event.scope !== state.scope) return state;
  switch (event.type) {
    case "loaded": return { phase: "ready", scope: state.scope, data: event.data, notice: null };
    case "hidden": return { phase: "hidden", scope: state.scope };
    case "failed": return { phase: "failed", scope: state.scope };
    case "save": return state.phase === "ready" ? { ...state, phase: "saving", notice: null } : state;
    case "saved": return state.phase === "ready" ? { ...state, notice: "saved" } : state;
  }
}

export type SeeAgainVisibleConnection = { crewId: string; memberId: string; context: "friendship" };
export function parseSeeAgainVisibleConnections(value: unknown): SeeAgainVisibleConnection[] | null {
  if (!Array.isArray(value)) return null;
  const result: SeeAgainVisibleConnection[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") return null;
    const row = raw as Record<string, unknown>;
    if (!uuid(row.crewId) || !uuid(row.memberId) || row.context !== "friendship") return null;
    result.push({ crewId: row.crewId, memberId: row.memberId, context: row.context });
  }
  return result;
}
