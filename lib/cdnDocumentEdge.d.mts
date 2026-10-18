export type CdnEdgeQueryCondition = { type: "query"; key: string };
export type CdnEdgeHeaderCondition = { type: "header"; key: string };

export declare const CDN_EDGE_DOCUMENT_PATHS: readonly string[];
export declare const CDN_EDGE_PROXY_QUERY_KEYS: Readonly<Record<string, readonly string[]>>;
export declare function cdnEdgeMatcherAlternatives(): string;
export declare function cdnEdgeProxyMatchers(): Array<{
  source: string;
  has: CdnEdgeQueryCondition[];
  missing: CdnEdgeHeaderCondition[];
}>;
export declare function cdnEdgeHeaderRules(contentSecurityPolicy: string): Array<{
  source: string;
  missing?: CdnEdgeQueryCondition[];
  headers: Array<{ key: string; value: string }>;
}>;
