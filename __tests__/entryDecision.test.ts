import { describe, expect, it } from "vitest";

// Contract tests for the entry-decision seam (lib/entryDecision.ts, issue
// #439). Precedence under test: deep links bypass untouched (shell or not),
// then app-shell opens at the root land on /tonight (native first-run keeps
// the one-time map onboarding), then the browser keeps the landing page.
import {
  decideEntry,
  isAppShell,
  SHELL_START_PATH,
  type EntryContext,
} from "@/lib/entryDecision";

const WEB_ROOT: EntryContext = {
  path: "/",
  isNativeShell: false,
  isStandaloneDisplay: false,
  isNativeFirstRun: false,
};

describe("decideEntry", () => {
  it("locks the shell start surface to /tonight", () => {
    expect(SHELL_START_PATH).toBe("/tonight");
  });

  it("web default: a browser visit at the root keeps the landing page", () => {
    expect(decideEntry(WEB_ROOT)).toEqual({ kind: "stay", reason: "web-default" });
  });

  it("native shell cold start at the root lands on /tonight", () => {
    expect(decideEntry({ ...WEB_ROOT, isNativeShell: true })).toEqual({
      kind: "route",
      href: SHELL_START_PATH,
      reason: "shell-cold-start",
    });
  });

  it("installed-PWA standalone launch at the root lands on /tonight", () => {
    expect(decideEntry({ ...WEB_ROOT, isStandaloneDisplay: true })).toEqual({
      kind: "route",
      href: SHELL_START_PATH,
      reason: "shell-cold-start",
    });
  });

  it("genuine native first-run keeps the map onboarding redirect", () => {
    expect(
      decideEntry(
        { ...WEB_ROOT, isNativeShell: true, isNativeFirstRun: true },
        "/map",
      ),
    ).toEqual({ kind: "route", href: "/map", reason: "native-first-run" });
  });

  it("first-run is native-only: a spurious flag never sends a PWA to onboarding", () => {
    expect(
      decideEntry({ ...WEB_ROOT, isStandaloneDisplay: true, isNativeFirstRun: true }),
    ).toEqual({ kind: "route", href: SHELL_START_PATH, reason: "shell-cold-start" });
  });

  it("deep links bypass untouched in the native shell", () => {
    expect(
      decideEntry({ ...WEB_ROOT, path: "/plan/abc123", isNativeShell: true }),
    ).toEqual({ kind: "stay", reason: "deep-link" });
  });

  it("deep links bypass untouched in a standalone PWA", () => {
    expect(
      decideEntry({ ...WEB_ROOT, path: "/pubs/the-crossing", isStandaloneDisplay: true }),
    ).toEqual({ kind: "stay", reason: "deep-link" });
  });

  it("deep links bypass even when the first-run gate is open", () => {
    expect(
      decideEntry({
        ...WEB_ROOT,
        path: "/add/karan",
        isNativeShell: true,
        isNativeFirstRun: true,
      }),
    ).toEqual({ kind: "stay", reason: "deep-link" });
  });

  it("a web deep link never routes anywhere, including /tonight itself", () => {
    expect(decideEntry({ ...WEB_ROOT, path: "/tonight" })).toEqual({
      kind: "stay",
      reason: "deep-link",
    });
  });

  it("never redirects to the landing page from anywhere", () => {
    const contexts: EntryContext[] = [
      WEB_ROOT,
      { ...WEB_ROOT, isNativeShell: true },
      { ...WEB_ROOT, isStandaloneDisplay: true },
      { ...WEB_ROOT, isNativeShell: true, isNativeFirstRun: true },
      { ...WEB_ROOT, path: "/feed", isNativeShell: true },
    ];
    for (const ctx of contexts) {
      const decision = decideEntry(ctx);
      if (decision.kind === "route") expect(decision.href).not.toBe("/");
    }
  });
});

describe("isAppShell", () => {
  it("true for the native shell, the standalone PWA, and both together", () => {
    expect(isAppShell({ isNativeShell: true, isStandaloneDisplay: false })).toBe(true);
    expect(isAppShell({ isNativeShell: false, isStandaloneDisplay: true })).toBe(true);
    expect(isAppShell({ isNativeShell: true, isStandaloneDisplay: true })).toBe(true);
  });

  it("false on the plain web", () => {
    expect(isAppShell({ isNativeShell: false, isStandaloneDisplay: false })).toBe(false);
  });
});
