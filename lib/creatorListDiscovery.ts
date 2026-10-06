import type { Route } from "next";

export type CreatorListProfile = {
  handle: string;
  displayName?: string;
  avatarUrl?: string;
};

type CreatorListPreviewVenue = {
  venueId: string;
  venueName: string;
  venueMapUrl: Route;
};

export type CreatorListDiscoveryItem = {
  ownerHandle: string;
  ownerDisplayName?: string;
  ownerAvatarUrl?: string;
  listType: string;
  listUrl: Route;
  mapUrl: Route;
  planUrl: Route;
  savedCount: number;
  updatedAt: string;
  previewVenues: CreatorListPreviewVenue[];
};

export type CreatorListDiscoveryResult = {
  status: "ready" | "degraded";
  lists: CreatorListDiscoveryItem[];
  nextCursor: string | null;
};
