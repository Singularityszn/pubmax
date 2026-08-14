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
  waitForAuthChrome?: boolean;
};

export const AUDITED_ORIGINS: AuditedOrigin[];
export const AUDITED_ROUTES: AuditedRoute[];
export function selectAuditedOrigins(filter?: string): AuditedOrigin[];
export function selectAuditedRoutes(filter?: string): AuditedRoute[];
export function navigateToAuditedRoute(
  page: Page,
  originUrl: string,
  route: AuditedRoute,
  timeout?: number,
): Promise<void>;
