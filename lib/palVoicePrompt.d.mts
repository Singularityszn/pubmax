export const PAL_VOICE_GET_HOME_REGISTER_INTRO: string;
export const PAL_VOICE_GET_HOME_REGISTER_RULES: readonly string[];
export const PAL_VOICE_PROPOSE_THEN_CONFIRM_RULE: string;
export const PAL_VOICE_DYNAMIC_DEFAULTS: {
  readonly pubmax_species: string;
  readonly pubmax_relationship: string;
  readonly pubmax_playfulness: string;
  readonly pubmax_energy: string;
  readonly pubmax_storytelling: string;
  readonly pubmax_city_id: string;
};
export function pubPalAgentSystemPrompt(maxSessionSeconds: number): string;
