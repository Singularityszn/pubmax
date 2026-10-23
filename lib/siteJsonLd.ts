import { BRAND_NAME } from "@/lib/brandNaming";
import { HELLO_EMAIL } from "@/lib/siteContact";
import { PRODUCTION_SITE_ORIGIN } from "@/lib/siteUrlConfig.mjs";

/**
 * Closed alternate spellings searchers use for the product. PUBMAXX is the one
 * name (lib/brandNaming.ts); the domain's spelling is an alternate, because
 * people search for the word in the address.
 */
const SITE_BRAND_ALTERNATE_NAMES = [
  "PubMaxxing",
  "PUBMAXXING",
  "PubMaxx",
  "Pubmax",
  "Pub Maxxing",
  "Pubmaxing",
] as const;

export const SITE_ORGANIZATION_ID = `${PRODUCTION_SITE_ORIGIN}/#organization`;
export const SITE_WEBSITE_ID = `${PRODUCTION_SITE_ORIGIN}/#website`;

const SITE_DESCRIPTION =
  "PUBMAXX is a London pub map and crawl planner with listed pint prices, explicit source status and cited pub history.";

/** Site-wide Organization + WebSite graph (root layout JSON-LD). */
export const siteJsonLd = [
  {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": SITE_WEBSITE_ID,
    name: BRAND_NAME,
    alternateName: [...SITE_BRAND_ALTERNATE_NAMES],
    url: PRODUCTION_SITE_ORIGIN,
    description: SITE_DESCRIPTION,
    publisher: { "@id": SITE_ORGANIZATION_ID },
  },
  {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": SITE_ORGANIZATION_ID,
    name: BRAND_NAME,
    alternateName: [...SITE_BRAND_ALTERNATE_NAMES],
    url: PRODUCTION_SITE_ORIGIN,
    // A raster logo: Google's Organization logo needs a crawlable image of at
    // least 112x112, and a PNG is the format every consumer of it reads.
    logo: `${PRODUCTION_SITE_ORIGIN}/brand/icon-512.png`,
    email: HELLO_EMAIL,
    founder: {
      "@type": "Person",
      name: "Karan Manoharan",
      url: "https://x.com/karansznx",
      sameAs: ["https://x.com/karansznx", "https://github.com/karanmrn"],
    },
  },
];
