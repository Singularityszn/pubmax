import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { coarsenedViewerAccuracy, coarsenViewerPoint } from "@/lib/geo";
const source = (path: string) => readFileSync(path, "utf8");
describe("friend coordinate privacy", () => {
  it("uses the shared reduction and keeps a truthful accuracy radius", () => {
    const point = { lat: 51.50049, lng: -0.10049 };
    const reduced = coarsenViewerPoint(point);
    expect(coarsenedViewerAccuracy(point, reduced, 100)).toBeGreaterThan(150);
    expect(coarsenedViewerAccuracy(reduced, reduced, 110)).toBe(110);
  });
  it("opens no storage, analytics, model, URL or offline queue path", () => {
    for (const file of ["lib/friendLocationClient.ts", "lib/friendLocationService.server.ts", "components/map/friends/useFriendLocations.ts"]) {
      const code = source(file);
      expect(code).not.toMatch(/localStorage|sessionStorage|sendBeacon|trackEvent|posthog|URLSearchParams|console\.|outbox|openai/i);
    }
    expect(source("components/map/friends/useFriendLocations.ts")).toContain('cache: "no-store"');
    expect(source("components/map/friends/FriendLocationControl.tsx")).toContain("ph-no-capture");
    expect(source("components/map/friends/useFriendLocationMarkers.ts")).toContain('stage?.classList.add("ph-no-capture")');
    expect(source("components/map/friends/useFriendLocationMarkers.ts")).not.toMatch(/flyTo|easeTo|setCenter|jumpTo/);
  });
  it("schedules physical expiry cleanup and states recipient and retention practice", () => {
    const config = JSON.parse(source("vercel.json"));
    expect(config.crons).toContainEqual({ path: "/api/cron/purge-friend-locations", schedule: "* * * * *" });
    const privacy = source("app/privacy/page.tsx");
    expect(privacy).toContain("Up to 20 selected mutual friends");
    expect(privacy).toContain("only the latest point");
    expect(privacy).toContain("every minute");
  });
});
