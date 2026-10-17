// @vitest-environment jsdom

// The invite loop's two ends, measured honestly.
//
// SENT: every share button that opened WhatsApp with a "noopener" feature read
// the spec's null as a blocked popup, so the tab opened, the drinker was told
// it had not, and plan_invite_sent never reached PostHog. lib/openExternalTab.ts
// is the one way such a tab opens now.
//
// OPENED: plan_invite_opened fired on every plan page load, the host's own
// landing after Lock included, so a lock read as a guest arriving a second
// later. The host is not an invite open.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));

import PlanInviteOpened, { isInviteOpen } from "@/components/plan/PlanInviteOpened";
import { trackEvent } from "@/lib/analytics";
import { openExternalTab } from "@/lib/openExternalTab";
import { clearPlanCapability, writePlanCapability } from "@/lib/planSessionCapability";
import { shareNightObject } from "@/lib/shareSheet";

const PLAN = "6a7d6f2e-0c1a-4c4b-9c3d-1f2a3b4c5d6e";

function specWindowOpen() {
  return vi.fn((_url?: string, _target?: string, features?: string) => (
    features?.includes("noopener") ? null : ({ opener: window } as unknown as Window)
  ));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  clearPlanCapability(PLAN);
  window.location.hash = "";
});

describe("openExternalTab", () => {
  it("answers true when the tab opened, and leaves it no handle on this page", () => {
    const tab = { opener: window } as unknown as Window;
    const open = vi.fn().mockReturnValue(tab);
    vi.stubGlobal("open", open);

    expect(openExternalTab("https://wa.me/?text=hi")).toBe(true);
    expect(open).toHaveBeenCalledWith("https://wa.me/?text=hi", "_blank");
    expect(tab.opener).toBeNull();
  });

  it("answers false only when a blocker really ate the tab", () => {
    vi.stubGlobal("open", vi.fn().mockReturnValue(null));
    expect(openExternalTab("https://wa.me/?text=hi")).toBe(false);
  });

  it("is believed by the shared share sheet under a spec-faithful window.open", async () => {
    vi.stubGlobal("open", specWindowOpen());
    const outcome = await shareNightObject(
      { title: "Friday", text: "Friday", url: "https://pubmaxxing.com/plan/x" },
      { nav: {}, shareNatively: async () => "unavailable" },
    );
    expect(outcome).toBe("whatsapp");
  });
});

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx|mjs)$/.test(name) ? [path] : [];
  });
}

describe("no tab is opened with a feature that hides whether it opened", () => {
  it("leaves no window.open(..., \"noopener\") in app, components or lib", () => {
    const offenders = ["app", "components", "lib"]
      .flatMap((dir) => sourceFiles(join(process.cwd(), dir)))
      // The helper's own doc comment names the trap it replaces.
      .filter((file) => !file.endsWith(join("lib", "openExternalTab.ts")))
      // Bounded to one statement: a nested call's own parentheses sit between
      // the open paren and the feature string in every caller that had it.
      .filter((file) => /window\.open\([^;]{0,200}?noopener/.test(readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
  });
});

describe("an invite open is someone other than the host", () => {
  it("does not count the host, however they arrive", () => {
    expect(isInviteOpen({ hash: "", role: "host" })).toBe(false);
    expect(isInviteOpen({ hash: "#invite=abc", role: "host" })).toBe(false);
  });

  it("does not count the composer's hand-off after Lock", () => {
    expect(isInviteOpen({ hash: "#share", role: null })).toBe(false);
  });

  it("counts a guest or a stranger arriving on the link", () => {
    expect(isInviteOpen({ hash: "#invite=abc", role: null })).toBe(true);
    expect(isInviteOpen({ hash: "", role: "guest" })).toBe(true);
    expect(isInviteOpen({ hash: "", role: null })).toBe(true);
  });

  async function mountOpened() {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(createElement(PlanInviteOpened, { planId: PLAN }));
    });
    await act(async () => root.unmount());
    container.remove();
  }

  it("sends nothing on the host's own landing", async () => {
    writePlanCapability(PLAN, { token: "member-token", collaborationAuthorized: true, role: "host" });
    window.location.hash = "#share";
    await mountOpened();
    expect(trackEvent).not.toHaveBeenCalled();
  });

  it("sends plan_invite_opened for a stranger on the crew link", async () => {
    window.location.hash = "#invite=abc";
    await mountOpened();
    expect(trackEvent).toHaveBeenCalledWith("plan_invite_opened", { source: "shared-plan" });
  });
});
