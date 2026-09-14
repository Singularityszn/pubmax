export declare const WETHERSPOON_DIRECTORY_SOURCE_ID: "wetherspoon-pub-directory";

/** One page of one collection on the directory's API, derived from the register entry. */
export declare function wetherspoonDirectoryEndpoint(
  collection: "pubs" | "facilities" | "region" | "pub-status",
  page: number,
): string;
