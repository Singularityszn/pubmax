export const PRIVATE_IDENTITY_SEX_VALUES = [
  "female",
  "male",
  "intersex",
  "prefer_not_to_say",
] as const;

export type PrivateIdentitySex =
  (typeof PRIVATE_IDENTITY_SEX_VALUES)[number];
