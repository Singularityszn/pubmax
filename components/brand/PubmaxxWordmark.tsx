import "./pubmaxxWordmark.css";
import PubmaxxMark, { type PubmaxxMarkVariant } from "./PubmaxxMark";

function XGlyph(): React.JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M1.8 2h3.35l9.05 12h-3.35L1.8 2Z" />
      <path d="M11.95 2h2.25L4.05 14H1.8L11.95 2Z" />
    </svg>
  );
}

export interface PubmaxxWordmarkProps {
  className?: string;
  /**
   * Show the Crossing mark locked up to the left of the wordmark. Off by
   * default so existing inline usages (nav, landing, chooser) are unchanged.
   * Spacing is governed by `.pubmaxxLockup` — the gap tracks the wordmark's
   * font-size (0.42em) so the lockup scales as one unit.
   */
  withMark?: boolean;
  /** Variant for the locked-up mark. Default "duo". Ignored unless withMark. */
  markVariant?: PubmaxxMarkVariant;
  /** Mark size in px. Default 1.05× the cap height reads best; tune per host. */
  markSize?: number;
}

export default function PubmaxxWordmark({
  className = "",
  withMark = false,
  markVariant = "duo",
  markSize = 22,
}: PubmaxxWordmarkProps) {
  const word = (
    <span className={`pubmaxxWordmark ${withMark ? "" : className}`.trim()}>
      <span className="pubmaxxWordmarkSr">PUBMAXXING</span>
      <span aria-hidden="true">PUBMA</span>
      <span className="pubmaxxDoubleX" aria-hidden="true">
        <XGlyph />
        <XGlyph />
      </span>
      <span aria-hidden="true">ING</span>
    </span>
  );

  if (!withMark) return word;

  return (
    <span className={`pubmaxxLockup ${className}`.trim()}>
      <PubmaxxMark variant={markVariant} size={markSize} />
      {word}
    </span>
  );
}
