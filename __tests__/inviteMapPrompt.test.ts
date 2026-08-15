import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { InviteMapPrompt } from "@/components/plan/PlanInviteRsvp";
import {
  inviteRsvpDeviceKey,
  markDeviceRsvpCommitted,
  readDeviceRsvpCommitted,
} from "@/lib/planInvite";

function memoryStorage(seed: Record<string, string> = {}) {
  const values = new Map<string, string>(Object.entries(seed));
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, String(value)); },
  };
}

describe("InviteMapPrompt", () => {
  it("announces a committed RSVP without inventing a map destination", () => {
    const html = renderToStaticMarkup(
      createElement(InviteMapPrompt, { committed: true, venueIds: [" "] }),
    );

    expect(html).toContain("RSVP saved.");
    expect(html).not.toContain("Open these stops on the map");
  });

  it("uses the canonical selected-Venue URL for one valid Crawl Stop", () => {
    const html = renderToStaticMarkup(
      createElement(InviteMapPrompt, { committed: true, venueIds: [" venue-1 "] }),
    );

    expect(html).toContain('href="/map?sel=venue-1"');
    expect(html).toContain("Open these stops on the map");
  });

  it("still reaches the stops before this browser commits an RSVP", () => {
    // The regression this pins: gating the link on a live RSVP left a guest who
    // reloaded, returned the next day, answered on another device, or was
    // already Going before the deploy with no way to the stops at all.
    const html = renderToStaticMarkup(
      createElement(InviteMapPrompt, { committed: false, venueIds: ["venue-1"] }),
    );

    expect(html).toContain('href="/map?sel=venue-1"');
    expect(html).toContain("Open these stops on the map");
    expect(html).not.toContain("RSVP saved.");
  });

  it("keeps one live region on the page, not a second beside the form", () => {
    const html = renderToStaticMarkup(
      createElement(InviteMapPrompt, { committed: true, venueIds: ["venue-1"] }),
    );

    expect(html).not.toContain('role="status"');
  });
});

describe("device RSVP memory", () => {
  it("remembers a confirmed RSVP per Plan on this device", () => {
    const storage = memoryStorage();

    expect(readDeviceRsvpCommitted("plan-1", storage)).toBe(false);
    markDeviceRsvpCommitted("plan-1", storage);

    expect(readDeviceRsvpCommitted("plan-1", storage)).toBe(true);
    // Another Plan's invite on the same device is a separate question.
    expect(readDeviceRsvpCommitted("plan-2", storage)).toBe(false);
    expect(storage.values.get(inviteRsvpDeviceKey("plan-1"))).toBe("1");
  });

  it("answers false rather than throwing when storage is denied", () => {
    const denied = {
      getItem: () => { throw new Error("denied"); },
      setItem: () => { throw new Error("denied"); },
    };

    expect(readDeviceRsvpCommitted("plan-1", denied)).toBe(false);
    expect(() => markDeviceRsvpCommitted("plan-1", denied)).not.toThrow();
    expect(readDeviceRsvpCommitted("plan-1", null)).toBe(false);
    expect(readDeviceRsvpCommitted("   ", memoryStorage())).toBe(false);
  });
});
