import { outCardSource } from "@/lib/out/attribution";
import type { WhatsOnSource } from "@/lib/whatsOn";

type SourceCreditProps = {
  source: WhatsOnSource;
};

function SkiddleLogo() {
  return (
    <svg
      className="outSourceLogo"
      viewBox="0 0 88 20"
      width="72"
      height="16"
      aria-hidden="true"
      focusable="false"
    >
      <rect width="88" height="20" rx="3" fill="#111" />
      <text
        x="8"
        y="14"
        fill="#fff"
        fontFamily="system-ui, sans-serif"
        fontSize="11"
        fontWeight="700"
      >
        Skiddle
      </text>
    </svg>
  );
}

export function SourceCredit({ source }: SourceCreditProps) {
  const kind = outCardSource(source.label);
  return (
    <a
      className="outSourceCredit"
      href={source.url}
      rel="noopener noreferrer"
      target="_blank"
    >
      {kind === "skiddle" ? <SkiddleLogo /> : null}
      <span>{source.label}</span>
    </a>
  );
}
