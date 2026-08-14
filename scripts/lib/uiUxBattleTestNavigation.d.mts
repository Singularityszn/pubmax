import type { Page } from "playwright";

export type AuditedOrigin = {
  name: string;
  url: string;
};

export type AuditedRoute = {
  name: string;
  path: string;
  readySelector: string;
  pendingSelectors?: string[];
  pendingTexts?: string[];
  waitForAuthResolution?: boolean;
  waitForPaintedMap?: boolean;
};

export type AuditNavigationResult = {
  cls: number | null;
  clsSupported: boolean;
  clsBudget: number;
};

export const AUDITED_ORIGINS: AuditedOrigin[];
export const AUDITED_ROUTES: AuditedRoute[];
export const UI_UX_CLS_BUDGET: number;
export function selectAuditedOrigins(filter?: string): AuditedOrigin[];
export function selectAuditedRoutes(filter?: string): AuditedRoute[];
export function waitForAuditedRouteSettlement(
  page: Page,
  route: AuditedRoute,
  timeout?: number,
): Promise<AuditNavigationResult>;
export function navigateToAuditedRoute(
  page: Page,
  originUrl: string,
  route: AuditedRoute,
  timeout?: number,
): Promise<AuditNavigationResult>;
