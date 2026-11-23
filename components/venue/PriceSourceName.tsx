import type { AnchorHTMLAttributes } from "react";

import { LINK_UNAVAILABLE, priceSourceOf } from "@/lib/priceSourceLink";

type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "children" | "target" | "rel">;

/**
 * A price's publisher in the words docs/VOICE.md sets: a link when its URL is
 * safe, the label and "Link unavailable." when it is not, and "Publisher not
 * recorded" only when the record names no one. lib/priceSourceLink.ts decides.
 */
export default function PriceSourceName({ label, url, ...link }: LinkProps & {
  label: string | null | undefined;
  url: unknown;
}) {
  const source = priceSourceOf(label, url);
  if (source.kind === "missing") return <>Publisher not recorded</>;
  if (source.kind === "refused") return <>{source.label}. {LINK_UNAVAILABLE}</>;
  return <a {...link} href={source.href} target="_blank" rel="noopener noreferrer">{source.label}</a>;
}
