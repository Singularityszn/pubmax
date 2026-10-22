export const FRIEND_LOCATION_RECIPIENT_MAX = 20;
export const FRIEND_LOCATION_FRESH_MS = 120_000;
export const FRIEND_LOCATION_POLL_MS = 15_000;
export type FriendLocationPoint = { latitude: number; longitude: number; accuracy: number };
export type FriendLocationSession = {
  sessionId: string; revision: number; expiresAt: string; recipients: string[]; accuracy: number;
};
export type SharedFriendLocation = FriendLocationPoint & {
  profileId: string; handle: string; updatedAt: string; expiresAt: string;
};
export type FriendLocationRead = {
  ok: true;
  generation: number;
  own: FriendLocationSession | null;
  mutuals: { profileId: string; handle: string }[];
  friends: SharedFriendLocation[];
};
export type FriendLocationWrite = { ok: true; generation: number; own: FriendLocationSession | null };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function friendLocationId(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}
export function friendLocationPoint(value: unknown): value is FriendLocationPoint & Record<string, unknown> {
  if (!value || typeof value !== "object") return false;
  const point = value as FriendLocationPoint;
  return Number.isFinite(point.latitude) && Math.abs(point.latitude) <= 90 &&
    Number.isFinite(point.longitude) && Math.abs(point.longitude) <= 180 &&
    Number.isFinite(point.accuracy) && point.accuracy >= 0 && point.accuracy <= 100_000;
}
