export type AnalyticsEnvironment =
  | "production"
  | "preview"
  | "development"
  | "internal-test";

export declare const ANALYTICS_ENVIRONMENTS: readonly AnalyticsEnvironment[];

export declare const ANALYTICS_SCHEMA_VERSION: number;

export declare const DEFAULT_ANALYTICS_ENVIRONMENT: AnalyticsEnvironment;

export declare const ANALYTICS_RELEASE_LENGTH: number;

export interface AnalyticsAttribution {
  environment: AnalyticsEnvironment;
  release: string | null;
}

export interface AnalyticsAttributionProps {
  environment: AnalyticsEnvironment;
  release?: string;
  schema_version: number;
}

export declare function isAnalyticsEnvironment(value: unknown): value is AnalyticsEnvironment;

export declare function resolveAnalyticsEnvironment(
  env?: Record<string, string | undefined>,
): AnalyticsEnvironment;

export declare function normalizeAnalyticsRelease(value: unknown): string | null;

export declare function readAnalyticsAttribution(
  env?: Record<string, string | undefined>,
): AnalyticsAttribution;

export declare function analyticsAttributionProps(
  attribution: AnalyticsAttribution,
): AnalyticsAttributionProps;

export declare function analyticsBuildEnv(
  env?: Record<string, string | undefined>,
): { PUBMAX_ANALYTICS_ENVIRONMENT: AnalyticsEnvironment };

export declare function currentAnalyticsAttribution(): AnalyticsAttribution;

export declare function currentAnalyticsAttributionProps(): AnalyticsAttributionProps;
