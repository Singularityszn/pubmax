/** The public product description, shared by visible About copy and site identity. */
export const SITE_PRODUCT_DESCRIPTION =
  "PUBMAXX is a London pub map for comparing listed pint prices, planning crawls with friends and sharing routes.";

/** The homepage and its share card keep the same derived heritage count. */
export function homeProductDescription(historicPubs: number): string {
  return `London on one map, with ${historicPubs} historic pubs cited and a listed price wherever we hold one. Plan a crawl and share the route with your mates.`;
}
