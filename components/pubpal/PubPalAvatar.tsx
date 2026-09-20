import type { PubPalAppearance, PubPalSpecies } from "@/lib/pubPal";
import { PubPalMascot } from "@/components/pal/PubPalMascot";
import { pubPalMascotSlugFor } from "@/lib/pubPalMascot";
import "./pubPal.css";

// A stored legacy species with no master draws its old silhouette. Every
// onboarding species ships a master (and `hound` stands in for the greyhound),
// so this table is the icon lane alone and a species outside it never reaches
// the svg branch.
const legacySilhouettes: Partial<Record<PubPalSpecies, string>> = {
  raven: "M20 57c2-31 12-46 29-45 11 1 17 9 18 20l14 8-15 7c-5 21-25 28-46 10Z",
  rabbit: "M22 30 23 2l12 24c3-1 7-1 10 0L57 2l1 28c10 16 2 37-18 39-20-2-28-23-18-39Z",
  turtle: "M12 42c0-17 13-29 29-29s29 12 29 29-13 26-29 26S12 59 12 42Zm-8 0h8m58 0h8M25 66l-8 8m40-8 8 8",
  squirrel: "M21 62c-8-18 0-35 14-42 12-6 23-1 28 9 13-13 24 5 13 17-8 9-19 3-20-6 3 21-19 35-35 22Z",
  bot: "M14 17h52v47H14zM26 34h8m12 0h8M28 50h24M40 17V8m-6 0h12",
};

export function PubPalAvatar({ appearance, name, compact = false }: { appearance: PubPalAppearance; name: string; compact?: boolean }) {
  return (
    <div className={`palAvatar pal-${appearance.species} pal-${appearance.signalAffinity} ${compact ? "isCompact" : ""}`} role="img" aria-label={`${name}, a ${appearance.signalAffinity} hologram cyber ${appearance.species}`}>
      <span className="palHalo" aria-hidden="true" />
      <span className="palBody" aria-hidden="true">
        {pubPalMascotSlugFor(appearance.species) ? (
          <PubPalMascot species={appearance.species} size={compact ? 28 : 40} circular decorative className="palAvatarMascot" />
        ) : (
          <svg viewBox="0 0 80 80"><path d={legacySilhouettes[appearance.species] ?? legacySilhouettes.bot} /></svg>
        )}
        <b />
      </span>
      <span className="palParticles" aria-hidden="true">{Array.from({ length: 9 }, (_, index) => <i key={index} style={{ "--p": index } as React.CSSProperties} />)}</span>
    </div>
  );
}
