export const PAL_MASCOT_SIZES: readonly [32, 64, 128, 512];

export const PAL_MASCOT_WEBP_512_BUDGET: number;

export const PAL_MASCOT_SLUGS: {
  readonly robin: "circuit-robin";
  readonly greyhound: "circuit-greyhound";
  readonly cat: "circuit-cat";
  readonly fox: "circuit-fox";
  readonly pigeon: "circuit-pigeon";
  readonly badger: "circuit-badger";
  readonly corgi: "circuit-corgi";
};

/** A legacy stored species that draws a rendered species' master under an older name. */
export const PAL_MASCOT_STAND_INS: {
  readonly hound: "greyhound";
};

/** A species that ships a rendered master. */
export type PalMascotSpecies = keyof typeof PAL_MASCOT_SLUGS;

/** The asset slug a species with a master owns. */
export type PalMascotSlug = (typeof PAL_MASCOT_SLUGS)[PalMascotSpecies];

/** The slug for a species that has a master (or stands in for one), or null when it draws a legacy icon. */
export function palMascotSlug(species: string): PalMascotSlug | null;

export function palMascotSpeciesList(): PalMascotSpecies[];
