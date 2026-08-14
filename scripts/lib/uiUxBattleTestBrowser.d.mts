import type { LaunchOptions } from "playwright";

export const UI_UX_CHROMIUM_ARGS: string[];
export function uiUxChromiumLaunchOptions(channel?: string): LaunchOptions;
export function isLocalUiUxAuditOrigin(originUrl: string): boolean;
export function uiUxAuditContextOptions(originUrl: string): {
  reducedMotion?: "reduce";
};
export function uiUxChromiumProjectUse(channel?: string): {
  channel?: "chrome";
  launchOptions: { args?: string[] };
};
