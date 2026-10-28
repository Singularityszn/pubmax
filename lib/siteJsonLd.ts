import { BRAND_NAME } from "@/lib/brandNaming";
import { HELLO_EMAIL } from "@/lib/siteContact";
import { PRODUCTION_SITE_ORIGIN } from "@/lib/siteUrlConfig.mjs";
import { SITE_PRODUCT_DESCRIPTION } from "@/lib/siteProductCopy";

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

/** Site-wide Organization + WebSite graph (root layout JSON-LD). */
export const siteJsonLd = [
  {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": SITE_WEBSITE_ID,
    name: BRAND_NAME,
    alternateName: [...SITE_BRAND_ALTERNATE_NAMES],
    url: PRODUCTION_SITE_ORIGIN,
    description: SITE_PRODUCT_DESCRIPTION,
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

/**
 * Homepage-only page and free-app identity, linked to the site-wide graph.
 * This markup does not claim Google software-app rich-result eligibility.
 */
export const homeJsonLd = [
  {
    "@context": "https://schema.org",
    "@type": "WebPage",
    "@id": `${PRODUCTION_SITE_ORIGIN}/#webpage`,
    name: BRAND_NAME,
    url: PRODUCTION_SITE_ORIGIN,
    description: SITE_PRODUCT_DESCRIPTION,
    isPartOf: { "@id": SITE_WEBSITE_ID },
    mainEntity: { "@id": `${PRODUCTION_SITE_ORIGIN}/#app` },
    inLanguage: "en-GB",
  },
  {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    "@id": `${PRODUCTION_SITE_ORIGIN}/#app`,
    name: BRAND_NAME,
    alternateName: [...SITE_BRAND_ALTERNATE_NAMES],
    url: PRODUCTION_SITE_ORIGIN,
    description: SITE_PRODUCT_DESCRIPTION,
    applicationCategory: "LifestyleApplication",
    isAccessibleForFree: true,
    inLanguage: "en-GB",
    publisher: { "@id": SITE_ORGANIZATION_ID },
    // The homepage states that the app is free. No app ratings are published.
    offers: {
      "@type": "Offer",
      price: 0,
      priceCurrency: "GBP",
      url: PRODUCTION_SITE_ORIGIN,
    },
  },
];
