import { firstHttp } from "@/lib/httpUrl";

type PricePublisherRecord = {
  pub_url?: string;
};

type NamedPriceSource = {
  label: string;
  url: string;
};

function publisherLabelForUrl(sourceUrl: string): string {
  const hostname = new URL(sourceUrl).hostname.toLocaleLowerCase("en-GB");
  if (hostname === "pint-prices.com" || hostname.endsWith(".pint-prices.com")) {
    return "Pint Prices";
  }
  return hostname.replace(/^www\./, "");
}

/** Named publisher carried by the price record itself, or null when absent. */
export function namedLegacyPintPriceSource(
  price: PricePublisherRecord,
): NamedPriceSource | null {
  const url = firstHttp(price.pub_url);
  if (!url) return null;
  return {
    label: publisherLabelForUrl(url),
    url,
  };
}
