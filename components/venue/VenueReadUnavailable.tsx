import EmptyState from "@/components/ui/empty-state";

/**
 * A pub we could not READ, on the Bar Tab and the Ledger.
 *
 * It is not the not-found card: that one says the pub may have moved or the
 * link is wrong, which over a pub the dataset holds is the wrong sentence and
 * the wrong door. Both pages read the bundled dataset three ways (`found`,
 * `absent`, `unavailable`) precisely so those two are worded apart, and they
 * share this one surface rather than each deciding again (astra-review P1-2).
 *
 * IT CLAIMS NOTHING ABOUT THE PUB. A read we could not run tells us nothing in
 * either direction, so it names only what we know: the failure was ours, and
 * the answer is unknown.
 *
 * Its one way onward is the SAME address, as a plain anchor, so the reader gets
 * a fresh document and a fresh server read rather than a held payload.
 */
export default function VenueReadUnavailable({
  href,
  eyebrow,
  eyebrowClassName,
}: {
  /** The address to retry: the reader's own. */
  href: string;
  /** The surface's own name, so the card reads as part of the page it sits on. */
  eyebrow: string;
  /** The surface's own eyebrow rule, so this card and the not-found card beside
   * it read at one size, weight and colour. */
  eyebrowClassName: string;
}): React.JSX.Element {
  return (
    <>
      <p className={eyebrowClassName}>{eyebrow}</p>
      <EmptyState title="We could not load this pub" action={<a href={href}>Try again</a>}>
        Our end could not answer just now, so nothing here is a reading of this
        pub. Whether it is here is a thing this page could not find out.
      </EmptyState>
    </>
  );
}
