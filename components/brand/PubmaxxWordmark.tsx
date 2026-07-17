import "./pubmaxxWordmark.css";

function XGlyph(): React.JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M1.8 2h3.35l9.05 12h-3.35L1.8 2Z" />
      <path d="M11.95 2h2.25L4.05 14H1.8L11.95 2Z" />
    </svg>
  );
}

export default function PubmaxxWordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`pubmaxxWordmark ${className}`.trim()}>
      <span className="pubmaxxWordmarkSr">PUBMAXXING</span>
      <span aria-hidden="true">PUBMA</span>
      <span className="pubmaxxDoubleX" aria-hidden="true"><XGlyph /><XGlyph /></span>
      <span aria-hidden="true">ING</span>
    </span>
  );
}
