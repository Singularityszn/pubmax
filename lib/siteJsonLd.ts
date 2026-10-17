import { BRAND_NAME } from "@/lib/brandNaming";
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

const SITE_ORGANIZATION_ID = `${PRODUCTION_SITE_ORIGIN}/#organization`;
const SITE_WEBSITE_ID = `${PRODUCTION_SITE_ORIGIN}/#website`;

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
    logo: `${PRODUCTION_SITE_ORIGIN}/brand/icon.svg`,
    founder: {
      "@type": "Person",
      name: "Karan Manoharan",
      url: "https://x.com/karansznx",
    },
    sameAs: ["https://x.com/karansznx", "https://github.com/karanmrn"],
  },
];
