import { parseCityId, DEFAULT_CITY_ID, type CityId } from "@/lib/cities";
import { londonServiceDayBounds } from "@/lib/whatsOn";
import type { WhatsOnKindObservedAt, WhatsOnRow } from "@/lib/whatsOn";
import {
  OPEN_PLAN_LIST_LIMIT,
  type OpenPlanPlaceKind,
} from "@/lib/openSocialCrew";

export const OUT_EVENT_LIMIT = 100;
export const OUT_OPEN_PLAN_LIMIT = OPEN_PLAN_LIST_LIMIT;
export const OUT_DAYS = ["today", "tomorrow", "weekend"] as const;
export type OutDay = (typeof OUT_DAYS)[number];
export type OutStatus = "ready" | "degraded";

export type OutAttribution = {
  label: string;
  logoRequired: boolean;
};

/**
 * The resolved Stop 1 a card renders: the place name plus its map point. It is
 * filled from the venue index or the ambient POI layer on the read, never
 * stored, so a renamed pub or a moved dot cannot go stale inside a plan.
 */
export type OutOpenPlanMeetingPoint = {
  kind: OpenPlanPlaceKind;
  name: string;
  lat: number;
  lng: number;
};

export type OutOpenPlan = {
  crewId: string;
  title: string;
  startTime: string;
  stopVenueId: string | null;
  stopVenueName: string | null;
  hostHandle: string;
  memberCount: number;
  /** Absent until the city read resolves Stop 1; a listed plan always has one. */
  meetingPoint: OutOpenPlanMeetingPoint | null;
};

export type OutResponse = {
  status: OutStatus;
  events: WhatsOnRow[];
  openPlans: OutOpenPlan[];
  attribution: OutAttribution[];
  kindObservedAt: WhatsOnKindObservedAt;
};

export function parseOutDay(value: string | null): OutDay {
  if (value === "tomorrow" || value === "weekend") return value;
  return "today";
}

export function parseOutCity(value: string | null): CityId {
  return parseCityId(value) ?? DEFAULT_CITY_ID;
}

/**
 * Inclusive lower bound for list_open_social_crews. Today starts at the
 * London service-day open. Tomorrow is the next service day. Weekend is
 * this Saturday when the week has not reached it, otherwise today's
 * service-day open so a Saturday reader still sees Saturday nights.
 */
export function outPlansFromIso(day: OutDay, now: number = Date.now()): string {
  const { start } = londonServiceDayBounds(now);
  const startMs = Date.parse(start);
  if (day === "today") return start;
  if (day === "tomorrow") {
    return new Date(startMs + 24 * 60 * 60 * 1000).toISOString();
  }
  const weekday = new Date(now).getUTCDay();
  // Saturday = 6, Sunday = 0. A weekend already in progress uses today.
  if (weekday === 0 || weekday === 6) return start;
  const daysUntilSaturday = (6 - weekday + 7) % 7;
  return new Date(startMs + daysUntilSaturday * 24 * 60 * 60 * 1000).toISOString();
}

export function boundOutOpenPlans(rows: OutOpenPlan[]): OutOpenPlan[] {
  return rows.slice(0, OUT_OPEN_PLAN_LIMIT);
}

export function boundOutEvents(rows: WhatsOnRow[]): WhatsOnRow[] {
  return rows.slice(0, OUT_EVENT_LIMIT);
}
