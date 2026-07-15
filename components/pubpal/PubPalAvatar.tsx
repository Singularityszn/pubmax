import type { PubPalAppearance, PubPalSpecies, SignalFamily } from "@/lib/pubPal";
import "./pubPal.css";

const faces: Record<PubPalSpecies, string> = {
  hound: "◢ ᴥ ◣",
  raven: "◆ V ◆",
  fox: "◁ ᴥ ▷",
  cat: "⌃ ᴥ ⌃",
  rabbit: "⌇ ᴥ ⌇",
  turtle: "◉ ᴗ ◉",
  squirrel: "◔ ᴥ ◔",
  bot: "›_‹",
};

export function PubPalAvatar({ appearance, name, compact = false }: { appearance: PubPalAppearance; name: string; compact?: boolean }) {
  return (
    <div className={`palAvatar pal-${appearance.species} pal-${appearance.signalAffinity} ${compact ? "isCompact" : ""}`} role="img" aria-label={`${name}, a ${appearance.signalAffinity} hologram cyber ${appearance.species}`}>
      <span className="palHalo" aria-hidden="true" />
      <span className="palBody" aria-hidden="true"><i>{faces[appearance.species]}</i><b /></span>
      <span className="palParticles" aria-hidden="true">{Array.from({ length: 9 }, (_, index) => <i key={index} style={{ "--p": index } as React.CSSProperties} />)}</span>
    </div>
  );
}

export function signalLabel(signal: SignalFamily): string {
  return signal[0].toUpperCase() + signal.slice(1);
}
