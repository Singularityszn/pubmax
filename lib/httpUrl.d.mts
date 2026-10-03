export declare function isHttpUrl(
  value: unknown,
  options?: { allowWhitespace?: boolean },
): value is string;

export declare function firstHttp(...candidates: Array<string | undefined | null>): string;

export declare function firstHttps(...candidates: Array<string | undefined | null>): string;
