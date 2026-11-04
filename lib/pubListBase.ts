// The words every priced-pub count uses for its base, in a leaf with no
// imports so a client module (lib/pintSavings.ts) can print them without
// pulling the coverage reader into its bundle. lib/pricedPubCount.ts owns the
// counts and re-exports these.

/** The base every count names, in the same words on every page. */
export const PUB_LIST_BASE = "our London pub list";

/** "939 pubs in our London pub list with a listed price", the base of an average. */
export function averageBasePhrase(cohortSize: number): string {
  return `${cohortSize.toLocaleString("en-GB")} ${cohortSize === 1 ? "pub" : "pubs"} in ${PUB_LIST_BASE} with a listed price`;
}
